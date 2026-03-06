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
import { ChevronDown } from "lucide-react";
import { simulatePlan } from "@/lib/simulatePlan";
import { generateBlockId } from "@/lib/blockIdUtils";
import {
  normalizeBlocks,
  applySmartChange,
  proposeEvenSpreadReduction,
  MIN_AUTO_DPW,
  type Block,
  type ReductionSummary,
} from "@/lib/adjustmentPolicy";
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
  direction: "save" | "use";
  debugBefore: Block[];
  debugAfter: Block[];
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

function calendarDaysOf(b: Block): number {
  return diffDaysInclusive(b.startDate, b.endDate);
}

// ── computeProposal: stateless, always derives from scratch ──

function computeProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  transfer: Props["transfer"],
  targetTotal: number,
  current: CurrentState,
  source: SaveSource,
): Proposal | null {
  if (blocks.length === 0) return null;
  const transfers = getTransfers(transfer);

  // Detect the original baseline dpw per block (the dpw the block "wants" to be at)
  // We derive this from the block's own dpw as the ceiling — we never go above it
  // and we never go below MIN_AUTO_DPW.
  // Strategy: binary-search the number of weeks to reduce/increase to hit targetTotal.
  // We always start fresh from the current blocks (not previous proposals).

  const allowedParentIds: string[] =
    source === "both" ? parents.map(p => p.id) : [source as string];

  // Try reducing (saving more days) or increasing (using more days) from current blocks
  const delta = targetTotal - current.currentTotal;
  if (delta === 0) return null;

  const direction: "save" | "use" = delta > 0 ? "save" : "use";
  const absDelta = Math.abs(delta);
  const debugBefore = blocks.map(b => ({ ...b }));

  let resultBlocks: Block[];
  let summary: ReductionSummary | null = null;

  if (direction === "save") {
    // Use proposeEvenSpreadReduction (already stateless — takes current blocks as input)
    if (source === "both" && parents.length >= 2) {
      const halfA = Math.round(absDelta / 2);
      const halfB = absDelta - halfA;
      const r1 = proposeEvenSpreadReduction({ plan: blocks, parentScope: [parents[0].id], daysToReduce: halfA });
      const r2 = proposeEvenSpreadReduction({ plan: r1.nextBlocks, parentScope: [parents[1].id], daysToReduce: halfB });
      resultBlocks = r2.nextBlocks;
      const allPerParent = [...r1.summary.perParent, ...r2.summary.perParent];
      summary = {
        weeksAffectedTotal: allPerParent.reduce((s, p) => s + p.weeksAffected, 0),
        reductionPerWeek: 1,
        startDateOfReduction: [r1.summary.startDateOfReduction, r2.summary.startDateOfReduction].filter(Boolean).sort()[0] ?? null,
        endDateOfReduction: [r1.summary.endDateOfReduction, r2.summary.endDateOfReduction].filter(Boolean).sort().reverse()[0] ?? null,
        perParent: allPerParent,
      };
    } else {
      const r = proposeEvenSpreadReduction({ plan: blocks, parentScope: allowedParentIds, daysToReduce: absDelta });
      resultBlocks = r.nextBlocks;
      summary = r.summary;
    }
  } else {
    // USE direction: raise dpw back toward baseline
    // Baseline per block = the MAXIMUM dpw seen for that parent across all current blocks
    const baselineDpw = new Map<string, number>();
    for (const p of parents) {
      const parentBlocks = blocks.filter(b => b.parentId === p.id);
      if (parentBlocks.length === 0) continue;
      baselineDpw.set(p.id, Math.max(...parentBlocks.map(b => b.daysPerWeek)));
    }

    const working = blocks.map(b => ({ ...b }));
    let stillNeeded = absDelta;
    let safetyLimit = 20;

    while (stillNeeded > 0 && safetyLimit-- > 0) {
      // Find blocks below their baseline among allowed parents
      const candidates = working
        .filter(b => {
          const baseline = baselineDpw.get(b.parentId) ?? 6;
          return allowedParentIds.includes(b.parentId) && b.daysPerWeek < baseline;
        })
        .sort((a, b) => a.startDate.localeCompare(b.startDate)); // earliest first

      if (candidates.length === 0) break;

      // Find the lowest dpw among candidates (raise the lowest first for smoothest result)
      const minDpw = Math.min(...candidates.map(b => b.daysPerWeek));
      const atMinLevel = candidates.filter(b => b.daysPerWeek === minDpw);

      for (const target of atMinLevel) {
        if (stillNeeded <= 0) break;
        const blockWeeks = Math.floor(diffDaysInclusive(target.startDate, target.endDate) / 7);
        if (blockWeeks <= 0) continue;
        const newDpw = target.daysPerWeek + 1;
        const weeksToRaise = Math.min(stillNeeded, blockWeeks);

        if (weeksToRaise >= blockWeeks) {
          target.daysPerWeek = newDpw;
        } else {
          // Split: raise the tail
          const headDays = (blockWeeks - weeksToRaise) * 7;
          const splitDate = addDays(target.startDate, headDays);
          working.push({
            id: generateBlockId("adj-use"),
            parentId: target.parentId,
            startDate: splitDate,
            endDate: target.endDate,
            daysPerWeek: newDpw,
            lowestDaysPerWeek: target.lowestDaysPerWeek,
            overlapGroupId: target.overlapGroupId,
          });
          target.endDate = addDays(splitDate, -1);
        }
        stillNeeded -= weeksToRaise;
      }
    }
    resultBlocks = normalizeBlocks(working);
  }

  if (!resultBlocks || resultBlocks.length === 0) return null;
  const sorted = resultBlocks.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const newResult = simulatePlan({ parents, blocks: sorted, transfers, constants });
  const newR = calcRemaining(newResult.parentsResult);
  const newAvg = calcAvgMonthly(newResult.parentsResult);
  const latestEnd = sorted.reduce((max, b) => b.endDate > max ? b.endDate : max, sorted[0].endDate);

  return {
    newBlocks: sorted,
    summary,
    newSickness: newR.remainingSickness,
    newLowest: newR.remainingLowest,
    newTotal: newR.currentTotal,
    deltaDays: newR.currentTotal - current.currentTotal,
    deltaMonthly: Math.round(newAvg - current.avgMonthly),
    newEndDate: latestEnd,
    direction,
    debugBefore,
    debugAfter: sorted,
  };
}

