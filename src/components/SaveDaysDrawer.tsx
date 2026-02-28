import { useState, useEffect, useMemo } from "react";
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

function parentOrderByTaken(blocks: Block[], parents: Parent[], constants: Constants, transfer: Props["transfer"], descending: boolean): string[] {
  const transfers = getTransfers(transfer);
  const result = simulatePlan({ parents, blocks, transfers, constants });
  const scored = result.parentsResult.map((pr: any) => ({
    id: pr.parentId,
    taken: pr.taken.sickness + pr.taken.lowest,
  }));
  scored.sort((a: any, b: any) => descending ? b.taken - a.taken : a.taken - b.taken);
  return scored.map((s: any) => s.id);
}

// ── reduce: save more days by lowering dpw ──

function reduceBlocks(
  working: Block[],
  needed: number,
  allowedParentIds: Set<string>,
  parents: Parent[],
): { freed: number; changes: ChangeEntry[] } {
  let freed = 0;
  const changes: ChangeEntry[] = [];
  let iterations = 0;

  while (freed < needed && iterations < 20) {
    iterations++;
    const candidates = working
      .filter(b => b.daysPerWeek > 1 && allowedParentIds.has(b.parentId))
      .map(b => ({ block: b, calendarDays: calendarDaysOf(b) }))
      .sort((a, b) => b.calendarDays - a.calendarDays);

    if (candidates.length === 0) break;

    const target = candidates[0].block;
    const calDays = candidates[0].calendarDays;
    const potentialSaved = Math.floor(calDays / 7);
    if (potentialSaved <= 0) break;

    const still = needed - freed;
    const parentName = parents.find(p => p.id === target.parentId)?.name ?? "";

    if (potentialSaved <= still) {
      changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek - 1, fromDate: target.startDate });
      target.daysPerWeek -= 1;
      freed += potentialSaved;
    } else {
      const weeksNeeded = still;
      const splitDayOffset = calDays - weeksNeeded * 7;
      if (splitDayOffset <= 0) {
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek - 1, fromDate: target.startDate });
        target.daysPerWeek -= 1;
        freed += potentialSaved;
      } else {
        const splitDate = addDaysISO(target.startDate, splitDayOffset);
        const newBlock: Block = {
          id: `adj-split-${Date.now()}-${iterations}`,
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: target.daysPerWeek - 1,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw: newBlock.daysPerWeek, fromDate: splitDate });
        target.endDate = addDaysISO(splitDate, -1);
        working.push(newBlock);
        freed += weeksNeeded;
      }
    }
  }

  return { freed, changes };
}

// ── increase: use more days by raising dpw ──

function increaseBlocks(
  working: Block[],
  needed: number,
  allowedParentIds: Set<string>,
  parents: Parent[],
): { consumed: number; changes: ChangeEntry[] } {
  let consumed = 0;
  const changes: ChangeEntry[] = [];
  let iterations = 0;

  // Sort by start date ascending – increase from earliest blocks first
  while (consumed < needed && iterations < 20) {
    iterations++;
    const candidates = working
      .filter(b => b.daysPerWeek < 7 && allowedParentIds.has(b.parentId))
      .map(b => ({ block: b, calendarDays: calendarDaysOf(b) }))
      .sort((a, b) => a.block.startDate.localeCompare(b.block.startDate) || b.calendarDays - a.calendarDays);

    if (candidates.length === 0) break;

    const target = candidates[0].block;
    const calDays = candidates[0].calendarDays;
    const potentialConsumed = Math.floor(calDays / 7);
    if (potentialConsumed <= 0) break;

    const still = needed - consumed;
    const parentName = parents.find(p => p.id === target.parentId)?.name ?? "";

    if (potentialConsumed <= still) {
      changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek + 1, fromDate: target.startDate });
      target.daysPerWeek += 1;
      consumed += potentialConsumed;
    } else {
      // Split block: increase only head portion
      const weeksNeeded = still;
      const splitDayOffset = weeksNeeded * 7;
      if (splitDayOffset >= calDays) {
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek + 1, fromDate: target.startDate });
        target.daysPerWeek += 1;
        consumed += potentialConsumed;
      } else {
        const splitDate = addDaysISO(target.startDate, splitDayOffset);
        const tailBlock: Block = {
          id: `adj-split-${Date.now()}-${iterations}`,
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: target.daysPerWeek,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        changes.push({ parentName, oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek + 1, fromDate: target.startDate });
        target.endDate = addDaysISO(splitDate, -1);
        target.daysPerWeek += 1;
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

  if (direction === "save") {
    // Reduce dpw to save days
    if (source === "both") {
      const order = parentOrderByTaken(blocks, parents, constants, transfer, true); // highest taken first
      const r1 = reduceBlocks(working, absDelta, new Set([order[0]]), parents);
      allChanges.push(...r1.changes);
      const remaining = absDelta - r1.freed;
      if (remaining > 0 && order.length > 1) {
        const r2 = reduceBlocks(working, remaining, new Set([order[1]]), parents);
        allChanges.push(...r2.changes);
      }
    } else {
      const r = reduceBlocks(working, absDelta, new Set([source]), parents);
      allChanges.push(...r.changes);
    }
  } else {
    // Increase dpw to use more days
    if (source === "both") {
      const order = parentOrderByTaken(blocks, parents, constants, transfer, false); // lowest taken first
      const r1 = increaseBlocks(working, absDelta, new Set([order[0]]), parents);
      allChanges.push(...r1.changes);
      const remaining = absDelta - r1.consumed;
      if (remaining > 0 && order.length > 1) {
        const r2 = increaseBlocks(working, remaining, new Set([order[1]]), parents);
        allChanges.push(...r2.changes);
      }
    } else {
      const r = increaseBlocks(working, absDelta, new Set([source]), parents);
      allChanges.push(...r.changes);
    }
  }

  if (allChanges.length === 0) return null;

  const sorted = working.sort((a, b) => a.startDate.localeCompare(b.startDate));
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

const SaveDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const maxRemaining = useMemo(() => calcMaxRemaining(parents, constants, transfer), [parents, constants, transfer]);
  const current = useMemo(() => getCurrentState(blocks, parents, constants, transfer), [blocks, parents, constants, transfer]);

  const [targetDays, setTargetDays] = useState(current.currentTotal);
  const [rawInput, setRawInput] = useState<string>("");
  const [clampHint, setClampHint] = useState<string | null>(null);
  const [source, setSource] = useState<SaveSource>("both");

  useEffect(() => {
    if (open) {
      setTargetDays(current.currentTotal);
      setRawInput(String(current.currentTotal));
      setClampHint(null);
      setSource("both");
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

  const proposal = useMemo(
    () => targetDays !== current.currentTotal
      ? computeProposal(blocks, parents, constants, transfer, targetDays, current, source)
      : null,
    [blocks, parents, constants, transfer, targetDays, current, source],
  );

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
          {proposal ? (
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
