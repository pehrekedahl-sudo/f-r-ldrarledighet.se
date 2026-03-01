/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — SELF-CONTAINED                         │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. Rescue uses its own pre-policy algorithm:      │
 * │ transfer first → then reduce dpw by 1 for N weeks (late-first).│
 * │                                                                  │
 * │ Policy modules are for smart drawers only (Sparade dagar, etc). │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { simulatePlan } from "@/lib/simulatePlan";
import { mergeAdjacentBlocks } from "@/lib/mergeAdjacentBlocks";
import { generateBlockId } from "@/lib/blockIdUtils";

// ── Local Block type (no policy dependency) ──

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
};

type Parent = {
  id: string;
  name: string;
  monthlyIncomeFixed: number;
  monthlyIncomeVariableAvg?: number;
  has240Days: boolean;
};

type Constants = {
  SGI_CAP_ANNUAL: number;
  LOWEST_LEVEL_DAILY_AMOUNT: number;
  BASIC_LEVEL_DAILY_AMOUNT: number;
  SICKNESS_RATE: number;
  REDUCTION: number;
  SICKNESS_DAILY_MAX?: number;
};

type Transfer = { fromParentId: string; toParentId: string; sicknessDays: number };

type DistributionMode = "proportional" | "split" | string;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Transfer | null;
  onApply: (newBlocks: Block[], newTransfer: Transfer | null) => void;
};

type DebugGroundTruth = {
  shortageBefore: number;
  budgetFlagBefore: boolean;
  shortageAfter: number;
  budgetFlagAfter: boolean;
};

type Proposal = {
  newBlocks: Block[];
  proposedTransfer: Transfer | null;
  transferAmount: number;
  reductionSummary: { parentName: string; weeks: number; oldDpw: number; newDpw: number }[];
  deltaMonthly: number;
  success: boolean;
  transferOnly: boolean;
  totalRequiredWeeks: number;
  missingDays: number;
  debug: DebugGroundTruth;
  debugBefore: Block[];
  debugAfter: Block[];
};

// ── Rescue-local helpers (zero policy imports) ──

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarDays(b: Block): number {
  return Math.ceil(
    (new Date(b.endDate + "T00:00:00Z").getTime() - new Date(b.startDate + "T00:00:00Z").getTime()) /
    (1000 * 60 * 60 * 24)
  ) + 1;
}

function getTransfers(transfer: Transfer | null) {
  return transfer && transfer.sicknessDays > 0 ? [transfer] : [];
}

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

/**
 * Rescue-local reduction: reduce dpw by 1 for `weeksNeeded` weeks,
 * applied late-first within the given parentScope.
 * Returns mutated blocks array and per-parent summary.
 */
