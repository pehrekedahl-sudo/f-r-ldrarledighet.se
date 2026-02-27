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

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
};

type Props = {
  block: Block | null;
  parentName: string;
  allBlocks: Block[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: Block) => void;
  onDelete: (id: string) => void;
};

function checkOverlap(block: Block, allBlocks: Block[]): string | null {
  for (const other of allBlocks) {
    if (other.id === block.id) continue;
    if (other.parentId !== block.parentId) continue;
    if (block.startDate <= other.endDate && block.endDate >= other.startDate) {
      return `Överlapp med period ${other.startDate} – ${other.endDate}`;
    }
  }
  return null;
}

const BlockEditDrawer = ({ block, parentName, allBlocks, open, onOpenChange, onSave, onDelete }: Props) => {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [lowestDaysPerWeek, setLowestDaysPerWeek] = useState(0);

  useEffect(() => {
    if (block) {
      setStartDate(block.startDate);
      setEndDate(block.endDate);
      setDaysPerWeek(block.daysPerWeek);
      setLowestDaysPerWeek(block.lowestDaysPerWeek ?? 0);
    }
  }, [block]);

  const draft: Block | null = block
    ? { ...block, startDate, endDate, daysPerWeek, lowestDaysPerWeek: lowestDaysPerWeek > 0 ? lowestDaysPerWeek : undefined }
    : null;

  const overlapError = useMemo(() => {
    if (!draft) return null;
    return checkOverlap(draft, allBlocks);
  }, [draft, allBlocks]);

  const validationError = useMemo(() => {
    if (!draft) return null;
    if (!draft.startDate) return "Startdatum krävs.";
    if (!draft.endDate) return "Slutdatum krävs.";
    if (draft.endDate < draft.startDate) return "Slutdatum måste vara efter startdatum.";
    return null;
  }, [draft]);

  const canSave = !overlapError && !validationError && draft !== null;

  if (!block) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Redigera period – {parentName}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 py-4 overflow-y-auto">
          <div className="space-y-1">
            <Label>Startdatum</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Slutdatum</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Dagar per vecka: {daysPerWeek}</Label>
            <Slider
              min={0}
              max={7}
              step={1}
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
              min={0}
              max={daysPerWeek}
              step={1}
              value={[lowestDaysPerWeek]}
              onValueChange={([v]) => setLowestDaysPerWeek(v)}
              disabled={daysPerWeek === 0}
            />
          </div>

          {overlapError && (
            <p className="text-xs text-destructive font-medium">{overlapError}</p>
          )}
          {validationError && (
            <p className="text-xs text-destructive font-medium">{validationError}</p>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!canSave} onClick={() => { if (draft) { onSave(draft); onOpenChange(false); } }}>
            Spara
          </Button>
          <Button
            variant="destructive"
            onClick={() => { onDelete(block.id); onOpenChange(false); }}
          >
            Ta bort period
          </Button>
          <SheetClose asChild>
            <Button variant="ghost">Avbryt</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default BlockEditDrawer;
