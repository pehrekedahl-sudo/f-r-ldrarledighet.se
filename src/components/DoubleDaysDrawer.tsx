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
import { addDays, compareDates, isoWeekdayIndex } from "@/utils/dateOnly";
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

/**
 * Split a parent's block around the overlap period.
 * Returns up to 3 blocks: before, overlap, after.
 */
function splitBlockForOverlap(
  block: Block,
  overlapStart: string,
  overlapEnd: string,
  overlapDpw: number,
): Block[] {
  const result: Block[] = [];

  // "before" piece: block.startDate to day before overlapStart
  if (compareDates(block.startDate, overlapStart) < 0) {
    result.push({
      ...block,
      id: generateBlockId("split"),
      endDate: addDays(overlapStart, -1),
      isOverlap: undefined,
      overlapGroupId: undefined,
    });
  }

  // "overlap" piece
  result.push({
    id: generateBlockId("dbl"),
    parentId: block.parentId,
    startDate: overlapStart,
    endDate: overlapEnd,
    daysPerWeek: overlapDpw,
    isOverlap: true,
  });

  // "after" piece: day after overlapEnd to block.endDate
  if (compareDates(overlapEnd, block.endDate) < 0) {
    result.push({
      ...block,
      id: generateBlockId("split"),
      startDate: addDays(overlapEnd, 1),
      isOverlap: undefined,
      overlapGroupId: undefined,
    });
  }

  return result;
}

const DoubleDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  // Count existing overlap days
  const existingOverlap = useMemo(() => {
    const overlapBlocks = blocks.filter(b => b.isOverlap);
    if (overlapBlocks.length === 0) return { days: 0, startDate: null as string | null, endDate: null as string | null, daysPerWeek: 5 };
    const start = overlapBlocks.reduce((min, b) => compareDates(b.startDate, min) < 0 ? b.startDate : min, overlapBlocks[0].startDate);
    const end = overlapBlocks.reduce((max, b) => compareDates(b.endDate, max) > 0 ? b.endDate : max, overlapBlocks[0].endDate);
    const totalCalDays = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const weekdays = Math.round(totalCalDays * 5 / 7);
    const dpw = overlapBlocks[0].daysPerWeek;
    return { days: weekdays, startDate: start, endDate: end, daysPerWeek: dpw };
  }, [blocks]);

  // Default start date = plan's first block start
  const planStart = useMemo(() => {
    if (blocks.length === 0) return "";
    return blocks.reduce((min, b) => compareDates(b.startDate, min) < 0 ? b.startDate : min, blocks[0].startDate);
  }, [blocks]);

  const [numDays, setNumDays] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(5);

  useEffect(() => {
    if (open) {
      setNumDays(existingOverlap.days || 0);
      setStartDate(existingOverlap.startDate || planStart);
      setDaysPerWeek(existingOverlap.daysPerWeek || 5);
    }
  }, [open, existingOverlap, planStart]);

  // Compute end date from start + numDays weekdays
  const endDate = useMemo(() => {
    if (!startDate || numDays <= 0) return null;
    const calDays = weekdaysToCalendarDays(numDays);
    return addDays(startDate, calDays - 1);
  }, [startDate, numDays]);

  // Build proposal blocks (with splitting)
  const buildProposalBlocks = useMemo(() => {
    if (!startDate || numDays <= 0 || !endDate) return null;
    if (parents.length < 2) return null;

    // Remove old overlap blocks and any split remnants from previous overlap
    const nonOverlapBlocks = blocks.filter(b => !b.isOverlap);

    const resultBlocks: Block[] = [];

    for (const block of nonOverlapBlocks) {
      // Check if this block's date range intersects the overlap period
      const intersects =
        compareDates(block.startDate, endDate) <= 0 &&
        compareDates(block.endDate, startDate) >= 0;

      if (intersects) {
        // Split this block around the overlap
        resultBlocks.push(...splitBlockForOverlap(block, startDate, endDate, daysPerWeek));
      } else {
        resultBlocks.push(block);
      }
    }

    // Deduplicate: keep only one overlap block per parent
    const overlapParents = new Set<string>();
    const dedupedBlocks: Block[] = [];
    for (const b of resultBlocks) {
      if (b.isOverlap) {
        if (overlapParents.has(b.parentId)) continue;
        overlapParents.add(b.parentId);
      }
      dedupedBlocks.push(b);
    }

    // Ensure both parents have an overlap block
    for (const p of parents) {
      if (!overlapParents.has(p.id)) {
        dedupedBlocks.push({
          id: generateBlockId("dbl"),
          parentId: p.id,
          startDate,
          endDate,
          daysPerWeek,
          isOverlap: true,
        });
      }
    }

    return dedupedBlocks.sort((a, b) => compareDates(a.startDate, b.startDate));
  }, [startDate, numDays, endDate, blocks, parents, daysPerWeek]);

  // Compute simulation delta
  const proposal = useMemo(() => {
    if (!buildProposalBlocks || !endDate) return null;

    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    try {
      const currentResult = simulatePlan({ parents, blocks, transfers, constants });
      const proposalResult = simulatePlan({ parents, blocks: buildProposalBlocks, transfers, constants });

      const currentTotal = calcTotalRemaining(currentResult.parentsResult);
      const proposalTotal = calcTotalRemaining(proposalResult.parentsResult);
      const currentAvg = calcAvgMonthly(currentResult.parentsResult);
      const proposalAvg = calcAvgMonthly(proposalResult.parentsResult);

      return {
        blocks: buildProposalBlocks,
        deltaTotal: Math.round(proposalTotal - currentTotal),
        deltaMonthly: Math.round(proposalAvg - currentAvg),
        startDate,
        endDate,
        numDays,
      };
    } catch {
      return null;
    }
  }, [buildProposalBlocks, endDate, blocks, parents, constants, transfer, startDate, numDays]);

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
  const hasChanged = numDays !== existingOverlap.days || startDate !== (existingOverlap.startDate || planStart) || daysPerWeek !== existingOverlap.daysPerWeek;

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

          {/* Days per week */}
          <div className="space-y-2">
            <Label htmlFor="double-days-dpw">Dagar per vecka</Label>
            <Input
              id="double-days-dpw"
              type="number"
              min={1}
              max={5}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(Math.max(1, Math.min(5, Math.floor(Number(e.target.value) || 5))))}
            />
            <p className="text-xs text-muted-foreground">Sätts för båda föräldrarna samtidigt.</p>
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
              <p>Båda tar ut {numDays} dagar ({daysPerWeek} d/v), period: {startDate} – {endDate}</p>
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