// ── component ──

const SaveDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply, hasManualEdits }: Props) => {
  const maxRemaining = useMemo(() => calcMaxRemaining(parents, constants, transfer), [parents, constants, transfer]);
  const current = useMemo(() => getCurrentState(blocks, parents, constants, transfer), [blocks, parents, constants, transfer]);

  const [targetDays, setTargetDays] = useState(current.currentTotal);
  const [rawInput, setRawInput] = useState<string>("");
  const [clampHint, setClampHint] = useState<string | null>(null);
  const [source, setSource] = useState<SaveSource>("both");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [computing, setComputing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setTargetDays(current.currentTotal);
      setRawInput(String(current.currentTotal));
      setClampHint(null);
      setSource("both");
      setProposal(null);
      setComputing(false);
    }
  }, [open, current.currentTotal]);

  const applyValue = (raw: number) => {
    if (isNaN(raw)) raw = current.currentTotal;
    if (raw > maxRemaining) {
      setClampHint(`Max är ${maxRemaining}.`);
      setTargetDays(maxRemaining);
      setRawInput(String(maxRemaining));
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

  const computeDebounced = useCallback((target: number, src: SaveSource) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (target === current.currentTotal) {
      setProposal(null);
      setComputing(false);
      return;
    }
    setComputing(true);
    debounceRef.current = setTimeout(() => {
      const result = computeProposal(blocks, parents, constants, transfer, target, current, src);
      setProposal(result);
      setComputing(false);
    }, 250);
  }, [blocks, parents, constants, transfer, current]);

  useEffect(() => {
    computeDebounced(targetDays, source);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [targetDays, source, computeDebounced]);

  const handleApply = () => {
    if (!proposal) return;
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
            <Label htmlFor="target-days-input">Hur många dagar vill ni ha kvar totalt?</Label>
            <Input
              id="target-days-input"
              type="number"
              min={0}
              max={maxRemaining}
              value={rawInput}
              onChange={(e) => {
                setRawInput(e.target.value);
                applyValue(Number(e.target.value));
              }}
              onBlur={() => setRawInput(String(targetDays))}
            />
            <Slider
              min={0}
              max={maxRemaining}
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
            ) : (
              <p className="text-xs text-muted-foreground">
                0 – {maxRemaining} dagar
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
                  {proposal.direction === "save"
                    ? "För att spara fler dagar föreslår vi:"
                    : "För att ta ut fler dagar tidigare föreslår vi:"}
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
                  <p className="text-xs text-muted-foreground">Ändring i sparade dagar</p>
                  <p className="text-lg font-bold text-primary">
                    {proposal.deltaDays >= 0 ? "+" : ""}{proposal.deltaDays}
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

              {/* DEBUG (policy) */}
              <details className="border-t border-border pt-4">
                <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none">
                  <ChevronDown className="h-3 w-3" />
                  DEBUG (policy)
                </summary>
                <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-3 space-y-3 font-mono text-[10px] text-muted-foreground max-h-60 overflow-y-auto">
                  <div>
                    <p className="font-semibold text-foreground/70">Blocks BEFORE normalize ({proposal.debugBefore.length})</p>
                    {proposal.debugBefore.map((b, i) => (
                      <p key={i}>{b.id.slice(0,12)} | {b.parentId} | {b.startDate}→{b.endDate} | dpw={b.daysPerWeek}</p>
                    ))}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground/70">Blocks AFTER normalize ({proposal.debugAfter.length})</p>
                    {proposal.debugAfter.map((b, i) => (
                      <p key={i}>{b.id.slice(0,12)} | {b.parentId} | {b.startDate}→{b.endDate} | dpw={b.daysPerWeek}</p>
                    ))}
                  </div>
                  {proposal.summary && (
                    <div>
                      <p className="font-semibold text-foreground/70">Proposal Summary</p>
                      <p>weeksAffectedTotal = {proposal.summary.weeksAffectedTotal}</p>
                      <p>reductionPerWeek = {proposal.summary.reductionPerWeek}</p>
                      <p>startDateOfReduction = {proposal.summary.startDateOfReduction ?? "—"}</p>
                      <p>endDateOfReduction = {proposal.summary.endDateOfReduction ?? "—"}</p>
                      <p>MIN_AUTO_DPW = {MIN_AUTO_DPW}</p>
                      {proposal.summary.perParent.map((pp, i) => (
                        <p key={i}>  {pp.parentId}: {pp.weeksAffected}w, {pp.oldDpw}→{pp.newDpw}</p>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </div>
          ) : targetDays === current.currentTotal ? (
            <p className="text-sm text-muted-foreground italic">
              Flytta reglaget för att justera antal sparade dagar.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Kan inte nå målet med nuvarande plan. Prova ett annat värde.
            </p>
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

export default SaveDaysDrawer;
