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
import { generateBlockId } from "@/lib/blockIdUtils";
import { normalizeBlocks } from "@/lib/normalizeBlocks";

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

type ChangeEntry = {
  parentName: string;
  oldDpw: number;
  newDpw: number;
  fromDate: string;
};

type Proposal = {
  newBlocks: Block[];
  changes: ChangeEntry[];
  newSickness: number;
  newLowest: number;
  newTotal: number;
  deltaDays: number;
  deltaMonthly: number;
  newEndDate: string;
  direction: "save" | "use";
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

/**
 * Detect baseline daysPerWeek for a parent.
 * Returns the most common dpw value across their blocks (weighted by calendar days).
 */
function detectBaseline(blocks: Block[], parentId: string): number {
  const parentBlocks = blocks.filter(b => b.parentId === parentId);
  if (parentBlocks.length === 0) return 6;
  const dpwWeight = new Map<number, number>();
  for (const b of parentBlocks) {
    const days = calendarDaysOf(b);
    dpwWeight.set(b.daysPerWeek, (dpwWeight.get(b.daysPerWeek) ?? 0) + days);
  }
  let best = 6;
  let bestWeight = 0;
  for (const [dpw, weight] of dpwWeight) {
    if (weight > bestWeight) {
      best = dpw;
      bestWeight = weight;
    }
  }
  // Default to 6 unless the dominant value is clearly 7 (>80% of calendar time)
  const totalWeight = Array.from(dpwWeight.values()).reduce((s, w) => s + w, 0);
  if (best === 7 && bestWeight / totalWeight < 0.8) return 6;
  return best;
}

// ── V2 reduce: save more days by lowering dpw from the LATEST blocks ──

function reduceBlocksV2(
  working: Block[],
  needed: number,
  allowedParentIds: Set<string>,
  parents: Parent[],
  baselines: Map<string, number>,
): { freed: number; changes: ChangeEntry[] } {
  let freed = 0;
  const changes: ChangeEntry[] = [];
  let iterations = 0;

  while (freed < needed && iterations < 30) {
    iterations++;
    // Sort candidates: latest startDate first, then longest block
    const candidates = working
      .filter(b => b.daysPerWeek > 0 && allowedParentIds.has(b.parentId))
      .map(b => ({ block: b, calendarDays: calendarDaysOf(b) }))
      .sort((a, b) => b.block.startDate.localeCompare(a.block.startDate) || b.calendarDays - a.calendarDays);

    if (candidates.length === 0) break;

    const target = candidates[0].block;
    const calDays = candidates[0].calendarDays;
    const baseline = baselines.get(target.parentId) ?? 6;

    // Don't go below 0
    if (target.daysPerWeek <= 0) break;

    // Prefer staying in baseline-1 range (e.g. 6→5)
    const newDpw = target.daysPerWeek - 1;
    const potentialSaved = Math.floor(calDays / 7);
    if (potentialSaved <= 0) break;

    const still = needed - freed;
    const parentName = parents.find(p => p.id === target.parentId)?.name ?? "";

    if (potentialSaved <= still) {
      changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw, fromDate: target.startDate });
      target.daysPerWeek = newDpw;
      freed += potentialSaved;
    } else {
      // Split: only reduce the TAIL portion (latest weeks)
      const weeksNeeded = still;
      const splitDayOffset = calDays - weeksNeeded * 7;
      if (splitDayOffset <= 0) {
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw, fromDate: target.startDate });
        target.daysPerWeek = newDpw;
        freed += potentialSaved;
      } else {
        const splitDate = addDaysISO(target.startDate, splitDayOffset);
        const newBlock: Block = {
          id: generateBlockId("adj-save"),
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: newDpw,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw, fromDate: splitDate });
        target.endDate = addDaysISO(splitDate, -1);
        working.push(newBlock);
        freed += weeksNeeded;
      }
    }
  }

  return { freed, changes };
}

// ── V2 increase: use more days by raising dpw, cap at baseline ──

