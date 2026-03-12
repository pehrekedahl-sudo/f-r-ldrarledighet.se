import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { simulatePlan } from "@/lib/simulatePlan";
import {
  type Block,
  type ReductionSummary,
} from "@/lib/adjustmentPolicy";
import { canonicalizeBlocks } from "@/lib/canonicalizeBlocks";
import { addDays, diffDaysInclusive, compareDates } from "@/utils/dateOnly";


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

type SaveSource = "both" | string;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: { fromParentId: string; toParentId: string; sicknessDays: number } | null;
  onApply: (newBlocks: Block[]) => void;
  hasManualEdits?: boolean;
};

type CurrentState = {
  remainingSickness: number;
  remainingLowest: number;
  currentTotal: number;
  avgMonthly: number;
};

type Proposal = {
  newBlocks: Block[];
  summary: ReductionSummary | null;
  newSickness: number;
  newLowest: number;
  newTotal: number;
  deltaDays: number;
  deltaMonthly: number;
  newEndDate: string;
  direction: "save";
};

// ── helpers ──

function getTransfers(transfer: Props["transfer"]) {
  return transfer && transfer.sicknessDays > 0 ? [transfer] : [];
}

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

function calcRemaining(parentsResult: any[]) {
  let sickness = 0;
  let lowest = 0;
  for (const pr of parentsResult) {
    sickness += pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved;
    lowest += pr.remaining.lowest;
  }
  return { remainingSickness: Math.round(sickness), remainingLowest: Math.round(lowest), currentTotal: Math.round(sickness + lowest) };
}

function calcMaxRemaining(parents: Parent[], constants: Constants, transfer: Props["transfer"]): number {
  const transfers = getTransfers(transfer);
  const result = simulatePlan({ parents, blocks: [], transfers, constants });
  return calcRemaining(result.parentsResult).currentTotal;
}

function getCurrentState(blocks: Block[], parents: Parent[], constants: Constants, transfer: Props["transfer"]): CurrentState {
  const transfers = getTransfers(transfer);
  const result = simulatePlan({ parents, blocks, transfers, constants });
  const r = calcRemaining(result.parentsResult);
  return { ...r, avgMonthly: calcAvgMonthly(result.parentsResult) };
}

/**
 * Get sorted non-overlap blocks for a specific parent.
 */
function getParentBlocks(working: Block[], parentId: string): Block[] {
  return working
    .filter(b => b.parentId === parentId && !b.isOverlap)
    .sort((a, b) => compareDates(a.startDate, b.startDate));
}

/**
 * Check if changing a block's dpw by delta would violate the adjacency constraint:
 * adjacent blocks (same parent, sorted by time) must not differ by more than 1 in dpw.
 */
function wouldViolateAdjacency(working: Block[], blockId: string, parentId: string, delta: number): boolean {
  const sorted = getParentBlocks(working, parentId);
  const idx = sorted.findIndex(b => b.id === blockId);
  if (idx === -1) return false;
  const newDpw = sorted[idx].daysPerWeek + delta;
  if (idx > 0 && Math.abs(newDpw - sorted[idx - 1].daysPerWeek) > 1) return true;
  if (idx < sorted.length - 1 && Math.abs(newDpw - sorted[idx + 1].daysPerWeek) > 1) return true;
  return false;
}

function countNonOverlapBlocksForParent(working: Block[], parentId: string): number {
  return working.filter(b => !b.isOverlap && b.parentId === parentId).length;
}

