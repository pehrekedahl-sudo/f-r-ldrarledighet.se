import { useState, useMemo } from "react";
import { simulatePlan } from "@/lib/simulatePlan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PARENTS = [
  { id: "p1", name: "Anna", monthlyIncomeFixed: 45000, has240Days: true },
  { id: "p2", name: "Erik", monthlyIncomeFixed: 38000, has240Days: true },
];

const CONSTANTS = {
  SGI_CAP_ANNUAL: 592000,
  LOWEST_LEVEL_DAILY_AMOUNT: 180,
  BASIC_LEVEL_DAILY_AMOUNT: 250,
  SICKNESS_RATE: 0.8,
  REDUCTION: 0.97,
};

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
};

let nextId = 2;

const makeBlock = (id?: string): Block => ({
  id: id ?? `b${nextId++}`,
  parentId: "p1",
  startDate: "2025-03-01",
  endDate: "2025-05-31",
  daysPerWeek: 7,
});

const PlanBuilder = () => {
  const [blocks, setBlocks] = useState<Block[]>([makeBlock("b1")]);

  const addBlock = () => setBlocks((prev) => [...prev, makeBlock()]);

  const updateBlock = (id: string, patch: Partial<Block>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const removeBlock = (id: string) =>
    setBlocks((prev) => prev.filter((b) => b.id !== id));

  const result = useMemo(() => {
    if (blocks.length === 0) return null;
    try {
      const r = simulatePlan({ parents: PARENTS, blocks, constants: CONSTANTS });
      console.log("simulatePlan result:", r);
      return r;
    } catch (e) {
      return null;
    }
  }, [blocks]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <p className="text-sm text-muted-foreground">Plan Builder – live simulation</p>

      {/* Simulation summary */}
      {result && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-1">
          <h2 className="text-sm font-semibold mb-2">Simulation summary</h2>
          <p className="text-sm">
            budgetInsufficient:{" "}
            <span className={result.warnings?.budgetInsufficient ? "text-destructive font-medium" : ""}>
              {String(result.warnings?.budgetInsufficient ?? false)}
            </span>
          </p>
          <p className="text-sm">
            overrideAdjusted:{" "}
            <span className={result.warnings?.overrideAdjusted ? "text-destructive font-medium" : ""}>
              {String(result.warnings?.overrideAdjusted ?? false)}
            </span>
          </p>
          <p className="text-sm">
            unfulfilledDaysTotal:{" "}
            <span className={result.unfulfilledDaysTotal > 0 ? "text-destructive font-medium" : ""}>
              {result.unfulfilledDaysTotal ?? 0}
            </span>
          </p>
        </div>
      )}

      {/* Block cards */}
      <div className="space-y-4">
        {blocks.map((b) => (
          <div key={b.id} className="border border-border rounded-lg p-4 space-y-3 bg-card">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Block {b.id}</span>
              <Button variant="ghost" size="sm" onClick={() => removeBlock(b.id)}>
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Parent</Label>
                <Select value={b.parentId} onValueChange={(v) => updateBlock(b.id, { parentId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PARENTS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Days / week</Label>
                <Input type="number" min={0} max={7} value={b.daysPerWeek} onChange={(e) => updateBlock(b.id, { daysPerWeek: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label>Start date</Label>
                <Input type="date" value={b.startDate} onChange={(e) => updateBlock(b.id, { startDate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>End date</Label>
                <Input type="date" value={b.endDate} onChange={(e) => updateBlock(b.id, { endDate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Lowest days / week (optional)</Label>
                <Input type="number" min={0} max={7} placeholder="—" value={b.lowestDaysPerWeek ?? ""} onChange={(e) => updateBlock(b.id, { lowestDaysPerWeek: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button onClick={addBlock}>Add block</Button>

      {/* Full JSON in collapsible */}
      {result && (
        <details className="bg-muted rounded-lg">
          <summary className="cursor-pointer p-3 text-sm font-medium">Full result JSON</summary>
          <pre className="p-4 pt-0 text-xs overflow-auto max-h-[500px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export default PlanBuilder;
