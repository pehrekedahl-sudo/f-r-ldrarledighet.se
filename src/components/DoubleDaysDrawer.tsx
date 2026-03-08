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
import { type Block } from "@/lib/adjustmentPolicy";
import { addDays, compareDates } from "@/utils/dateOnly";
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

type Transfer = { fromParentId: string; toParentId: string; sicknessDays: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Transfer | null;
  onApply: (newBlocks: Block[]) => void;
};

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

function calcTotalRemaining(parentsResult: any[]): number {
  return parentsResult.reduce(
    (s: number, pr: any) =>
      s + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest,
    0
  );
}

/** Convert weekdays count to calendar days (5 weekdays = 7 calendar days) */
function weekdaysToCalendarDays(weekdays: number): number {
  const fullWeeks = Math.floor(weekdays / 5);
  const remainder = weekdays % 5;
  return fullWeeks * 7 + remainder;
}

const DoubleDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  // Count existing overlap days
  const existingOverlap = useMemo(() => {
    const overlapBlocks = blocks.filter(b => b.isOverlap);
    if (overlapBlocks.length === 0) return { days: 0, startDate: null as string | null, endDate: null as string | null };
    const start = overlapBlocks.reduce((min, b) => compareDates(b.startDate, min) < 0 ? b.startDate : min, overlapBlocks[0].startDate);
    const end = overlapBlocks.reduce((max, b) => compareDates(b.endDate, max) > 0 ? b.endDate : max, overlapBlocks[0].endDate);
    // Count weekdays in the range (approximate: calendar days * 5/7)
    const calDays = weekdaysToCalendarDays(1); // just for ratio
    const totalCalDays = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const weekdays = Math.round(totalCalDays * 5 / 7);
    return { days: weekdays, startDate: start, endDate: end };
  }, [blocks]);

  // Default start date = plan's first block start
  const planStart = useMemo(() => {
    if (blocks.length === 0) return "";
    return blocks.reduce((min, b) => compareDates(b.startDate, min) < 0 ? b.startDate : min, blocks[0].startDate);
  }, [blocks]);

  const [numDays, setNumDays] = useState(0);
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    if (open) {
      setNumDays(existingOverlap.days || 0);
      setStartDate(existingOverlap.startDate || planStart);
    }
  }, [open, existingOverlap, planStart]);

  // Compute end date from start + numDays weekdays
  const endDate = useMemo(() => {
    if (!startDate || numDays <= 0) return null;
    const calDays = weekdaysToCalendarDays(numDays);
    return addDays(startDate, calDays - 1);
  }, [startDate, numDays]);

  // Build proposal
  const proposal = useMemo(() => {
    if (!startDate || numDays <= 0 || !endDate) return null;
    if (parents.length < 2) return null;

    const groupId = `overlap-${Date.now()}`;
    const nonOverlapBlocks = blocks.filter(b => !b.isOverlap);

    const newOverlapBlocks: Block[] = parents.map(p => ({
      id: generateBlockId("dbl"),
      parentId: p.id,
      startDate,
      endDate,
      daysPerWeek: 5,
      overlapGroupId: groupId,
      isOverlap: true,
    }));

    const proposalBlocks = [...nonOverlapBlocks, ...newOverlapBlocks];

    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    try {
      const currentResult = simulatePlan({ parents, blocks, transfers, constants });
      const proposalResult = simulatePlan({ parents, blocks: proposalBlocks.sort((a, b) => compareDates(a.startDate, b.startDate)), transfers, constants });

      const currentTotal = calcTotalRemaining(currentResult.parentsResult);
      const proposalTotal = calcTotalRemaining(proposalResult.parentsResult);
      const currentAvg = calcAvgMonthly(currentResult.parentsResult);
      const proposalAvg = calcAvgMonthly(proposalResult.parentsResult);

      return {
        blocks: proposalBlocks,
        deltaTotal: Math.round(proposalTotal - currentTotal),
        deltaMonthly: Math.round(proposalAvg - currentAvg),
        startDate,
        endDate,
        numDays,
      };
    } catch {
      return null;
    }
  }, [startDate, numDays, endDate, blocks, parents, constants, transfer]);

  // Proposal for removing all overlap (numDays = 0)
  const removeProposal = useMemo(() => {
    if (numDays > 0) return null;
    if (existingOverlap.days === 0) return null;

    const nonOverlapBlocks = blocks.filter(b => !b.isOverlap);
    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    try {
      const currentResult = simulatePlan({ parents, blocks, transfers, constants });
      const proposalResult = simulatePlan({ parents, blocks: nonOverlapBlocks, transfers, constants });
      const currentTotal = calcTotalRemaining(currentResult.parentsResult);
      const proposalTotal = calcTotalRemaining(proposalResult.parentsResult);
      const currentAvg = calcAvgMonthly(currentResult.parentsResult);
      const proposalAvg = calcAvgMonthly(proposalResult.parentsResult);
      return {
        blocks: nonOverlapBlocks,
        deltaTotal: Math.round(proposalTotal - currentTotal),
        deltaMonthly: Math.round(proposalAvg - currentAvg),
      };
    } catch {
      return null;
    }
  }, [numDays, existingOverlap, blocks, parents, constants, transfer]);

  const handleApply = () => {
    if (numDays === 0 && removeProposal) {
      onApply(removeProposal.blocks);
      onOpenChange(false);
      return;
    }
    if (proposal) {
      onApply(proposal.blocks);
      onOpenChange(false);
    }
  };

  const canApply = (numDays > 0 && proposal) || (numDays === 0 && removeProposal);
  const hasChanged = numDays !== existingOverlap.days || startDate !== (existingOverlap.startDate || planStart);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Dubbeldagar</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 py-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Under dubbeldagar tar båda föräldrarna ut föräldrapenning samtidigt. Max 30 dagar under barnets första levnadsår.
          </p>

          {/* Current status */}
          <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-1">
            <p className="text-sm font-medium">Nuvarande dubbeldagar</p>
            <p className="text-sm text-muted-foreground">
              {existingOverlap.days > 0
                ? `${existingOverlap.days} dagar (${existingOverlap.startDate} – ${existingOverlap.endDate})`
                : "Inga dubbeldagar inlagda"}
            </p>
          </div>

          {/* Number of days */}
          <div className="space-y-2">
            <Label htmlFor="double-days-input">Antal dubbeldagar</Label>
            <Input
              id="double-days-input"
              type="number"
              min={0}
              max={30}
              value={numDays}
              onChange={(e) => setNumDays(Math.max(0, Math.min(30, Math.floor(Number(e.target.value) || 0))))}
            />
            <p className="text-xs text-muted-foreground">Max 30 dagar under barnets första levnadsår.</p>
          </div>

          {/* Start date */}
          <div className="space-y-2">
            <Label htmlFor="double-days-start">Startdatum</Label>
            <Input
              id="double-days-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {/* Live preview */}
          {numDays > 0 && endDate && (
            <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2 text-sm">
              <p className="font-medium">Förhandsgranskning</p>
              <p>Båda tar ut {numDays} dagar, period: {startDate} – {endDate}</p>
              {proposal && (
                <>
                  <p className="text-muted-foreground">
                    Dagar kvar ändras med: {proposal.deltaTotal >= 0 ? "+" : ""}{proposal.deltaTotal} dagar
                  </p>
                  <p className="text-muted-foreground">
                    Snitt/mån ändras med: {proposal.deltaMonthly >= 0 ? "+" : ""}{proposal.deltaMonthly.toLocaleString()} kr/mån
                  </p>
                </>
              )}
            </div>
          )}

          {numDays === 0 && removeProposal && (
            <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2 text-sm">
              <p className="font-medium">Tar bort alla dubbeldagar</p>
              <p className="text-muted-foreground">
                Dagar kvar ändras med: {removeProposal.deltaTotal >= 0 ? "+" : ""}{removeProposal.deltaTotal} dagar
              </p>
              <p className="text-muted-foreground">
                Snitt/mån ändras med: {removeProposal.deltaMonthly >= 0 ? "+" : ""}{removeProposal.deltaMonthly.toLocaleString()} kr/mån
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!canApply || !hasChanged} onClick={handleApply}>
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

export default DoubleDaysDrawer;
