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

/**
 * Algorithm: to save X extra days, reduce daysPerWeek by 1 in the tail end
 * of the longest block, splitting it if needed. Works backward from latest blocks.
 */
function computeProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  transfer: Props["transfer"],
  targetSavedDays: number,
): { newBlocks: Block[]; description: string; savedDays: number; deltaMonthly: number; newEndDate: string } | null {
  if (targetSavedDays <= 0 || blocks.length === 0) return null;

  // Count current taken days
  const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
  const currentResult = simulatePlan({ parents, blocks, transfers, constants });
  const currentTaken = currentResult.parentsResult.reduce(
    (s, pr) => s + pr.taken.sickness + pr.taken.lowest, 0
  );
  const currentMonthly = (() => {
    const allM = currentResult.parentsResult.flatMap(pr => pr.monthlyBreakdown);
    const total = allM.reduce((s, m) => s + m.grossAmount, 0);
    const months = allM.filter(m => m.grossAmount > 0).length;
    return months > 0 ? total / months : 0;
  })();

  // Strategy: find the longest block, split its tail to reduce daysPerWeek by 1
  // Repeat until we've freed enough days
  let working = blocks.map(b => ({ ...b }));
  let freed = 0;
  let lastChange = { oldDpw: 0, newDpw: 0, fromDate: "", blockParent: "" };
  let iterations = 0;

  while (freed < targetSavedDays && iterations < 10) {
    iterations++;
    // Find longest block by calendar days with dpw > 1
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

    // How many withdrawal days does reducing dpw by 1 save per week?
    const weeksInBlock = calDays / 7;
    const potentialSaved = Math.floor(weeksInBlock);

    if (potentialSaved <= 0) break;

    const needed = targetSavedDays - freed;

    if (potentialSaved <= needed) {
      // Reduce entire block by 1 dpw
      lastChange = {
        oldDpw: target.daysPerWeek,
        newDpw: target.daysPerWeek - 1,
        fromDate: target.startDate,
        blockParent: target.parentId,
      };
      target.daysPerWeek -= 1;
      freed += potentialSaved;
    } else {
      // Split block: keep first part at current dpw, reduce tail
      const weeksNeeded = needed;
      const splitDayOffset = calDays - weeksNeeded * 7;
      if (splitDayOffset <= 0) {
        lastChange = {
          oldDpw: target.daysPerWeek,
          newDpw: target.daysPerWeek - 1,
          fromDate: target.startDate,
          blockParent: target.parentId,
        };
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
        lastChange = {
          oldDpw: newBlock.daysPerWeek + 1,
          newDpw: newBlock.daysPerWeek,
          fromDate: splitDate,
          blockParent: target.parentId,
        };
        freed += weeksNeeded;
      }
    }
  }

  if (freed <= 0) return null;

  // Simulate with new blocks
  const sorted = working.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const newResult = simulatePlan({ parents, blocks: sorted, transfers, constants });
  const newTaken = newResult.parentsResult.reduce(
    (s, pr) => s + pr.taken.sickness + pr.taken.lowest, 0
  );
  const newMonthly = (() => {
    const allM = newResult.parentsResult.flatMap(pr => pr.monthlyBreakdown);
    const total = allM.reduce((s, m) => s + m.grossAmount, 0);
    const months = allM.filter(m => m.grossAmount > 0).length;
    return months > 0 ? total / months : 0;
  })();
  const latestEnd = sorted.reduce((max, b) => b.endDate > max ? b.endDate : max, sorted[0].endDate);

  const parentName = parents.find(p => p.id === lastChange.blockParent)?.name ?? "";
  const description = `Sänk uttag för ${parentName} från ${lastChange.oldDpw} till ${lastChange.newDpw} dagar/vecka från ${lastChange.fromDate}.`;

  return {
    newBlocks: sorted,
    description,
    savedDays: freed,
    deltaMonthly: Math.round(newMonthly - currentMonthly),
    newEndDate: latestEnd,
  };
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SaveDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const [extraDays, setExtraDays] = useState(28);

  useEffect(() => {
    if (open) setExtraDays(28);
  }, [open]);

  const proposal = useMemo(
    () => computeProposal(blocks, parents, constants, transfer, extraDays),
    [blocks, parents, constants, transfer, extraDays],
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
          <SheetTitle>Spara fler dagar</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 py-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="save-days-input">Hur många extra dagar vill ni spara?</Label>
            <Input
              id="save-days-input"
              type="number"
              min={1}
              max={200}
              value={extraDays}
              onChange={(e) => setExtraDays(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>

          {proposal ? (
            <div className="space-y-4">
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-3">
                <p className="text-sm font-medium">
                  För att spara {proposal.savedDays} dagar föreslår vi:
                </p>
                <p className="text-sm text-muted-foreground">{proposal.description}</p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="border border-border rounded-lg p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Sparade dagar</p>
                  <p className="text-lg font-bold text-primary">+{proposal.savedDays}</p>
                </div>
                <div className="border border-border rounded-lg p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Ersättning/mån</p>
                  <p className="text-lg font-bold">
                    {proposal.deltaMonthly >= 0 ? "+" : ""}
                    {proposal.deltaMonthly.toLocaleString()} kr
                  </p>
                </div>
                <div className="border border-border rounded-lg p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Nytt slutdatum</p>
                  <p className="text-sm font-bold mt-1">{proposal.newEndDate}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Kan inte spara fler dagar med nuvarande plan. Prova ett lägre antal.
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
