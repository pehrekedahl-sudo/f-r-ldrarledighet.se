import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  applySmartChange,
  normalizeBlocks,
  
  type Block,
  type ReductionSummary,
} from "@/lib/adjustmentPolicy";
import { addDays, diffDaysInclusive, compareDates } from "@/utils/dateOnly";
import { generateBlockId } from "@/lib/blockIdUtils";

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

// ── Binary-search helper: find daysToReduce such that simulatePlan gives remaining == target ──

/**
 * Directly lower dpw from the end of blocks to save days.
 * Works backwards through the target parent's blocks, reducing dpw by 1
 * for as many weeks as needed. Never goes below 1.
 */
function directReduceDpw(opts: {
  originalBlocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Props["transfer"];
  source: SaveSource;
  targetTotal: number;
  originalTotal: number;
}): { blocks: Block[]; summary: ReductionSummary | null } | null {
  const { originalBlocks, parents, source, targetTotal, originalTotal } = opts;
  const allowedParentIds = source === "both" ? parents.map(p => p.id) : [source as string];

  const daysToSave = targetTotal - originalTotal;
  if (daysToSave <= 0) return { blocks: originalBlocks, summary: null };

  const weeksToSave = Math.ceil(daysToSave / 7);

  let weeksLeft = weeksToSave;
  const result = originalBlocks.map(b => ({ ...b })); // deep copy all blocks

  if (source === "both" && parents.length >= 2) {
    // Split evenly: p2 gets extra week if odd
    const p2Weeks = Math.ceil(weeksToSave / 2);
    const p1Weeks = weeksToSave - p2Weeks;

    // Reduce each parent using the same logic as single-parent
    for (const { pid, weeksForParent } of [
      { pid: parents[0].id, weeksForParent: p1Weeks },
      { pid: parents[1].id, weeksForParent: p2Weeks },
    ]) {
      if (weeksForParent <= 0) continue;
      const affectedBlocks = originalBlocks
        .filter(b => b.parentId === pid && !b.isOverlap && b.daysPerWeek > 1)
        .sort((a, b) => compareDates(b.endDate, a.endDate));

      let wl = weeksForParent;
      for (const block of affectedBlocks) {
        if (wl <= 0) break;
        const blockWeeks = Math.floor(diffDaysInclusive(block.startDate, block.endDate) / 7);
        if (blockWeeks <= 0) continue;
        const weeksToReduce = Math.min(wl, blockWeeks);
        const idx = result.findIndex(b => b.id === block.id);
        if (idx === -1) continue;

        if (weeksToReduce >= blockWeeks) {
          result[idx] = { ...result[idx], daysPerWeek: result[idx].daysPerWeek - 1, source: "system" };
        } else {
          const splitDate = addDays(block.endDate, -(weeksToReduce * 7));
          const newDpw = result[idx].daysPerWeek - 1;
          result[idx] = { ...result[idx], endDate: splitDate, source: "system" };
          result.push({
            ...block,
            id: generateBlockId("save-red"),
            startDate: addDays(splitDate, 1),
            endDate: block.endDate,
            daysPerWeek: newDpw,
            source: "system",
          });
        }
        wl -= weeksToReduce;
      }
    }
  } else {
    // Single parent: original logic
    const affectedBlocks = originalBlocks
      .filter(b => allowedParentIds.includes(b.parentId) && !b.isOverlap && b.daysPerWeek > 1)
      .sort((a, b) => compareDates(b.endDate, a.endDate));

    for (const block of affectedBlocks) {
      if (weeksLeft <= 0) break;

      const blockWeeks = Math.floor(diffDaysInclusive(block.startDate, block.endDate) / 7);
      if (blockWeeks <= 0) continue;

      const weeksToReduce = Math.min(weeksLeft, blockWeeks);
      const idx = result.findIndex(b => b.id === block.id);

      if (weeksToReduce >= blockWeeks) {
        result[idx] = { ...result[idx], daysPerWeek: block.daysPerWeek - 1, source: "system" };
      } else {
        const splitDate = addDays(block.endDate, -(weeksToReduce * 7));
        result[idx] = { ...result[idx], endDate: splitDate, source: "system" };
        result.push({
          ...block,
          id: generateBlockId("save-red"),
          startDate: addDays(splitDate, 1),
          endDate: block.endDate,
          daysPerWeek: block.daysPerWeek - 1,
          source: "system",
        });
      }
      weeksLeft -= weeksToReduce;
    }
  }

  return { blocks: result, summary: null };
}

/**
 * Increase dpw (use more days) to reduce remaining total.
 * Raises lowest-dpw blocks first, latest blocks first within each level.
 */
