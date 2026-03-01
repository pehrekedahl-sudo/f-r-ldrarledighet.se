import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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

type ChangeEntry = {
  parentName: string;
  oldDpw: number;
  newDpw: number;
  fromDate: string;
};

type Proposal = {
  newBlocks: Block[];
  changes: ChangeEntry[];
  deltaMonthly: number;
  success: boolean;
};

function getTransfers(transfer: Props["transfer"]) {
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

function computeFitProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  transfer: Props["transfer"],
): Proposal | null {
  if (blocks.length === 0) return null;

  const transfers = getTransfers(transfer);
  const origResult = simulatePlan({ parents, blocks, transfers, constants });
  const origUnfulfilled = origResult.unfulfilledDaysTotal ?? 0;
  if (origUnfulfilled <= 0) return null;

  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const working = blocks.map(b => ({ ...b }));
  const allChanges: ChangeEntry[] = [];

  // Order parents by consumption descending
  const scored = origResult.parentsResult
    .map((pr: any) => ({ id: pr.parentId, taken: pr.taken.sickness + pr.taken.lowest }))
    .sort((a: any, b: any) => b.taken - a.taken);
  const parentOrder = scored.map((s: any) => s.id);

  let iterations = 0;
  for (const pid of parentOrder) {
    let currentUnfulfilled = (() => {
      const r = simulatePlan({ parents, blocks: working, transfers, constants });
      return r.unfulfilledDaysTotal ?? 0;
    })();

    while (currentUnfulfilled > 0 && iterations < 50) {
      iterations++;
      const candidates = working
        .filter(b => b.daysPerWeek > 0 && b.parentId === pid)
        .map(b => ({ block: b, calendarDays: calendarDaysOf(b) }))
        .sort((a, b) => b.calendarDays - a.calendarDays);

      if (candidates.length === 0) break;

      const target = candidates[0].block;
      const calDays = candidates[0].calendarDays;
      const potentialSaved = Math.floor(calDays / 7);
      if (potentialSaved <= 0) break;

      const parentName = parents.find(p => p.id === target.parentId)?.name ?? "";

      if (potentialSaved <= currentUnfulfilled) {
        allChanges.push({ parentName, oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek - 1, fromDate: target.startDate });
        target.daysPerWeek -= 1;
      } else {
        // Split: only reduce the tail portion
        const weeksNeeded = currentUnfulfilled;
        const splitDayOffset = calDays - weeksNeeded * 7;
        if (splitDayOffset <= 0) {
          allChanges.push({ parentName, oldDpw: target.daysPerWeek, newDpw: target.daysPerWeek - 1, fromDate: target.startDate });
          target.daysPerWeek -= 1;
        } else {
          const splitDate = addDaysISO(target.startDate, splitDayOffset);
          const newBlock: Block = {
            id: `fit-split-${Date.now()}-${iterations}`,
            parentId: target.parentId,
            startDate: splitDate,
            endDate: target.endDate,
            daysPerWeek: target.daysPerWeek - 1,
            lowestDaysPerWeek: target.lowestDaysPerWeek,
            overlapGroupId: target.overlapGroupId,
          };
          allChanges.push({ parentName, oldDpw: target.daysPerWeek, newDpw: newBlock.daysPerWeek, fromDate: splitDate });
          target.endDate = addDaysISO(splitDate, -1);
          working.push(newBlock);
        }
      }

      const r = simulatePlan({ parents, blocks: working, transfers, constants });
      currentUnfulfilled = r.unfulfilledDaysTotal ?? 0;
    }
  }

  if (allChanges.length === 0) return null;

  const sorted = working.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const finalResult = simulatePlan({ parents, blocks: sorted, transfers, constants });
  const finalUnfulfilled = finalResult.unfulfilledDaysTotal ?? 0;
  const newAvg = calcAvgMonthly(finalResult.parentsResult);

  return {
    newBlocks: sorted,
    changes: allChanges,
    deltaMonthly: Math.round(newAvg - origAvg),
    success: finalUnfulfilled <= 0,
  };
}

const FitPlanDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [computing, setComputing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setComputing(true);
      setProposal(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const result = computeFitProposal(blocks, parents, constants, transfer);
        setProposal(result);
        setComputing(false);
      }, 100);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, blocks, parents, constants, transfer]);

  const handleApply = () => {
    if (!proposal) return;
    onApply(proposal.newBlocks);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Få planen att gå ihop</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 py-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Vi föreslår minsta möjliga justering för att planen ska räcka hela perioden.
          </p>

          {computing ? (
            <p className="text-sm text-muted-foreground italic animate-pulse">Beräknar…</p>
          ) : proposal ? (
            <div className="space-y-4">
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <p className="text-sm font-medium">Föreslagna ändringar:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  {proposal.changes.map((c, i) => (
                    <li key={i}>
                      Sänk uttag för {c.parentName} från {c.oldDpw} till {c.newDpw} dagar/vecka från {c.fromDate}.
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                <p className="text-sm font-medium">Resultat:</p>
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
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Kunde inte hitta en justering. Planen kanske redan går ihop.
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

export default FitPlanDrawer;
