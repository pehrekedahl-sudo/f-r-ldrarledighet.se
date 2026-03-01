import { useState, useRef, useEffect } from "react";
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

type DistributionMode = "proportional" | "split" | string; // "proportional", "split", or parent id

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Transfer | null;
  onApply: (newBlocks: Block[], newTransfer: Transfer | null) => void;
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
};

function getTransfers(transfer: Transfer | null) {
  return transfer && transfer.sicknessDays > 0 ? [transfer] : [];
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarDaysOf(b: Block): number {
  return Math.ceil(
    (new Date(b.endDate + "T00:00:00Z").getTime() - new Date(b.startDate + "T00:00:00Z").getTime()) /
    (1000 * 60 * 60 * 24)
  ) + 1;
}

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

/** Reduce dpw by 1 for the LAST `weeks` calendar weeks of the given parent's blocks.
 *  Uses originalDpwMap to ensure no block is reduced by more than 1 from its original value. */
function applyWeekReduction(
  working: Block[],
  parentId: string,
  weeks: number,
  originalDpwMap: Map<string, number>,
): void {
  if (weeks <= 0) return;

  const parentBlocks = working
    .filter(b => b.parentId === parentId && b.daysPerWeek > 0)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  let remaining = weeks;

  for (const block of parentBlocks) {
    if (remaining <= 0) break;
    if (block.daysPerWeek <= 0) continue;

    // Skip blocks already reduced by 1 from original
    const origDpw = originalDpwMap.get(block.id) ?? block.daysPerWeek;
    if (block.daysPerWeek < origDpw) continue;

    const calDays = calendarDaysOf(block);
    const blockWeeks = Math.floor(calDays / 7);
    if (blockWeeks <= 0) continue;

    if (blockWeeks <= remaining) {
      block.daysPerWeek = Math.max(0, origDpw - 1);
      remaining -= blockWeeks;
    } else {
      const headDays = calDays - remaining * 7;
      const splitDate = addDaysISO(block.startDate, headDays);
      const tailId = `rescue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const tailBlock: Block = {
        id: tailId,
        parentId: block.parentId,
        startDate: splitDate,
        endDate: block.endDate,
        daysPerWeek: Math.max(0, origDpw - 1),
        lowestDaysPerWeek: block.lowestDaysPerWeek,
        overlapGroupId: block.overlapGroupId,
      };
      block.endDate = addDaysISO(splitDate, -1);
      // Record original dpw for the new tail block
      originalDpwMap.set(tailId, origDpw);
      working.push(tailBlock);
      remaining = 0;
    }
  }
}

/** Calculate each parent's planned withdrawal days from blocks */
function calcParentRequestedDays(blocks: Block[], parentId: string): number {
  return blocks
    .filter(b => b.parentId === parentId)
    .reduce((sum, b) => {
      const weeks = Math.floor(calendarDaysOf(b) / 7);
      return sum + weeks * b.daysPerWeek;
    }, 0);
}

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
  const missingDays = Math.ceil(origUnfulfilled);

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

    transferAmount = tryAmount;
    proposedTransfer = testTransfer;
    remainingShortage = Math.ceil(testUnfulfilled > 0 ? testUnfulfilled : 0);
  }

  // ── Step 2: If transfer alone solves it ──
  if (remainingShortage <= 0 && proposedTransfer) {
    const finalBlocks = blocks.map(b => ({ ...b }));
    const finalResult = simulatePlan({ parents, blocks: finalBlocks, transfers: [proposedTransfer], constants });
    const newAvg = calcAvgMonthly(finalResult.parentsResult);
    return {
      newBlocks: finalBlocks,
      proposedTransfer,
      transferAmount,
      reductionSummary: [],
      deltaMonthly: Math.round(newAvg - origAvg),
      success: true,
      transferOnly: true,
      totalRequiredWeeks: 0,
      missingDays,
    };
  }

  // ── Step 3: Week-based pace reduction using ONLY remainingShortage ──
  const activeTransfers = proposedTransfer ? [proposedTransfer] : baseTransfers;
  const working = blocks.map(b => ({ ...b }));
  const requiredWeeks = remainingShortage;
  const reductionSummary: Proposal["reductionSummary"] = [];

  // Build original dpw map — snapshot BEFORE any mutations
  const originalDpwMap = new Map<string, number>();
  for (const b of working) {
    originalDpwMap.set(b.id, b.daysPerWeek);
  }

  console.log("[RescueMode proposal]", {
    missingDays: Math.ceil(origUnfulfilled),
    transferDays: transferAmount,
    remainingAfterTransfer: remainingShortage,
    requiredWeeks,
  });

  // Distribute weeks based on mode — only if there are weeks to distribute
  if (requiredWeeks > 0) {
    const parentWeeks: { pid: string; weeks: number }[] = [];

    if (mode === "split" && parents.length >= 2) {
      const weeksA = Math.floor(requiredWeeks / 2);
      const weeksB = requiredWeeks - weeksA;
      parentWeeks.push({ pid: parents[0].id, weeks: weeksA });
      parentWeeks.push({ pid: parents[1].id, weeks: weeksB });
    } else if (mode === "proportional" && parents.length >= 2) {
      const totalDays = parents.reduce((s, p) => s + calcParentRequestedDays(blocks, p.id), 0);
      if (totalDays > 0) {
        const share0 = calcParentRequestedDays(blocks, parents[0].id) / totalDays;
        const weeks0 = Math.round(requiredWeeks * share0);
        const weeks1 = requiredWeeks - weeks0;
        parentWeeks.push({ pid: parents[0].id, weeks: weeks0 });
        parentWeeks.push({ pid: parents[1].id, weeks: weeks1 });
      } else {
        const weeksA = Math.floor(requiredWeeks / 2);
        parentWeeks.push({ pid: parents[0].id, weeks: weeksA });
        parentWeeks.push({ pid: parents[1].id, weeks: requiredWeeks - weeksA });
      }
    } else {
      const pid = mode === "proportional" || mode === "split" ? parents[0].id : mode;
      parentWeeks.push({ pid, weeks: requiredWeeks });
    }

    for (const { pid, weeks } of parentWeeks) {
      if (weeks <= 0) continue;
      const sampleBlock = working.find(b => b.parentId === pid && b.daysPerWeek > 0);
      const oldDpw = sampleBlock?.daysPerWeek ?? 0;
      applyWeekReduction(working, pid, weeks, originalDpwMap);
      const parentName = parents.find(p => p.id === pid)?.name ?? "";
      reductionSummary.push({ parentName, weeks, oldDpw, newDpw: Math.max(0, oldDpw - 1) });
    }
  }

  // ── Sanity check: no block reduced by more than 1 from original ──
  for (const b of working) {
    const origDpw = originalDpwMap.get(b.id);
    if (origDpw !== undefined && b.daysPerWeek < origDpw - 1) {
      console.error(`[RescueMode] DOUBLE REDUCTION detected! Block ${b.id} (${b.parentId}): original=${origDpw}, now=${b.daysPerWeek}`);
    }
  }

  // Verify preview weeks sum
  const previewWeeksSum = reductionSummary.reduce((s, r) => s + r.weeks, 0);
  if (previewWeeksSum !== requiredWeeks) {
    console.error(`[RescueMode] Week sum mismatch: preview=${previewWeeksSum}, required=${requiredWeeks}`);
  }

  const finalSorted = working.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const finalResult = simulatePlan({ parents, blocks: finalSorted, transfers: activeTransfers, constants });
  const finalUnfulfilled = finalResult.unfulfilledDaysTotal ?? 0;
  const newAvg = calcAvgMonthly(finalResult.parentsResult);

  console.log("[RescueMode proposalPlan.transfers]", activeTransfers);

  return {
    newBlocks: finalSorted,
    proposedTransfer,
    transferAmount,
    reductionSummary,
    deltaMonthly: Math.round(newAvg - origAvg),
    success: finalUnfulfilled <= 0,
    transferOnly: false,
    totalRequiredWeeks: requiredWeeks,
    missingDays,
  };
}

const FitPlanDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const [mode, setMode] = useState<DistributionMode>("proportional");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [computing, setComputing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single source of truth: compute proposal on open + mode change
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

  // Reset mode on open
  useEffect(() => {
    if (open) setMode("proportional");
  }, [open]);

  const handleApply = () => {
    if (!proposal) return;

    const appliedTransfer = proposal.proposedTransfer ?? transfer;

    console.log("[RescueMode Apply] blocks:", proposal.newBlocks.map(b => ({ id: b.id, pid: b.parentId, dpw: b.daysPerWeek })));
    console.log("[RescueMode Apply] transfer:", appliedTransfer);

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
          {/* A) Neutral recommendation — derived from proposal */}
          {computing ? (
            <p className="text-sm text-muted-foreground italic animate-pulse">Beräknar…</p>
          ) : proposal ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rekommenderad lösning</p>
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <p className="text-sm text-foreground font-medium">
                  Planen saknar {proposal.missingDays} dagar.
                </p>
                <p className="text-sm text-muted-foreground">
                  För att planen ska gå ihop behöver ni:
                </p>
                <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
                  {proposal.transferAmount > 0 && (
                    <li>Överföra {proposal.transferAmount} dagar mellan er</li>
                  )}
                  {proposal.totalRequiredWeeks > 0 && (
                    <li>Minska uttaget med {proposal.totalRequiredWeeks} veckor totalt</li>
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

          {/* C) Live preview — only render when proposal exists (already gated above) */}
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