function adjustToTarget(opts: {
  blocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Props["transfer"];
  source: SaveSource;
  targetTotal: number;
  originalTotal: number;
}): { blocks: Block[]; summary: ReductionSummary | null } | null {
  const { blocks, parents, constants, transfer, source, targetTotal, originalTotal } = opts;
  const transfers = getTransfers(transfer);
  const allowedIds = source === "both" ? parents.map(p => p.id) : [source];
  // targetTotal > originalTotal = fler kvar = spara fler = sänk dpw
  const savingMore = targetTotal > originalTotal;

  let working = blocks.map(b => ({ ...b }));
  let bestBlocks = working.map(b => ({ ...b }));
  let bestDiff = Infinity;

  // Check if already at target
  const initSim = simulatePlan({ parents, blocks: working, transfers, constants });
  const initRemaining = calcRemaining(initSim.parentsResult).currentTotal;
  if (initRemaining === targetTotal) {
    const final = canonicalizeBlocks(working);
    return { blocks: final, summary: null };
  }

  // For "both" source, alternate between parents for even distribution
  let parentTurnIndex = 0;

  for (let iter = 0; iter < 60; iter++) {
    const sim = simulatePlan({ parents, blocks: working, transfers, constants });
    const remaining = calcRemaining(sim.parentsResult).currentTotal;
    const diff = Math.abs(remaining - targetTotal);

    if (diff < bestDiff) {
      bestDiff = diff;
      bestBlocks = working.map(b => ({ ...b }));
    }
    if (remaining === targetTotal) break;

    // Determine which parent to adjust this iteration
    let iterAllowedIds: string[];
    if (source === "both" && allowedIds.length > 1) {
      iterAllowedIds = [allowedIds[parentTurnIndex % allowedIds.length]];
      parentTurnIndex++;
    } else {
      iterAllowedIds = allowedIds;
    }

    let adjusted = false;

    // Try to find and adjust a candidate; if "both" mode and primary parent fails, retry with the other
    const tryAdjust = (ids: string[]): boolean => {
      if (savingMore) {
        const candidates = working
          .filter(b => ids.includes(b.parentId) && !b.isOverlap && b.daysPerWeek > 1)
          .sort((a, b) => {
            if (b.daysPerWeek !== a.daysPerWeek) return b.daysPerWeek - a.daysPerWeek;
            return compareDates(b.endDate, a.endDate);
          });

        let chosen: (typeof candidates)[number] | null = null;
        for (const candidate of candidates) {
          if (!wouldViolateAdjacency(working, candidate.id, candidate.parentId, -1)) {
            chosen = candidate;
            break;
          }
          const sorted = getParentBlocks(working, candidate.parentId);
          const cidx = sorted.findIndex(b => b.id === candidate.id);
          for (let ni = cidx + 1; ni < sorted.length; ni++) {
            const neighbor = sorted[ni];
            if (neighbor.daysPerWeek <= 1) break;
            if (!wouldViolateAdjacency(working, neighbor.id, neighbor.parentId, -1)) {
              chosen = neighbor;
              break;
            }
          }
          if (chosen) break;
        }

        if (chosen) {
          const idx = working.findIndex(b => b.id === chosen!.id);
          const blockDays = diffDaysInclusive(chosen.startDate, chosen.endDate);
          if (blockDays < 28 || countNonOverlapBlocksForParent(working, chosen.parentId) >= 12) {
            working[idx] = { ...working[idx], daysPerWeek: working[idx].daysPerWeek - 1, source: "system" };
          } else {
            const splitDate = addDays(chosen.endDate, -13);
            working[idx] = { ...working[idx], endDate: addDays(splitDate, -1), source: "system" };
            working.push({
              ...chosen,
              id: `save-red-${iter}-${chosen.parentId}`,
              startDate: splitDate,
              endDate: chosen.endDate,
              daysPerWeek: chosen.daysPerWeek - 1,
              source: "system",
            });
          }
          return true;
        }
      } else {
        const candidates = working
          .filter(b => ids.includes(b.parentId) && !b.isOverlap && b.daysPerWeek < 7)
          .sort((a, b) => {
            if (a.daysPerWeek !== b.daysPerWeek) return a.daysPerWeek - b.daysPerWeek;
            return compareDates(a.startDate, b.startDate);
          });

        let chosen: (typeof candidates)[number] | null = null;
        for (const candidate of candidates) {
          if (!wouldViolateAdjacency(working, candidate.id, candidate.parentId, +1)) {
            chosen = candidate;
            break;
          }
          const sorted = getParentBlocks(working, candidate.parentId);
          const cidx = sorted.findIndex(b => b.id === candidate.id);
          for (let ni = cidx - 1; ni >= 0; ni--) {
            const neighbor = sorted[ni];
            if (neighbor.daysPerWeek >= 7) break;
            if (!wouldViolateAdjacency(working, neighbor.id, neighbor.parentId, +1)) {
              chosen = neighbor;
              break;
            }
          }
          if (chosen) break;
        }

        if (chosen) {
          const idx = working.findIndex(b => b.id === chosen!.id);
          const blockDays = diffDaysInclusive(chosen.startDate, chosen.endDate);
          if (blockDays < 28 || countNonOverlapBlocksForParent(working, chosen.parentId) >= 12) {
            working[idx] = { ...working[idx], daysPerWeek: working[idx].daysPerWeek + 1, source: "system" };
          } else {
            const splitEnd = addDays(chosen.startDate, 13);
            working.push({
              ...chosen,
              id: `adj-use-${iter}-${chosen.parentId}`,
              startDate: chosen.startDate,
              endDate: splitEnd,
              daysPerWeek: chosen.daysPerWeek + 1,
              source: "system",
            });
            working[idx] = { ...working[idx], startDate: addDays(splitEnd, 1), source: "system" };
          }
          return true;
        }
      }
      return false;
    };

    adjusted = tryAdjust(iterAllowedIds);

    // Fallback: if "both" mode and primary parent had no candidate, try the other parent
    if (!adjusted && source === "both" && allowedIds.length > 1) {
      const otherIds = allowedIds.filter(id => !iterAllowedIds.includes(id));
      adjusted = tryAdjust(otherIds);
    }

    if (!adjusted) break; // Neither parent had a valid candidate
  }

  // Also check last working state
  const lastSim = simulatePlan({ parents, blocks: working, transfers, constants });
  const lastRemaining = calcRemaining(lastSim.parentsResult).currentTotal;
  if (Math.abs(lastRemaining - targetTotal) < bestDiff) {
    bestBlocks = working.map(b => ({ ...b }));
  }

  // ONE canonicalization pass — this is the final output
  const finalBlocks = canonicalizeBlocks(bestBlocks);
  return { blocks: finalBlocks, summary: null };
}

