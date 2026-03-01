import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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

function parseDateUTC(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function toISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = parseDateUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

const HandoverDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const parent1 = parents[0];
  const parent2 = parents[1];

  // Find handover blocks
  const p1Block = useMemo(() => {
    if (!parent1) return null;
    const p1Blocks = blocks.filter(b => b.parentId === parent1.id);
    if (p1Blocks.length === 0) return null;
    return p1Blocks.reduce((max, b) => b.endDate > max.endDate ? b : max);
  }, [blocks, parent1]);

  const p2Block = useMemo(() => {
    if (!parent2) return null;
    const p2Blocks = blocks.filter(b => b.parentId === parent2.id);
    if (p2Blocks.length === 0) return null;
    return p2Blocks.reduce((min, b) => b.startDate < min.startDate ? b : min);
  }, [blocks, parent2]);

  // Current handover date = p2Block.startDate
  const currentHandover = p2Block?.startDate ?? null;

  const [handoverDate, setHandoverDate] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open && currentHandover) {
      setHandoverDate(currentHandover);
    }
  }, [open, currentHandover]);

  // Build proposal
  const proposalResult = useMemo(() => {
    if (!handoverDate || !p1Block || !p2Block || !parent1 || !parent2) return null;

    const newP1End = addDaysISO(handoverDate, -1);
    const newP2Start = handoverDate;

    // Validation
    if (newP1End < p1Block.startDate) return { error: `${parent1.name}s block kan inte sluta före sitt startdatum.` };
    if (newP2Start > p2Block.endDate) return { error: `${parent2.name}s block kan inte börja efter sitt slutdatum.` };

    // Check overlap with other blocks of same parent
    const otherP1 = blocks.filter(b => b.parentId === parent1.id && b.id !== p1Block.id);
    for (const ob of otherP1) {
      if (parseDateUTC(ob.startDate) <= parseDateUTC(newP1End) && parseDateUTC(ob.endDate) >= parseDateUTC(p1Block.startDate)) {
        return { error: `Överlapp med ett annat block för ${parent1.name}.` };
      }
    }
    const otherP2 = blocks.filter(b => b.parentId === parent2.id && b.id !== p2Block.id);
    for (const ob of otherP2) {
      if (parseDateUTC(ob.startDate) <= parseDateUTC(p2Block.endDate) && parseDateUTC(ob.endDate) >= parseDateUTC(newP2Start)) {
        return { error: `Överlapp med ett annat block för ${parent2.name}.` };
      }
    }

    // Build proposal blocks
    const newBlocks = blocks.map(b => {
      if (b.id === p1Block.id) return { ...b, endDate: newP1End };
      if (b.id === p2Block.id) return { ...b, startDate: newP2Start };
      return { ...b };
    });

    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    const currentResult = simulatePlan({ parents, blocks, transfers, constants });
    const proposalSim = simulatePlan({ parents, blocks: newBlocks.sort((a, b) => a.startDate.localeCompare(b.startDate)), transfers, constants });

    const currentAvg = calcAvgMonthly(currentResult.parentsResult);
    const proposalAvg = calcAvgMonthly(proposalSim.parentsResult);
    const deltaMonthly = Math.round(proposalAvg - currentAvg);

    const currentBudgetInsufficient = !!(currentResult as any).warnings?.budgetInsufficient;
    const proposalBudgetInsufficient = !!(proposalSim as any).warnings?.budgetInsufficient;

    const validSorted = newBlocks.sort((a, b) => a.startDate.localeCompare(b.startDate));
    const latestEnd = validSorted.length > 0 ? validSorted.reduce((max, b) => b.endDate > max ? b.endDate : max, validSorted[0].endDate) : null;

    return {
      newBlocks,
      latestEnd,
      deltaMonthly,
      budgetFlipped: !currentBudgetInsufficient && proposalBudgetInsufficient,
      budgetInsufficient: proposalBudgetInsufficient,
      unfulfilled: Math.round(proposalSim.unfulfilledDaysTotal ?? 0),
    };
  }, [handoverDate, p1Block, p2Block, blocks, parents, constants, transfer, parent1, parent2]);

  if (!parent1 || !parent2 || !p1Block || !p2Block) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
          <SheetHeader><SheetTitle>Justera växlingsdatum</SheetTitle></SheetHeader>
          <p className="text-sm text-muted-foreground p-4">Kunde inte hitta ett växlingsdatum. Kontrollera att båda föräldrar har minst ett block.</p>
          <SheetFooter>
            <SheetClose asChild><Button variant="ghost">Stäng</Button></SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  const hasError = proposalResult && "error" in proposalResult;
  const isChanged = handoverDate !== currentHandover;
  const canApply = isChanged && proposalResult && !hasError;

  const handleApply = () => {
    if (!proposalResult || "error" in proposalResult) return;
    console.log("[HandoverDrawer Apply]", { handoverDate });
    onApply(proposalResult.newBlocks);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Justera växlingsdatum</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 py-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Flytta datumet när {parent1.name} slutar och {parent2.name} tar över.
          </p>

          {/* Current blocks */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nuvarande perioder</p>
            <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-1 text-sm">
              <p><span className="font-medium">{parent1.name}:</span> {p1Block.startDate} – {p1Block.endDate}</p>
              <p><span className="font-medium">{parent2.name}:</span> {p2Block.startDate} – {p2Block.endDate}</p>
            </div>
          </div>

          {/* Date picker */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nytt växlingsdatum</p>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !handoverDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {handoverDate ? format(parseDateUTC(handoverDate), "yyyy-MM-dd") : "Välj datum"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={handoverDate ? parseDateUTC(handoverDate) : undefined}
                  onSelect={(d) => {
                    if (d) {
                      setHandoverDate(toISO(d));
                      setPopoverOpen(false);
                    }
                  }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Validation error */}
          {hasError && (
            <p className="text-sm text-destructive font-medium">
              {(proposalResult as any).error}
            </p>
          )}

          {/* Live preview */}
          {isChanged && proposalResult && !hasError && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Förhandsgranskning</p>
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2 text-sm">
                <p className="font-medium">
                  Föreslagen växling: {parent2.name} tar över {handoverDate}.
                </p>
                <p className="text-muted-foreground">
                  Planen räcker till: {proposalResult.latestEnd ?? "—"}
                </p>
                <p className="text-muted-foreground">
                  Hushållets snitt / mån ändras med: {proposalResult.deltaMonthly >= 0 ? "+" : ""}{proposalResult.deltaMonthly.toLocaleString()} kr/mån
                </p>
                {proposalResult.budgetFlipped && (
                  <p className="text-destructive font-medium text-xs">
                    ⚠ Varning: planen saknar dagar med detta datum. Överväg att omfördela dagar.
                  </p>
                )}
                {proposalResult.unfulfilled > 0 && !proposalResult.budgetFlipped && (
                  <p className="text-destructive/80 text-xs">
                    Planen saknar {proposalResult.unfulfilled} dagar.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!canApply} onClick={handleApply}>
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

export default HandoverDrawer;