function directIncreaseDpw(opts: {
  originalBlocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Props["transfer"];
  source: SaveSource;
  targetTotal: number;
  originalTotal: number;
}): { blocks: Block[]; summary: ReductionSummary | null } | null {
  const { originalBlocks, parents, constants, transfer, source, targetTotal, originalTotal } = opts;
  const transfers = getTransfers(transfer);
  const allowedParentIds = source === "both" ? parents.map(p => p.id) : [source as string];

  const daysToUse = originalTotal - targetTotal;
  if (daysToUse <= 0) return { blocks: originalBlocks, summary: null };

  const maxCapacity = originalBlocks
    .filter(b => allowedParentIds.includes(b.parentId) && b.daysPerWeek < 7 && !b.isOverlap)
    .reduce((s, b) => s + Math.floor(diffDaysInclusive(b.startDate, b.endDate) / 7) * (7 - b.daysPerWeek), 0);
  if (maxCapacity <= 0) return null;

  let lo = Math.max(0, daysToUse - 20);
  let hi = Math.min(daysToUse + 30, maxCapacity);
  let bestBlocks: Block[] = originalBlocks;
  let bestDiff = Infinity;

  for (let iter = 0; iter < 25; iter++) {
    const mid = Math.round((lo + hi) / 2);
    if (mid <= 0) { lo = 1; continue; }

    const working = originalBlocks.map(b => ({ ...b }));
    let stillNeeded = mid;
    let safetyLimit = 20;

    while (stillNeeded > 0 && safetyLimit-- > 0) {
      const candidates = working
        .filter(b => allowedParentIds.includes(b.parentId) && b.daysPerWeek < 7 && !b.isOverlap)
        .sort((a, b) => compareDates(b.startDate, a.startDate));
      if (candidates.length === 0) break;

      const minDpw = Math.min(...candidates.map(b => b.daysPerWeek));
      const atMinLevel = candidates.filter(b => b.daysPerWeek === minDpw);

      for (const target of atMinLevel) {
        if (stillNeeded <= 0) break;
        const blockWeeks = Math.floor(diffDaysInclusive(target.startDate, target.endDate) / 7);
        if (blockWeeks <= 0) continue;
        const weeksToRaise = Math.min(stillNeeded, blockWeeks);
        if (weeksToRaise >= blockWeeks) {
          target.daysPerWeek = target.daysPerWeek + 1;
          target.source = "system";
        } else {
          const headDays = (blockWeeks - weeksToRaise) * 7;
          const splitDate = addDays(target.startDate, headDays);
          working.push({
            id: generateBlockId("adj-use"),
            parentId: target.parentId,
            startDate: splitDate,
            endDate: target.endDate,
            daysPerWeek: target.daysPerWeek + 1,
            lowestDaysPerWeek: target.lowestDaysPerWeek,
            overlapGroupId: target.overlapGroupId,
            source: "system",
          });
          target.endDate = addDays(splitDate, -1);
          target.source = "system";
        }
        stillNeeded -= weeksToRaise;
      }
    }

    const candidateBlocks = normalizeBlocks(working);
    const simResult = simulatePlan({ parents, blocks: candidateBlocks, transfers, constants });
    const remaining = calcRemaining(simResult.parentsResult).currentTotal;
    const diff = remaining - targetTotal;

    if (Math.abs(diff) < Math.abs(bestDiff)) {
      bestDiff = diff;
      bestBlocks = candidateBlocks;
    }
    if (diff === 0) break;
    if (diff < 0) hi = mid - 1;
    else lo = mid + 1;
  }

  return { blocks: bestBlocks, summary: null };
}

function computeProposal(
  parents: Parent[],
  constants: Constants,
  transfer: Props["transfer"],
  targetTotal: number,
  originalBlocks: Block[],
  originalTotal: number,
  source: SaveSource,
): Proposal | null {
  if (originalBlocks.length === 0) return null;
  const transfers = getTransfers(transfer);

  if (targetTotal === originalTotal) return null;

  if (targetTotal < originalTotal) {
    // Användaren vill använda fler dagar (färre kvar) → öka dpw
    const searched = directIncreaseDpw({
      originalBlocks, parents, constants, transfer, source, targetTotal, originalTotal
    });
    if (!searched) return null;
    const resultBlocks = searched.blocks;
    const newResult = simulatePlan({ parents, blocks: resultBlocks, transfers, constants });
    const newR = calcRemaining(newResult.parentsResult);
    const newAvg = calcAvgMonthly(newResult.parentsResult);
    const origResult = simulatePlan({ parents, blocks: originalBlocks, transfers, constants });
    const origAvg = calcAvgMonthly(origResult.parentsResult);
    const latestEnd = resultBlocks.length > 0
      ? resultBlocks.reduce((max, b) => b.endDate > max ? b.endDate : max, resultBlocks[0].endDate)
      : "";
    return {
      newBlocks: resultBlocks,
      summary: searched.summary,
      newSickness: newR.remainingSickness,
      newLowest: newR.remainingLowest,
      newTotal: newR.currentTotal,
      deltaDays: newR.currentTotal - originalTotal,
      deltaMonthly: Math.round(newAvg - origAvg),
      newEndDate: latestEnd,
      direction: "save",
    };
  }

  // targetTotal > originalTotal: användaren vill spara fler dagar (fler kvar) → minska dpw

  const searched = directReduceDpw({
    originalBlocks, parents, constants, transfer, source, targetTotal, originalTotal
  });
  if (!searched) return null;

  const resultBlocks = searched.blocks;
  const summary = searched.summary;

  const newResult = simulatePlan({ parents, blocks: resultBlocks, transfers, constants });
  const newR = calcRemaining(newResult.parentsResult);
  const newAvg = calcAvgMonthly(newResult.parentsResult);
  const origResult = simulatePlan({ parents, blocks: originalBlocks, transfers, constants });
  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const latestEnd = resultBlocks.length > 0
    ? resultBlocks.reduce((max, b) => b.endDate > max ? b.endDate : max, resultBlocks[0].endDate)
    : "";

  return {
    newBlocks: resultBlocks,
    summary,
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

  const currentSavedDays = Math.max(0, maxDays - current.currentTotal);

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
    const targetTotal = maxDays - savedDays;
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
    const final = applySmartChange(blocks, proposal.newBlocks);
    onApply(final);
    onOpenChange(false);
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
                  {proposal.deltaDays < 0 ? "För att ta ut fler dagar föreslår vi:" : "För att spara fler dagar föreslår vi:"}
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
                    {maxDays - proposal.newTotal}
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