function computeProposal(
  parents: Parent[],
  constants: Constants,
  transfer: Props["transfer"],
  targetTotal: number,
  blocks: Block[],
  originalTotal: number,
  source: SaveSource,
): Proposal | null {
  if (blocks.length === 0) return null;
  if (targetTotal === originalTotal) return null;
  const transfers = getTransfers(transfer);

  const searched = adjustToTarget({ blocks, parents, constants, transfer, source, targetTotal, originalTotal });
  if (!searched) return null;

  const resultBlocks = searched.blocks;
  const newResult = simulatePlan({ parents, blocks: resultBlocks, transfers, constants });
  const newR = calcRemaining(newResult.parentsResult);
  const newAvg = calcAvgMonthly(newResult.parentsResult);
  const origResult = simulatePlan({ parents, blocks, transfers, constants });
  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const latestEnd = resultBlocks.length > 0
    ? resultBlocks.reduce((max, b) => b.endDate > max ? b.endDate : max, resultBlocks[0].endDate)
    : "";

  return {
    newBlocks: resultBlocks,
    summary: null,
    newSickness: newR.remainingSickness,
    newLowest: newR.remainingLowest,
    newTotal: newR.currentTotal,
    deltaDays: newR.currentTotal - originalTotal,
    deltaMonthly: Math.round(newAvg - origAvg),
    newEndDate: latestEnd,
    direction: "save",
  };
}

// ── component ──

const SaveDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply, hasManualEdits }: Props) => {
  
  const current = useMemo(() => getCurrentState(blocks, parents, constants, transfer), [blocks, parents, constants, transfer]);
  const maxDays = useMemo(() => calcMaxRemaining(parents, constants, transfer), [parents, constants, transfer]);

  // targetDays = "how many days the user wants to SAVE" (not use)
  const [targetDays, setTargetDays] = useState(0);
  const [rawInput, setRawInput] = useState<string>("0");
  const [clampHint, setClampHint] = useState<string | null>(null);
  const [source, setSource] = useState<SaveSource>("both");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [computing, setComputing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Saved days" = remaining/unused FK-days
  const currentSavedDays = current.currentTotal;

  useEffect(() => {
    if (open) {
      setTargetDays(currentSavedDays);
      setRawInput(String(currentSavedDays));
      setClampHint(null);
      setSource("both");
      setProposal(null);
      setComputing(false);
    }
  }, [open, currentSavedDays]);

  const applyValue = (raw: number) => {
    if (isNaN(raw)) raw = currentSavedDays;
    if (raw > maxDays) {
      setClampHint(`Max är ${maxDays}.`);
      setTargetDays(maxDays);
      setRawInput(String(maxDays));
    } else if (raw < 0) {
      setClampHint("Min är 0.");
      setTargetDays(0);
      setRawInput("0");
    } else {
      setClampHint(null);
      const clamped = Math.floor(raw);
      setTargetDays(clamped);
      setRawInput(String(clamped));
    }
  };

  const computeDebounced = useCallback((savedDays: number, src: SaveSource) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // savedDays = target remaining days (slider value IS the remaining target)
    const targetTotal = savedDays;
    if (targetTotal === current.currentTotal) {
      setProposal(null);
      setComputing(false);
      return;
    }
    setComputing(true);
    debounceRef.current = setTimeout(() => {
      const result = computeProposal(
        parents, constants, transfer,
        targetTotal,
        blocks, current.currentTotal,
        src
      );
      setProposal(result);
      setComputing(false);
    }, 250);
  }, [parents, constants, transfer, blocks, maxDays, current.currentTotal]);

  useEffect(() => {
    computeDebounced(targetDays, source);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [targetDays, source, computeDebounced]);

  const overLimitError = targetDays > maxDays
    ? "Du kan inte spara fler dagar än du har totalt"
    : null;

  const handleApply = () => {
    if (!proposal || overLimitError) return;
    // Blocks are already canonicalized by adjustToTarget — pass directly
    onApply(proposal.newBlocks);
    onOpenChange(false);

    // Notify if result differs from requested target
    if (proposal.newTotal !== targetDays) {
      toast({
        title: "Sparade dagar justerades",
        description: `Du valde ${targetDays} dagar, men närmaste möjliga blev ${proposal.newTotal} dagar.`,
        duration: 5000,
      });
    }
  };

  const sourceOptions: { value: SaveSource; label: string }[] = [
    ...parents.map(p => ({ value: p.id as SaveSource, label: p.name })),
    { value: "both" as SaveSource, label: "Båda (rekommenderas)" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Sparade dagar</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 py-4 overflow-y-auto">
          {/* Manual edits note */}
          {hasManualEdits && (
            <div className="border border-border rounded-lg p-3 bg-muted/30 text-xs text-muted-foreground">
              Du har justerat planen manuellt. Vi försöker nu hålla ändringen så nära din plan som möjligt.
            </div>
          )}

          {/* Current breakdown */}
          <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
            <p className="text-sm font-medium">Ni har just nu:</p>
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>{current.remainingSickness} sjukpenningdagar</p>
              <p>{current.remainingLowest} lägstanivådagar</p>
            </div>
            <p className="text-sm font-semibold">= {current.currentTotal} dagar totalt</p>
          </div>

          {/* Source selector */}
          <div className="space-y-2">
            <Label>Justera dagar från</Label>
            <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
              {sourceOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSource(opt.value)}
                  className={`flex-1 text-sm rounded-md px-2 py-1.5 transition-colors ${
                    source === opt.value
                      ? "bg-background text-foreground shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target input */}
          <div className="space-y-3">
            <Label htmlFor="target-days-input">Hur många dagar vill du spara?</Label>
            <Input
              id="target-days-input"
              type="number"
              min={0}
              max={maxDays}
              value={rawInput}
              onChange={(e) => {
                setRawInput(e.target.value);
                applyValue(Number(e.target.value));
              }}
              onBlur={() => setRawInput(String(targetDays))}
            />
            <Slider
              min={0}
              max={maxDays}
              step={1}
              value={[targetDays]}
              onValueChange={([v]) => {
                setTargetDays(v);
                setRawInput(String(v));
                setClampHint(null);
              }}
            />
            {clampHint ? (
              <p className="text-xs text-destructive">{clampHint}</p>
            ) : overLimitError ? (
              <p className="text-xs text-destructive">{overLimitError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                0 – {maxDays} dagar
              </p>
            )}
          </div>

          {/* Proposal preview */}
          {computing ? (
            <p className="text-sm text-muted-foreground italic animate-pulse">
              Beräknar…
            </p>
          ) : proposal ? (
            <div className="space-y-4">
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
              <p className="text-sm font-medium">
                  {proposal.deltaDays > 0 ? "För att spara fler dagar föreslår vi:" : "För att ta ut fler dagar föreslår vi:"}
                </p>
                {proposal.summary && proposal.summary.weeksAffectedTotal > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Minska uttaget med 1 dag/vecka i {proposal.summary.weeksAffectedTotal} veckor
                    {proposal.summary.startDateOfReduction ? ` från ${proposal.summary.startDateOfReduction}` : ""}.
                  </p>
                ) : (
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Justera uttagstakten i planen.</li>
                  </ul>
                )}
              </div>

              <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                <p className="text-sm font-medium">Efter ändring:</p>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <p>{proposal.newSickness} sjukpenningdagar kvar</p>
                  <p>{proposal.newLowest} lägstanivådagar kvar</p>
                </div>
                <p className="text-sm font-semibold">= {proposal.newTotal} totalt</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="border border-border rounded-lg p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Sparade dagar efter ändring</p>
                  <p className="text-lg font-bold text-primary">
                    {proposal.newTotal}
                  </p>
                </div>
                <div className="border border-border rounded-lg p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Ersättning/mån</p>
                  <p className="text-lg font-bold">
                    {proposal.deltaMonthly >= 0 ? "+" : ""}
                    {proposal.deltaMonthly.toLocaleString()} kr
                  </p>
                </div>
              </div>
            </div>
          ) : targetDays === currentSavedDays ? (
            <p className="text-sm text-muted-foreground italic">
              Flytta reglaget för att justera antal sparade dagar.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Flytta reglaget för att justera antal sparade dagar.
            </p>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!proposal || !!overLimitError} onClick={handleApply}>
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

export default SaveDaysDrawer;
