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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDays, todayISO, compareDates, diffDaysInclusive } from "@/utils/dateOnly";

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
  isOverlap?: boolean;
  source?: "system" | "user";
};

type Parent = {
  id: string;
  name: string;
};

type Props = {
  mode: "edit" | "create";
  block: Block | null;
  parents: Parent[];
  allBlocks: Block[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: Block) => void;
  onDelete?: (id: string) => void;
};

const MAX_BLOCKS = 8;

function checkOverlap(block: Block, allBlocks: Block[]): string | null {
  for (const other of allBlocks) {
    if (other.id === block.id) continue;
    if (other.parentId !== block.parentId) continue;
    // Double-day (isOverlap) blocks are intentional overlaps — skip them
    if (other.isOverlap) continue;
    if (compareDates(block.startDate, other.endDate) <= 0 && compareDates(block.endDate, other.startDate) >= 0) {
      return `Överlapp med period ${other.startDate} – ${other.endDate}`;
    }
  }
  return null;
}

function weeksFromDates(start: string, end: string): number {
  if (!start || !end) return 0;
  const days = diffDaysInclusive(start, end);
  return Math.max(0, Math.floor(days / 7));
}

function endDateFromWeeks(start: string, weeks: number): string {
  return addDays(start, weeks * 7 - 1);
}