function rescueReduceWeeks(
  blocks: Block[],
  parentScope: string[],
  weeksNeeded: number,
): { blocks: Block[]; perParent: { parentId: string; weeks: number; oldDpw: number; newDpw: number }[] } {
  const working = blocks.map(b => ({ ...b }));
  const allowed = new Set(parentScope);
  let remaining = weeksNeeded;
  const perParentMap = new Map<string, { weeks: number; oldDpw: number; newDpw: number }>();

  // Get candidate blocks sorted latest-first
  const candidates = working
    .filter(b => allowed.has(b.parentId) && b.daysPerWeek >= 1)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  for (const target of candidates) {
    if (remaining <= 0) break;
    if (target.daysPerWeek < 1) continue;

    const calDays = calendarDays(target);
    const blockWeeks = Math.floor(calDays / 7);
    if (blockWeeks <= 0) continue;

    const oldDpw = target.daysPerWeek;
    const newDpw = oldDpw - 1;

    if (blockWeeks <= remaining) {
      // Reduce entire block
      target.daysPerWeek = newDpw;
      remaining -= blockWeeks;
      const entry = perParentMap.get(target.parentId);
      if (!entry) {
        perParentMap.set(target.parentId, { weeks: blockWeeks, oldDpw, newDpw });
      } else {
        entry.weeks += blockWeeks;
      }
    } else {
      // Split: keep earlier part unchanged, reduce later part
      const headDays = calDays - remaining * 7;
      if (headDays <= 0) {
        target.daysPerWeek = newDpw;
        const entry = perParentMap.get(target.parentId);
        if (!entry) {
          perParentMap.set(target.parentId, { weeks: blockWeeks, oldDpw, newDpw });
        } else {
          entry.weeks += blockWeeks;
        }
        remaining = 0;
      } else {
        const splitDate = addDaysISO(target.startDate, headDays);
        const tailBlock: Block = {
          id: generateBlockId("rescue"),
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: newDpw,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        target.endDate = addDaysISO(splitDate, -1);
        working.push(tailBlock);

        const entry = perParentMap.get(target.parentId);
        if (!entry) {
          perParentMap.set(target.parentId, { weeks: remaining, oldDpw, newDpw });
        } else {
          entry.weeks += remaining;
        }
        remaining = 0;
      }
    }
  }

  const perParent = Array.from(perParentMap.entries()).map(([parentId, v]) => ({ parentId, ...v }));
  return { blocks: mergeAdjacentBlocks(working), perParent };
}

// ── Main rescue computation ──

function computeRescueProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  existingTransfer: Transfer | null,
  mode: DistributionMode,
): Proposal | null {
  if (blocks.length === 0) return null;

  const baseTransfers = getTransfers(existingTransfer);
  const origResult = simulatePlan({ parents, blocks, transfers: baseTransfers, constants });
  const origUnfulfilled = origResult.unfulfilledDaysTotal ?? 0;
  if (origUnfulfilled <= 0) return null;

  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const missingDays = Math.round(origUnfulfilled);
  const debugBefore = blocks.map(b => ({ ...b }));

  // ── Step 1: Try transfers first ──
  const scored = origResult.parentsResult.map((pr: any) => ({
    id: pr.parentId,
    name: pr.name,
    transferable: pr.remaining.sicknessTransferable as number,
    taken: (pr.taken.sickness + pr.taken.lowest) as number,
    totalRemaining: (pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest) as number,
  }));
  scored.sort((a, b) => a.totalRemaining - b.totalRemaining || b.taken - a.taken);
  const needy = scored[0];
  const giver = scored[scored.length - 1];

  let proposedTransfer: Transfer | null = null;
  let transferAmount = 0;
  let remainingShortage = missingDays;

  if (giver.transferable > 0 && needy.id !== giver.id) {
    const maxTransfer = Math.floor(giver.transferable);
    const tryAmount = Math.min(maxTransfer, missingDays);
    const existingAmount = existingTransfer &&
      existingTransfer.fromParentId === giver.id &&
      existingTransfer.toParentId === needy.id
      ? existingTransfer.sicknessDays : 0;

    const testTransfer: Transfer = {
      fromParentId: giver.id,
      toParentId: needy.id,
      sicknessDays: existingAmount + tryAmount,
    };
    const testResult = simulatePlan({ parents, blocks, transfers: [testTransfer], constants });
    const testUnfulfilled = testResult.unfulfilledDaysTotal ?? 0;

    transferAmount = existingAmount + tryAmount;
    proposedTransfer = testTransfer;
    remainingShortage = Math.round(testUnfulfilled > 0 ? testUnfulfilled : 0);
  }

  // ── Step 2: If transfer alone solves it ──
  if (remainingShortage <= 0 && proposedTransfer) {
    const finalBlocks = blocks.map(b => ({ ...b }));
    const finalResult = simulatePlan({ parents, blocks: finalBlocks, transfers: [proposedTransfer], constants });
    const finalUnfulfilled = finalResult.unfulfilledDaysTotal ?? 0;
    const newAvg = calcAvgMonthly(finalResult.parentsResult);
    return {
      newBlocks: mergeAdjacentBlocks(finalBlocks),
      proposedTransfer,
      transferAmount: proposedTransfer.sicknessDays,
      reductionSummary: [],
      deltaMonthly: Math.round(newAvg - origAvg),
      success: finalUnfulfilled <= 0,
      transferOnly: true,
      totalRequiredWeeks: 0,
      missingDays,
      debug: {
        shortageBefore: Math.round(origUnfulfilled),
        budgetFlagBefore: !!(origResult as any).warnings?.budgetInsufficient,
        shortageAfter: Math.round(finalUnfulfilled),
        budgetFlagAfter: !!(finalResult as any).warnings?.budgetInsufficient,
      },
      debugBefore,
      debugAfter: mergeAdjacentBlocks(finalBlocks),
    };
  }

  // ── Step 3: Reduce dpw by 1 for N weeks (iterative, late-first) ──
  let currentBlocks = blocks.map(b => ({ ...b }));
  let currentTransfer = proposedTransfer;
  let currentTransfers = currentTransfer ? [currentTransfer] : baseTransfers;
  let checkResult = simulatePlan({ parents, blocks: currentBlocks, transfers: currentTransfers, constants });
  let iterUnfulfilled = checkResult.unfulfilledDaysTotal ?? 0;
  let totalWeeksReduced = 0;
  const reductionSummary: Proposal["reductionSummary"] = [];
  let iterations = 0;

  // Determine parent scope based on mode
  const getParentScope = (): string[] => {
    if (mode === "split" && parents.length >= 2) {
      return parents.map(p => p.id);
    } else if (mode === "proportional" && parents.length >= 2) {
      return parents.map(p => p.id);
    } else if (mode !== "proportional" && mode !== "split") {
      return [mode]; // specific parent id
    }
    return parents.map(p => p.id);
  };

  while (iterUnfulfilled > 0 && iterations < 50) {
    iterations++;
    const weeksToReduce = Math.max(1, Math.ceil(iterUnfulfilled));
    const parentScope = getParentScope();

    // For proportional mode: allocate weeks based on each parent's withdrawal load
    let scopeWeeks: { parentId: string; weeks: number }[];
    if (mode === "proportional" && parents.length >= 2) {
      // Calculate load per parent (weeks * dpw across entire plan)
      const loads = new Map<string, number>();
      for (const pid of parentScope) loads.set(pid, 0);
      for (const b of currentBlocks) {
        if (!loads.has(b.parentId)) continue;
        const w = Math.floor(calendarDays(b) / 7);
        loads.set(b.parentId, loads.get(b.parentId)! + w * b.daysPerWeek);
      }
      const totalLoad = Array.from(loads.values()).reduce((s, v) => s + v, 0);
      const sorted = [...parentScope].sort();
      scopeWeeks = sorted.map((pid, i) => {
        const share = totalLoad > 0 ? loads.get(pid)! / totalLoad : 1 / sorted.length;
        if (i === sorted.length - 1) {
          const assigned = sorted.slice(0, -1).reduce((s, p) => s + Math.round(weeksToReduce * (totalLoad > 0 ? loads.get(p)! / totalLoad : 1 / sorted.length)), 0);
          return { parentId: pid, weeks: Math.max(0, weeksToReduce - assigned) };
        }
        return { parentId: pid, weeks: Math.max(0, Math.round(weeksToReduce * share)) };
      });
    } else if (mode === "split" && parents.length >= 2) {
      const half = Math.floor(weeksToReduce / 2);
      scopeWeeks = [
        { parentId: parents[0].id, weeks: half },
        { parentId: parents[1].id, weeks: weeksToReduce - half },
      ];
    } else {
      scopeWeeks = parentScope.map(pid => ({ parentId: pid, weeks: weeksToReduce }));
    }

    let anyProgress = false;
    for (const { parentId, weeks } of scopeWeeks) {
      if (weeks <= 0) continue;
      const reduction = rescueReduceWeeks(currentBlocks, [parentId], weeks);
      if (reduction.perParent.length > 0) {
        anyProgress = true;
        currentBlocks = reduction.blocks;
        for (const pp of reduction.perParent) {
          const parentName = parents.find(p => p.id === pp.parentId)?.name ?? "";
          totalWeeksReduced += pp.weeks;
          const existing = reductionSummary.find(r => r.parentName === parentName);
          if (existing) {
            existing.weeks += pp.weeks;
          } else {
            reductionSummary.push({ parentName, weeks: pp.weeks, oldDpw: pp.oldDpw, newDpw: pp.newDpw });
          }
        }
      }
    }

    if (!anyProgress) break;

    // Try adding more transfer after reduction
    if (currentTransfer) {
      const cr = simulatePlan({ parents, blocks: currentBlocks, transfers: [currentTransfer], constants });
      const giverResult = cr.parentsResult.find((pr: any) => pr.parentId === currentTransfer!.fromParentId);
      const extraTransferable = Math.floor(giverResult?.remaining?.sicknessTransferable ?? 0);
      if (extraTransferable > 0 && (cr.unfulfilledDaysTotal ?? 0) > 0) {
        const extraAmount = Math.min(extraTransferable, Math.ceil(cr.unfulfilledDaysTotal ?? 0));
        currentTransfer = { ...currentTransfer, sicknessDays: currentTransfer.sicknessDays + extraAmount };
        currentTransfers = [currentTransfer];
      }
    }

    checkResult = simulatePlan({ parents, blocks: currentBlocks, transfers: currentTransfers, constants });
    iterUnfulfilled = checkResult.unfulfilledDaysTotal ?? 0;
  }

  const finalBlocks = mergeAdjacentBlocks(currentBlocks);
  const finalResult = simulatePlan({ parents, blocks: finalBlocks, transfers: currentTransfers, constants });
  const finalUnfulfilled = finalResult.unfulfilledDaysTotal ?? 0;
  const newAvg = calcAvgMonthly(finalResult.parentsResult);
  const finalTransferDays = currentTransfer ? currentTransfer.sicknessDays : 0;

  return {
    newBlocks: finalBlocks,
    proposedTransfer: currentTransfer,
    transferAmount: finalTransferDays,
    reductionSummary,
    deltaMonthly: Math.round(newAvg - origAvg),
    success: finalUnfulfilled <= 0,
    transferOnly: false,
    totalRequiredWeeks: totalWeeksReduced,
    missingDays,
    debug: {
      shortageBefore: Math.round(origUnfulfilled),
      budgetFlagBefore: !!(origResult as any).warnings?.budgetInsufficient,
      shortageAfter: Math.round(finalUnfulfilled),
      budgetFlagAfter: !!(finalResult as any).warnings?.budgetInsufficient,
    },
    debugBefore,
    debugAfter: finalBlocks,
  };
}

