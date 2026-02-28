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

type Proposal = {
  newBlocks: Block[];
  description: string;
  newSickness: number;
  newLowest: number;
  newTotal: number;
  deltaDays: number;
  deltaMonthly: number;
  newEndDate: string;
};

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

/** Maximum possible remaining = if all blocks had daysPerWeek=0 */
function calcMaxRemaining(parents: Parent[], constants: Constants, transfer: Props["transfer"]): number {
  const transfers = getTransfers(transfer);
  const result = simulatePlan({ parents, blocks: [], transfers, constants });
  const r = calcRemaining(result.parentsResult);
  return r.currentTotal;
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

/**
 * Compute a block modification proposal to reach a target total remaining days.
 * Reduces daysPerWeek in the tail of the longest block, splitting if needed.
 */
function computeProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  transfer: Props["transfer"],
  targetTotal: number,
  current: CurrentState,
): Proposal | null {
  const extraToSave = targetTotal - current.currentTotal;
  if (extraToSave <= 0 || blocks.length === 0) return null;

  const transfers = getTransfers(transfer);
  let working = blocks.map(b => ({ ...b }));
  let freed = 0;
  let lastChange = { oldDpw: 0, newDpw: 0, fromDate: "", blockParent: "" };
  let iterations = 0;

  while (freed < extraToSave && iterations < 10) {
    iterations++;
    const candidates = working
      .filter(b => b.daysPerWeek > 1)
      .map(b => {
        const days = Math.ceil(
          (new Date(b.endDate + "T00:00:00Z").getTime() - new Date(b.startDate + "T00:00:00Z").getTime()) /
          (1000 * 60 * 60 * 24)
        ) + 1;
        return { block: b, calendarDays: days };
      })
      .sort((a, b) => b.calendarDays - a.calendarDays);

    if (candidates.length === 0) break;

    const target = candidates[0].block;
    const calDays = candidates[0].calendarDays;
    const weeksInBlock = calDays / 7;
    const potentialSaved = Math.floor(weeksInBlock);
    if (potentialSaved <= 0) break;

    const needed = extraToSave - freed;

    if (potentialSaved <= needed) {
      lastChange = { oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek - 1, fromDate: target.startDate, blockParent: target.parentId };
      target.daysPerWeek -= 1;
      freed += potentialSaved;
    } else {
      const weeksNeeded = needed;
      const splitDayOffset = calDays - weeksNeeded * 7;
      if (splitDayOffset <= 0) {
        lastChange = { oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek - 1, fromDate: target.startDate, blockParent: target.parentId };
        target.daysPerWeek -= 1;
        freed += potentialSaved;
      } else {
        const splitDate = addDaysISO(target.startDate, splitDayOffset);
        const newBlock: Block = {
          id: `save-split-${Date.now()}`,
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: target.daysPerWeek - 1,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        target.endDate = addDaysISO(splitDate, -1);
        working.push(newBlock);
        lastChange = { oldDpw: newBlock.daysPerWeek + 1, newDpw: newBlock.daysPerWeek, fromDate: splitDate, blockParent: target.parentId };
        freed += weeksNeeded;
      }
    }
  }

  if (freed <= 0) return null;

  const sorted = working.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const newResult = simulatePlan({ parents, blocks: sorted, transfers, constants });
  const newR = calcRemaining(newResult.parentsResult);
  const newAvg = calcAvgMonthly(newResult.parentsResult);
  const latestEnd = sorted.reduce((max, b) => b.endDate > max ? b.endDate : max, sorted[0].endDate);

  const parentName = parents.find(p => p.id === lastChange.blockParent)?.name ?? "";
  const description = `Sänk uttag för ${parentName} från ${lastChange.oldDpw} till ${lastChange.newDpw} dagar/vecka från ${lastChange.fromDate}.`;

  return {
    newBlocks: sorted,
    description,
    newSickness: newR.remainingSickness,
    newLowest: newR.remainingLowest,
    newTotal: newR.currentTotal,
    deltaDays: newR.currentTotal - current.currentTotal,
    deltaMonthly: Math.round(newAvg - current.avgMonthly),
    newEndDate: latestEnd,
  };
}

const SaveDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const maxRemaining = useMemo(() => calcMaxRemaining(parents, constants, transfer), [parents, constants, transfer]);
  const current = useMemo(() => getCurrentState(blocks, parents, constants, transfer), [blocks, parents, constants, transfer]);

  const [targetDays, setTargetDays] = useState(current.currentTotal);
  const [rawInput, setRawInput] = useState<string>("");
  const [clampHint, setClampHint] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const initial = Math.min(current.currentTotal + 28, maxRemaining);
      setTargetDays(initial);
      setRawInput(String(initial));
      setClampHint(null);
    }
  }, [open, current.currentTotal, maxRemaining]);

  const applyValue = (raw: number) => {
    if (isNaN(raw)) raw = current.currentTotal;
    if (raw > maxRemaining) {
      setClampHint(`Max är ${maxRemaining} med nuvarande plan.`);
      const clamped = maxRemaining;
      setTargetDays(clamped);
      setRawInput(String(clamped));
    } else if (raw < current.currentTotal) {
      setClampHint(`Min är ${current.currentTotal} (nuvarande nivå).`);
      const clamped = current.currentTotal;
      setTargetDays(clamped);
      setRawInput(String(clamped));
    } else {
      setClampHint(null);
      const clamped = Math.floor(raw);
      setTargetDays(clamped);
      setRawInput(String(clamped));
    }
  };

  const proposal = useMemo(
    () => targetDays > current.currentTotal
      ? computeProposal(blocks, parents, constants, transfer, targetDays, current)
      : null,
    [blocks, parents, constants, transfer, targetDays, current],
  );

  const handleApply = () => {
    if (!proposal) return;
    onApply(proposal.newBlocks);
    onOpenChange(false);
  };

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

          {/* Target input */}
          <div className="space-y-3">
            <Label htmlFor="target-days-input">Hur många dagar vill ni ha kvar totalt när planen är slut?</Label>
            <Input
              id="target-days-input"
              type="number"
              min={current.currentTotal}
              max={maxRemaining}
              value={rawInput}
              onChange={(e) => {
                setRawInput(e.target.value);
                applyValue(Number(e.target.value));
              }}
              onBlur={() => {
                setRawInput(String(targetDays));
              }}
            />
            <Slider
              min={current.currentTotal}
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
                Min {current.currentTotal} – Max {maxRemaining}
              </p>
            )}
          </div>

          {/* Proposal preview */}
          {proposal ? (
            <div className="space-y-4">
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <p className="text-sm font-medium">
                  För att ha {targetDays} dagar kvar föreslår vi:
                </p>
                <p className="text-sm text-muted-foreground">{proposal.description}</p>
              </div>

              {/* After-state breakdown */}
              <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                <p className="text-sm font-medium">Efter ändring:</p>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <p>{proposal.newSickness} sjukpenningdagar kvar</p>
                  <p>{proposal.newLowest} lägstanivådagar kvar</p>
                </div>
                <p className="text-sm font-semibold">= {proposal.newTotal} totalt</p>
              </div>

              {/* Delta summary */}
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="border border-border rounded-lg p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Sparade dagar</p>
                  <p className="text-lg font-bold text-primary">+{proposal.deltaDays}</p>
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
          ) : targetDays > current.currentTotal ? (
            <p className="text-sm text-muted-foreground italic">
              Kan inte spara så många dagar med nuvarande plan. Prova ett lägre antal.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Flytta reglaget åt höger för att spara fler dagar.
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
