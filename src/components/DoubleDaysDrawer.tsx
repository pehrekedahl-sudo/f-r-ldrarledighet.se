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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { type Block } from "@/lib/adjustmentPolicy";
import { addDays } from "@/utils/dateOnly";
import { generateBlockId } from "@/lib/blockIdUtils";

type Parent = {
  id: string;
  name: string;
  monthlyIncomeFixed: number;
  monthlyIncomeVariableAvg?: number;
  has240Days: boolean;
};

export type CompensationMode = "reduce-dpw" | "use-saved";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parents: Parent[];
  maxDoubleDays?: number;
  onApply: (newBlocks: Block[], compensationMode: CompensationMode) => void;
};

function weekdaysToCalendarDays(weekdays: number): number {
  const fullWeeks = Math.floor(weekdays / 5);
  const remainder = weekdays % 5;
  return fullWeeks * 7 + remainder;
}

const DoubleDaysDrawer = ({ open, onOpenChange, parents, maxDoubleDays = 30, onApply }: Props) => {
  const [numDays, setNumDays] = useState(10);
  const [startDate, setStartDate] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [compensationMode, setCompensationMode] = useState<CompensationMode>("reduce-dpw");

  useEffect(() => {
    if (open) {
      setNumDays(10);
      setDaysPerWeek(5);
      setStartDate("");
      setCompensationMode("reduce-dpw");
    }
  }, [open]);

  const endDate = useMemo(() => {
    if (!startDate || numDays <= 0) return null;
    const calDays = weekdaysToCalendarDays(numDays);
    return addDays(startDate, calDays - 1);
  }, [startDate, numDays]);

  const handleApply = () => {
    if (!startDate || !endDate || parents.length < 2) return;

    const overlapGroupId = `dd-${Date.now()}`;

    const newBlocks: Block[] = parents.map((p) => ({
      id: generateBlockId("dbl"),
      parentId: p.id,
      startDate,
      endDate,
      daysPerWeek,
      isOverlap: true,
      overlapGroupId,
      source: "system" as const,
    }));

    onApply(newBlocks, compensationMode);
    onOpenChange(false);
  };

  const canApply = numDays > 0 && numDays <= 30 && startDate && endDate && parents.length >= 2;

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

          <div className="space-y-2">
            <Label htmlFor="double-days-input">Antal dagar</Label>
            <Input
              id="double-days-input"
              type="number"
              min={1}
              max={30}
              value={numDays}
              onChange={(e) =>
                setNumDays(Math.max(1, Math.min(maxDoubleDays, Math.floor(Number(e.target.value) || 1))))
              }
            />
            <p className="text-xs text-muted-foreground">Max 30 dagar under barnets första levnadsår.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="double-days-dpw">Dagar per vecka</Label>
            <Input
              id="double-days-dpw"
              type="number"
              min={1}
              max={5}
              value={daysPerWeek}
              onChange={(e) =>
                setDaysPerWeek(Math.max(1, Math.min(5, Math.floor(Number(e.target.value) || 5))))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="double-days-start">Startdatum</Label>
            <Input
              id="double-days-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <Label>Hur ska dubbeldagarna finansieras?</Label>
            <RadioGroup
              value={compensationMode}
              onValueChange={(v) => setCompensationMode(v as CompensationMode)}
              className="space-y-2"
            >
              <label
                htmlFor="mode-reduce-dpw"
                className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <RadioGroupItem value="reduce-dpw" id="mode-reduce-dpw" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Minska uttagstakten</p>
                  <p className="text-xs text-muted-foreground">
                    Sänker dagar/vecka på övriga block för att behålla sparade dagar.
                  </p>
                </div>
              </label>
              <label
                htmlFor="mode-use-saved"
                className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <RadioGroupItem value="use-saved" id="mode-use-saved" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Ta av sparade dagar</p>
                  <p className="text-xs text-muted-foreground">
                    Dubbeldagarna minskar dina sparade dagar.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {numDays > 0 && endDate && (
            <div className="border border-border rounded-lg p-4 bg-muted/30 text-sm">
              <p>
                Båda tar ut {numDays} dagar ({daysPerWeek} d/v), period: {startDate} – {endDate}
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!canApply} onClick={handleApply}>
            Lägg till
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