function increaseBlocksV2(
  working: Block[],
  needed: number,
  allowedParentIds: Set<string>,
  parents: Parent[],
  baselines: Map<string, number>,
): { consumed: number; changes: ChangeEntry[] } {
  let consumed = 0;
  const changes: ChangeEntry[] = [];
  let iterations = 0;

  while (consumed < needed && iterations < 30) {
    iterations++;
    // Only allow increasing UP TO baseline — never above it
    const candidates = working
      .filter(b => {
        const baseline = baselines.get(b.parentId) ?? 6;
        return b.daysPerWeek < baseline && allowedParentIds.has(b.parentId);
      })
      .map(b => ({ block: b, calendarDays: calendarDaysOf(b) }))
      .sort((a, b) => b.block.startDate.localeCompare(a.block.startDate) || b.calendarDays - a.calendarDays);

    if (candidates.length === 0) break; // Hard stop — do NOT exceed baseline

    const target = candidates[0].block;
    const calDays = candidates[0].calendarDays;
    const newDpw = target.daysPerWeek + 1;
    const potentialConsumed = Math.floor(calDays / 7);
    if (potentialConsumed <= 0) break;

    const still = needed - consumed;
    const parentName = parents.find(p => p.id === target.parentId)?.name ?? "";

    if (potentialConsumed <= still) {
      changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw, fromDate: target.startDate });
      target.daysPerWeek = newDpw;
      consumed += potentialConsumed;
    } else {
      // Split: only increase the TAIL portion (latest weeks)
      const weeksNeeded = still;
      const splitDayOffset = calDays - weeksNeeded * 7;
      if (splitDayOffset <= 0) {
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw, fromDate: target.startDate });
        target.daysPerWeek = newDpw;
        consumed += potentialConsumed;
      } else {
        const splitDate = addDaysISO(target.startDate, splitDayOffset);
        const tailBlock: Block = {
          id: generateBlockId("adj-use"),
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: newDpw,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw, fromDate: splitDate });
        target.endDate = addDaysISO(splitDate, -1);
        working.push(tailBlock);
        consumed += weeksNeeded;
      }
    }
  }

  return { consumed, changes };
}

// ── compute proposal (bidirectional) ──

function computeProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  transfer: Props["transfer"],
  targetTotal: number,
  current: CurrentState,
  source: SaveSource,
): Proposal | null {
  const delta = targetTotal - current.currentTotal;
  if (delta === 0 || blocks.length === 0) return null;

  const transfers = getTransfers(transfer);
  const working = blocks.map(b => ({ ...b }));
  let allChanges: ChangeEntry[] = [];
  const direction: "save" | "use" = delta > 0 ? "save" : "use";
  const absDelta = Math.abs(delta);

  // Detect baselines per parent
  const baselines = new Map<string, number>();
  for (const p of parents) {
    baselines.set(p.id, detectBaseline(blocks, p.id));
  }

  const doAdjust = (amount: number, parentIds: Set<string>) => {
    if (direction === "save") {
      return reduceBlocksV2(working, amount, parentIds, parents, baselines);
    } else {
      return increaseBlocksV2(working, amount, parentIds, parents, baselines);
    }
  };

  if (source === "both" && parents.length >= 2) {
    const halfA = Math.round(absDelta / 2);
    const halfB = absDelta - halfA;
    const parentIds = parents.map(p => p.id);

    const r1 = doAdjust(halfA, new Set([parentIds[0]]));
    allChanges.push(...r1.changes);
    const r2 = doAdjust(halfB, new Set([parentIds[1]]));
    allChanges.push(...r2.changes);

    const got1 = direction === "save" ? (r1 as any).freed : (r1 as any).consumed;
    const got2 = direction === "save" ? (r2 as any).freed : (r2 as any).consumed;
    const shortfall1 = halfA - (got1 ?? 0);
    const shortfall2 = halfB - (got2 ?? 0);
    if (shortfall1 > 0) {
      const extra = doAdjust(shortfall1, new Set([parentIds[1]]));
      allChanges.push(...extra.changes);
    }
    if (shortfall2 > 0) {
      const extra = doAdjust(shortfall2, new Set([parentIds[0]]));
      allChanges.push(...extra.changes);
    }
  } else if (source === "both") {
    const r = doAdjust(absDelta, new Set(parents.map(p => p.id)));
    allChanges.push(...r.changes);
  } else {
    const r = doAdjust(absDelta, new Set([source]));
    allChanges.push(...r.changes);
  }

  if (allChanges.length === 0) return null;

  // Normalize: merge + absorb micro-blocks
  const normalized = normalizeBlocks(working);
  const sorted = normalized.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const newResult = simulatePlan({ parents, blocks: sorted, transfers, constants });
  const newR = calcRemaining(newResult.parentsResult);
  const newAvg = calcAvgMonthly(newResult.parentsResult);
  const latestEnd = sorted.length > 0
    ? sorted.reduce((max, b) => b.endDate > max ? b.endDate : max, sorted[0].endDate)
    : "";

  return {
    newBlocks: sorted,
    changes: allChanges,
    newSickness: newR.remainingSickness,
    newLowest: newR.remainingLowest,
    newTotal: newR.currentTotal,
    deltaDays: newR.currentTotal - current.currentTotal,
    deltaMonthly: Math.round(newAvg - current.avgMonthly),
    newEndDate: latestEnd,
    direction,
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

  // Debounced proposal computation
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
    onApply(proposal.newBlocks);
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
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  {proposal.changes.map((c, i) => (
                    <li key={i}>
                      {c.newDpw > c.oldDpw ? "Öka" : "Sänk"} uttag för {c.parentName} från {c.oldDpw} till {c.newDpw} dagar/vecka från {c.fromDate}.
                    </li>
                  ))}
                </ul>
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