const BlockEditDrawer = ({ mode, block, parents, allBlocks, open, onOpenChange, onSave, onDelete }: Props) => {
  const [parentId, setParentId] = useState(parents[0]?.id ?? "p1");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [lowestDaysPerWeek, setLowestDaysPerWeek] = useState(0);
  const [weeksMode, setWeeksMode] = useState(true); // true = weeks input, false = exact date
  const [weeks, setWeeks] = useState(4);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && block) {
      setParentId(block.parentId);
      setStartDate(block.startDate);
      setEndDate(block.endDate);
      setDaysPerWeek(block.daysPerWeek);
      setLowestDaysPerWeek(block.lowestDaysPerWeek ?? 0);
      const w = weeksFromDates(block.startDate, block.endDate);
      setWeeks(w > 0 ? w : 1);
      setWeeksMode(true);
    } else if (mode === "create") {
      const pid = parents[0]?.id ?? "p1";
      setParentId(pid);
      const parentBlocks = allBlocks.filter(b => b.parentId === pid).sort((a, b) => compareDates(b.endDate, a.endDate));
      const defaultStart = parentBlocks.length > 0 ? addDays(parentBlocks[0].endDate, 1) : todayISO();
      setStartDate(defaultStart);
      const defaultWeeks = 4;
      setWeeks(defaultWeeks);
      setEndDate(endDateFromWeeks(defaultStart, defaultWeeks));
      setDaysPerWeek(5);
      setLowestDaysPerWeek(0);
      setWeeksMode(true);
    }
  }, [open, mode, block, parents, allBlocks]);

  // Recalculate defaults when parent changes in create mode
  const handleParentChange = (pid: string) => {
    setParentId(pid);
    if (mode === "create") {
      const parentBlocks = allBlocks.filter(b => b.parentId === pid).sort((a, b) => compareDates(b.endDate, a.endDate));
      const defaultStart = parentBlocks.length > 0 ? addDays(parentBlocks[0].endDate, 1) : todayISO();
      setStartDate(defaultStart);
      setEndDate(endDateFromWeeks(defaultStart, weeks));
    }
  };

  const handleWeeksChange = (w: number) => {
    const clamped = Math.max(1, Math.min(104, w));
    setWeeks(clamped);
    if (startDate) {
      setEndDate(endDateFromWeeks(startDate, clamped));
    }
  };

  const handleStartDateChange = (d: string) => {
    setStartDate(d);
    if (weeksMode && d) {
      setEndDate(endDateFromWeeks(d, weeks));
    }
  };

  const handleEndDateChange = (d: string) => {
    setEndDate(d);
    if (startDate && d) {
      setWeeks(Math.max(1, weeksFromDates(startDate, d)));
    }
  };

  const draftId = mode === "edit" && block ? block.id : `b${Date.now()}`;
  const draft: Block = {
    id: draftId,
    parentId,
    startDate,
    endDate,
    daysPerWeek,
    lowestDaysPerWeek: lowestDaysPerWeek > 0 ? lowestDaysPerWeek : undefined,
    overlapGroupId: mode === "edit" && block ? block.overlapGroupId : undefined,
    source: "user",
  };

  const overlapError = useMemo(() => checkOverlap(draft, allBlocks), [draft, allBlocks]);

  const validationError = useMemo(() => {
    if (!draft.startDate) return "Startdatum krävs.";
    if (!draft.endDate) return "Slutdatum krävs.";
    if (compareDates(draft.endDate, draft.startDate) < 0) return "Slutdatum måste vara efter startdatum.";
    return null;
  }, [draft.startDate, draft.endDate]);

  const maxBlocksError = mode === "create" && allBlocks.length >= MAX_BLOCKS
    ? "Max 8 perioder i denna version."
    : null;

  const canSave = !overlapError && !validationError && !maxBlocksError;

  const parentName = parents.find(p => p.id === parentId)?.name ?? "";
  const isCreate = mode === "create";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{isCreate ? "Ny period" : `Redigera period – ${parentName}`}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 py-4 overflow-y-auto">
          {/* Debug line */}
          {!isCreate && (
            <p className="text-[10px] font-mono text-muted-foreground/50 truncate">
              {block
                ? `Redigerar: ${block.id} — ${parentName} — ${block.startDate} → ${block.endDate}`
                : `⚠ Block ej hittat (id: –)`}
            </p>
          )}

          {!isCreate && !block ? (
            <p className="text-sm text-destructive font-medium">
              Blocket kunde inte hittas. Stäng och försök igen.
            </p>
          ) : (
            <>
              {isCreate && (
                <div className="space-y-1">
                  <Label>Förälder</Label>
                  <Select value={parentId} onValueChange={handleParentChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {parents.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label>Startdatum</Label>
                <Input type="date" value={startDate} onChange={(e) => handleStartDateChange(e.target.value)} />
              </div>

              {/* Antal veckor — primary input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Antal veckor: {weeks}</Label>
                  <button
                    type="button"
                    onClick={() => setWeeksMode(!weeksMode)}
                    className="text-xs text-primary hover:underline"
                  >
                    {weeksMode ? "Ange slutdatum istället" : "Ange antal veckor"}
                  </button>
                </div>
                {weeksMode ? (
                  <>
                    <Slider
                      min={1}
                      max={104}
                      step={1}
                      value={[weeks]}
                      onValueChange={([v]) => handleWeeksChange(v)}
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={104}
                        value={weeks}
                        onChange={(e) => handleWeeksChange(Number(e.target.value) || 1)}
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">
                        veckor (t.o.m. {endDate || "—"})
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <Input type="date" value={endDate} onChange={(e) => handleEndDateChange(e.target.value)} />
                    <p className="text-xs text-muted-foreground">= {weeks} veckor</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Dagar per vecka: {daysPerWeek}</Label>
                <Slider
                  min={0} max={7} step={1}
                  value={[daysPerWeek]}
                  onValueChange={([v]) => {
                    setDaysPerWeek(v);
                    if (lowestDaysPerWeek > v) setLowestDaysPerWeek(v);
                  }}
                />
                {daysPerWeek === 0 && (
                  <p className="text-xs text-muted-foreground italic">Denna period blir utan uttag.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Lägstanivå per vecka: {lowestDaysPerWeek}</Label>
                <Slider
                  min={0} max={daysPerWeek} step={1}
                  value={[lowestDaysPerWeek]}
                  onValueChange={([v]) => setLowestDaysPerWeek(v)}
                  disabled={daysPerWeek === 0}
                />
              </div>

              {overlapError && <p className="text-xs text-destructive font-medium">{overlapError}</p>}
              {validationError && <p className="text-xs text-destructive font-medium">{validationError}</p>}
              {maxBlocksError && <p className="text-xs text-destructive font-medium">{maxBlocksError}</p>}
            </>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!canSave} onClick={() => { onSave(draft); onOpenChange(false); }}>
            Spara
          </Button>
          {!isCreate && onDelete && block && (
            <Button variant="destructive" onClick={() => { onDelete(block.id); onOpenChange(false); }}>
              Ta bort period
            </Button>
          )}
          <SheetClose asChild>
            <Button variant="ghost">Avbryt</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default BlockEditDrawer;
