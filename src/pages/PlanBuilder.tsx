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

function validateBlock(b: Block): string | null {
  if (!b.startDate) return "Start date is required.";
  if (!b.endDate) return "End date is required.";
  if (b.endDate < b.startDate) return "End date must be ≥ start date.";
  if (b.daysPerWeek < 0 || b.daysPerWeek > 7 || isNaN(b.daysPerWeek))
    return "Days per week must be 0–7.";
  if (b.lowestDaysPerWeek !== undefined) {
    if (isNaN(b.lowestDaysPerWeek) || b.lowestDaysPerWeek < 0 || b.lowestDaysPerWeek > b.daysPerWeek)
      return `Lowest days/week must be 0–${b.daysPerWeek}.`;
  }
  return null;
}

const PlanBuilder = () => {
  const [blocks, setBlocks] = useState<Block[]>([makeBlock("b1")]);
  const [transfer, setTransfer] = useState<{ fromParentId: string; toParentId: string; sicknessDays: number } | null>(null);
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferError, setTransferError] = useState<string | null>(null);

  const addBlock = () => setBlocks((prev) => [...prev, makeBlock()]);
  const updateBlock = (id: string, patch: Partial<Block>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeBlock = (id: string) =>
    setBlocks((prev) => prev.filter((b) => b.id !== id));

  const blockErrors = useMemo(
    () => new Map(blocks.map((b) => [b.id, validateBlock(b)])),
    [blocks]
  );

  const result = useMemo(() => {
    const valid = blocks
      .filter((b) => !blockErrors.get(b.id))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (valid.length === 0) return null;
    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    try {
      const r = simulatePlan({ parents: PARENTS, blocks: valid, transfers, constants: CONSTANTS });
      console.log("simulatePlan result:", r);
      return r;
    } catch {
      return null;
    }
  }, [blocks, blockErrors, transfer]);

  const handleTransfer = (toParentId: string) => {
    const fromParentId = toParentId === "p1" ? "p2" : "p1";
    const senderResult = result?.parentsResult.find((pr) => pr.parentId === fromParentId);
    const available = senderResult?.remaining.sicknessTransferable ?? 0;
    if (transferAmount > available) {
      const senderName = PARENTS.find((p) => p.id === fromParentId)?.name ?? "?";
      setTransferError(`${senderName} har bara ${Math.floor(available)} överförbara dagar kvar.`);
      return;
    }
    setTransferError(null);
    setTransfer({ fromParentId, toParentId, sicknessDays: transferAmount });
    setTransferAmount(0);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <p className="text-sm text-muted-foreground">Plan Builder – live simulation</p>

      {result && (() => {
        const budgetInsufficient = Boolean(result.warnings?.budgetInsufficient);
        const overrideAdjusted = Boolean(result.warnings?.overrideAdjusted);
        const unfulfilled = Number(result.unfulfilledDaysTotal ?? 0);
        const unfulfilledDisplay = Math.abs(unfulfilled) < 0.01 ? 0 : unfulfilled.toFixed(2);

        return (
        <>
        <div className="border border-border rounded-lg p-4 bg-card space-y-1">
          <h2 className="text-sm font-semibold mb-2">Simulation summary</h2>
          <p className="text-sm">blocksSimulated: {blocks.filter((b) => !blockErrors.get(b.id)).length}</p>
          <p className="text-sm">
            budgetInsufficient:{" "}
            <span className={budgetInsufficient ? "text-destructive font-medium" : ""}>
              {String(budgetInsufficient)}
            </span>
          </p>
          <p className="text-sm">
            overrideAdjusted:{" "}
            <span className={overrideAdjusted ? "text-destructive font-medium" : ""}>
              {String(overrideAdjusted)}
            </span>
          </p>
          <p className="text-sm">
            unfulfilledDaysTotal:{" "}
            <span className={Math.abs(unfulfilled) >= 0.01 ? "text-destructive font-medium" : ""}>
              {unfulfilledDisplay}
            </span>
          </p>

          <table className="w-full text-sm mt-3 border-collapse">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-1 font-medium">Förälder</th>
                <th className="py-1 font-medium">Tagna (sjuk)</th>
                <th className="py-1 font-medium">Tagna (lägst)</th>
                <th className="py-1 font-medium">Kvar (överförbar)</th>
                <th className="py-1 font-medium">Kvar (reserverad)</th>
                <th className="py-1 font-medium">Kvar (lägst)</th>
              </tr>
            </thead>
            <tbody>
              {result.parentsResult.map((pr) => (
                <tr key={pr.parentId} className="border-b border-border">
                  <td className="py-1 font-medium">{pr.name}</td>
                  <td className="py-1">{Math.round(pr.taken.sickness * 100) / 100}</td>
                  <td className="py-1">{Math.round(pr.taken.lowest * 100) / 100}</td>
                  <td className="py-1">{Math.round(pr.remaining.sicknessTransferable * 100) / 100}</td>
                  <td className="py-1">{Math.round(pr.remaining.sicknessReserved * 100) / 100}</td>
                  <td className="py-1">{Math.round(pr.remaining.lowest * 100) / 100}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {budgetInsufficient && (
          <div className="border border-destructive rounded-lg p-4 bg-destructive/10 text-destructive text-sm font-medium">
            Planen kräver fler dagar än ni har kvar. Saknas totalt: {Math.abs(unfulfilled) < 0.05 ? 0 : unfulfilled.toFixed(1)} dagar.
          </div>
        )}
        </>
        );
      })()}

      {result && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Planöversikt</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.parentsResult.map((pr) => (
              <div key={pr.parentId} className="border border-border rounded-lg p-4 bg-card space-y-3">
                <h3 className="text-sm font-semibold">{pr.name}</h3>

                <div className="space-y-1 text-sm">
                  <p className="font-medium">Totalt uttagna dagar</p>
                  <p className="text-muted-foreground pl-2">Sjukpenningnivå: {Math.round(pr.taken.sickness * 100) / 100}</p>
                  <p className="text-muted-foreground pl-2">Lägstanivå: {Math.round(pr.taken.lowest * 100) / 100}</p>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="font-medium">Kvarvarande dagar</p>
                  <p className="text-muted-foreground pl-2">Sjukpenning: {Math.round((pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved) * 100) / 100}</p>
                  <p className="text-muted-foreground pl-2">Lägstanivå: {Math.round(pr.remaining.lowest * 100) / 100}</p>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="font-medium">Estimated monthly gross payout</p>
                  {pr.monthlyBreakdown.length > 0 ? (
                    <div className="pl-2 space-y-0.5">
                      {pr.monthlyBreakdown.map((m) => (
                        <p key={m.monthKey} className="text-muted-foreground">
                          {m.monthKey}: {Math.round(m.grossAmount).toLocaleString()} kr
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground pl-2">—</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg p-4 bg-card space-y-3">
        <h2 className="text-sm font-semibold">Omfördela överförbara sjukpenningdagar</h2>
        {result && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            {result.parentsResult.map((pr) => (
              <div key={pr.parentId} className="space-y-0.5 text-muted-foreground">
                <p className="font-medium text-foreground">{pr.name}</p>
                <p>Överförbara kvar: {Math.round(pr.remaining.sicknessTransferable * 100) / 100}</p>
                <p>Reserverade kvar: {Math.round(pr.remaining.sicknessReserved * 100) / 100}</p>
                <p>Lägstanivå kvar: {Math.round(pr.remaining.lowest * 100) / 100}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-sm">Antal dagar</Label>
            <Input type="number" min={0} step={1} className="w-28" value={transferAmount || ""} onChange={(e) => { setTransferAmount(Math.max(0, Math.floor(Number(e.target.value) || 0))); setTransferError(null); }} />
          </div>
          <Button variant="outline" size="sm" disabled={transferAmount === 0} onClick={() => handleTransfer("p1")}>
            Ge till {PARENTS[0].name}
          </Button>
          <Button variant="outline" size="sm" disabled={transferAmount === 0} onClick={() => handleTransfer("p2")}>
            Ge till {PARENTS[1].name}
          </Button>
        </div>
        {result && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Max att ge till {PARENTS[0].name} just nu: {Math.floor(result.parentsResult.find(pr => pr.parentId === "p2")?.remaining.sicknessTransferable ?? 0)} dagar</p>
            <p>Max att ge till {PARENTS[1].name} just nu: {Math.floor(result.parentsResult.find(pr => pr.parentId === "p1")?.remaining.sicknessTransferable ?? 0)} dagar</p>
          </div>
        )}
        {transferError && <p className="text-xs text-destructive">{transferError}</p>}
        {transfer && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Aktiv överföring: {transfer.sicknessDays} dagar från {PARENTS.find(p => p.id === transfer.fromParentId)?.name} till {PARENTS.find(p => p.id === transfer.toParentId)?.name}</p>
            <p>Detta tar dagar från {PARENTS.find(p => p.id === transfer.fromParentId)?.name} och ger till {PARENTS.find(p => p.id === transfer.toParentId)?.name}.</p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {blocks.map((b) => {
          const err = blockErrors.get(b.id);
          return (
            <div key={b.id} className={`border rounded-lg p-4 space-y-3 bg-card ${err ? "border-destructive" : "border-border"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{PARENTS.find((p) => p.id === b.parentId)?.name ?? "?"} – Block {b.id}</span>
                <Button variant="ghost" size="sm" onClick={() => removeBlock(b.id)}>Remove</Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Parent</Label>
                  <Select value={b.parentId} onValueChange={(v) => updateBlock(b.id, { parentId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PARENTS.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
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
              {err && <p className="text-xs text-destructive">{err}</p>}
            </div>
          );
        })}
      </div>

      <Button onClick={addBlock}>Add block</Button>

      {result && (
        <details className="bg-muted rounded-lg">
          <summary className="cursor-pointer p-3 text-sm font-medium">Full result JSON</summary>
          <pre className="p-4 pt-0 text-xs overflow-auto max-h-[500px]">{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </div>
  );
};

export default PlanBuilder;