// ── Component ──

const FitPlanDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const [mode, setMode] = useState<DistributionMode>("proportional");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [computing, setComputing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setComputing(true);
    setProposal(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const result = computeRescueProposal(blocks, parents, constants, transfer, mode);
      setProposal(result);
      setComputing(false);
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, mode, blocks, parents, constants, transfer]);

  useEffect(() => {
    if (open) setMode("proportional");
  }, [open]);

  const handleApply = () => {
    if (!proposal) return;
    const appliedTransfer = proposal.proposedTransfer ?? transfer;
    // Use proposal.newBlocks directly — no policy normalization
    onApply(proposal.newBlocks, appliedTransfer);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Auto-justera så planen går ihop</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 py-4 overflow-y-auto">
          {/* A) Neutral recommendation */}
          {computing ? (
            <p className="text-sm text-muted-foreground italic animate-pulse">Beräknar…</p>
          ) : proposal ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rekommenderad lösning</p>
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <p className="text-sm text-foreground font-medium">
                  Planen behöver justeras för att gå ihop.
                </p>
                <p className="text-sm text-muted-foreground">
                  {proposal.transferAmount > 0 && proposal.totalRequiredWeeks > 0
                    ? "Planen kräver omfördelning av dagar mellan er och justering av uttagstakt."
                    : proposal.transferAmount > 0 && proposal.totalRequiredWeeks === 0
                    ? "Planen kräver omfördelning av dagar mellan er."
                    : proposal.totalRequiredWeeks > 0
                    ? "Planen kräver att ni minskar uttagstakten i delar av ledigheten."
                    : "Planen behöver justeras."}
                </p>
                <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
                  {proposal.transferAmount > 0 && (
                    <li>Överföra {proposal.transferAmount} dagar mellan er</li>
                  )}
                  {proposal.totalRequiredWeeks > 0 && (
                    <li>Minska uttaget med 1 dag/vecka i {proposal.totalRequiredWeeks} veckor</li>
                  )}
                  {proposal.transferAmount <= 0 && proposal.totalRequiredWeeks <= 0 && (
                    <li>Inga justeringar behövs</li>
                  )}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Kunde inte hitta en justering. Planen kanske redan går ihop.
            </p>
          )}

          {/* B) Distribution selection */}
          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Välj hur justeringen ska fördelas</p>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as DistributionMode)}>
              {parents.map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  <RadioGroupItem value={p.id} id={`rescue-${p.id}`} />
                  <Label htmlFor={`rescue-${p.id}`} className="text-sm font-normal cursor-pointer">Endast {p.name}</Label>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <RadioGroupItem value="split" id="rescue-split" />
                <Label htmlFor="rescue-split" className="text-sm font-normal cursor-pointer">50/50 mellan er</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="proportional" id="rescue-proportional" />
                <Label htmlFor="rescue-proportional" className="text-sm font-normal cursor-pointer">
                  Proportionerligt <span className="text-muted-foreground">(rekommenderas)</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* C) Live preview */}
          {!computing && proposal && (
            <div className="space-y-4 border-t border-border pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detta innebär</p>

              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <ul className="text-sm text-foreground space-y-1.5 list-disc list-inside">
                  {proposal.proposedTransfer && proposal.transferAmount > 0 && (
                    <li>
                      Överför {proposal.transferAmount} dagar från{" "}
                      {parents.find(p => p.id === proposal.proposedTransfer!.fromParentId)?.name ?? "?"}{" "}
                      till {parents.find(p => p.id === proposal.proposedTransfer!.toParentId)?.name ?? "?"}
                    </li>
                  )}
                  {proposal.reductionSummary.map((r, i) => (
                    <li key={i}>
                      {r.parentName} minskar uttaget med 1 dag/vecka i {r.weeks} veckor
                    </li>
                  ))}
                  {proposal.transferOnly && (
                    <li>Enbart överföring av dagar löser bristen</li>
                  )}
                </ul>
              </div>

              <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                {proposal.success ? (
                  <p className="text-sm text-primary font-semibold">✓ Planen går ihop</p>
                ) : (
                  <p className="text-sm text-destructive font-semibold">
                    ✗ Planen kan inte helt balanseras med dessa justeringar
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {proposal.deltaMonthly >= 0 ? "+" : ""}{proposal.deltaMonthly.toLocaleString()} kr/mån i genomsnitt
                </p>
              </div>
            </div>
          )}

          {/* D) Debug (rescue) panel */}
          {!computing && proposal && (
            <details className="border-t border-border pt-4">
              <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none">
                <ChevronDown className="h-3 w-3" />
                DEBUG (rescue)
              </summary>
              <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-3 space-y-3 font-mono text-[10px] text-muted-foreground max-h-60 overflow-y-auto">
                <div>
                  <p className="font-semibold text-foreground/70">Blocks BEFORE ({proposal.debugBefore.length})</p>
                  {proposal.debugBefore.map((b, i) => (
                    <p key={i}>{b.id.slice(0,12)} | {b.parentId} | {b.startDate}→{b.endDate} | dpw={b.daysPerWeek}</p>
                  ))}
                </div>
                <div>
                  <p className="font-semibold text-foreground/70">Blocks AFTER ({proposal.debugAfter.length})</p>
                  {proposal.debugAfter.map((b, i) => (
                    <p key={i}>{b.id.slice(0,12)} | {b.parentId} | {b.startDate}→{b.endDate} | dpw={b.daysPerWeek}</p>
                  ))}
                </div>
                <p className="font-semibold text-foreground/70">Ground truth</p>
                <div className="pl-3 space-y-0.5">
                  <p>shortageBefore = {proposal.debug.shortageBefore}</p>
                  <p>shortageAfter = <span className={proposal.debug.shortageAfter === 0 ? "text-primary" : "text-destructive"}>{proposal.debug.shortageAfter}</span></p>
                  <p>transferAmount = {proposal.transferAmount}</p>
                  <p>totalWeeks = {proposal.totalRequiredWeeks}</p>
                </div>
              </div>
            </details>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!proposal} onClick={handleApply}>
            Applicera ändring
          </Button>
          <SheetClose asChild>
            <Button variant="ghost">Avbryt</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default FitPlanDrawer;
