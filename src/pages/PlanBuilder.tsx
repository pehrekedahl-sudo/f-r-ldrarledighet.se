import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { simulatePlan } from "@/lib/simulatePlan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

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
  overlapGroupId?: string;
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
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [blocks, setBlocks] = useState<Block[]>([makeBlock("b1")]);
  const [transfer, setTransfer] = useState<{ fromParentId: string; toParentId: string; sicknessDays: number } | null>(null);
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [months1, setMonths1] = useState(6);
  const [months2, setMonths2] = useState(6);
  const [isSharedPlan, setIsSharedPlan] = useState(false);

  useEffect(() => {
    const planParam = searchParams.get("plan");
    if (!planParam) return;
    try {
      const decoded = JSON.parse(atob(planParam));
      if (decoded.blocks) setBlocks(decoded.blocks);
      if (decoded.transfer) setTransfer(decoded.transfer);
      if (decoded.dueDate) setDueDate(decoded.dueDate);
      if (decoded.months1 !== undefined) setMonths1(decoded.months1);
      if (decoded.months2 !== undefined) setMonths2(decoded.months2);
      setIsSharedPlan(true);
    } catch { /* ignore invalid plan param */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sharePlan = useCallback(() => {
    const payload = { blocks, transfer, dueDate, months1, months2 };
    const encoded = btoa(JSON.stringify(payload));
    setSearchParams({ plan: encoded }, { replace: true });
    const url = `${window.location.origin}${window.location.pathname}?plan=${encoded}`;
    navigator.clipboard.writeText(url);
    toast({ description: "Länk kopierad" });
  }, [blocks, transfer, dueDate, months1, months2, setSearchParams, toast]);

  const generateQuickStart = () => {
    if (!dueDate) return;
    const due = new Date(dueDate);
    const end1 = new Date(due);
    end1.setMonth(end1.getMonth() + months1);
    const end2 = new Date(end1);
    end2.setMonth(end2.getMonth() + months2);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const b1: Block = { id: `b${nextId++}`, parentId: "p1", startDate: fmt(due), endDate: fmt(end1), daysPerWeek: 5 };
    const b2: Block = { id: `b${nextId++}`, parentId: "p2", startDate: fmt(end1), endDate: fmt(end2), daysPerWeek: 5 };
    setBlocks([b1, b2]);
    setTransfer(null);
    setTransferAmount(0);
    setTransferError(null);
  };

  const addBlock = () => setBlocks((prev) => [...prev, makeBlock()]);
  const addDoubleDays = () => {
    const groupId = `overlap-${nextId}`;
    const b1: Block = { ...makeBlock(), parentId: "p1", overlapGroupId: groupId };
    const b2: Block = { ...makeBlock(), parentId: "p2", overlapGroupId: groupId };
    setBlocks((prev) => [...prev, b1, b2]);
  };
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

  const copyPlan = useCallback(() => {
    if (!result) return;
    const lines: string[] = [];
    for (const pr of result.parentsResult) {
      lines.push(pr.name);
      const parentBlocks = blocks
        .filter((b) => b.parentId === pr.parentId && !blockErrors.get(b.id))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      for (const b of parentBlocks) {
        let line = `  ${b.startDate} – ${b.endDate}, ${b.daysPerWeek} dagar/vecka`;
        if (b.lowestDaysPerWeek !== undefined) line += `, lägstanivå ${b.lowestDaysPerWeek} d/v`;
        lines.push(line);
      }
      lines.push(`  Kvar: överförbar ${Math.round(pr.remaining.sicknessTransferable * 100) / 100}, reserverad ${Math.round(pr.remaining.sicknessReserved * 100) / 100}, lägstanivå ${Math.round(pr.remaining.lowest * 100) / 100}`);
      lines.push("");
    }
    lines.push("Simulering – kontrollera alltid i Försäkringskassan.");
    navigator.clipboard.writeText(lines.join("\n"));
    toast({ description: "Plan kopierad" });
  }, [result, blocks, blockErrors, toast]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-10">
      {isSharedPlan && (
        <div className="border border-border rounded-lg p-3 bg-muted text-sm text-muted-foreground text-center">
          Du tittar på en delad plan
        </div>
      )}
      {/* Hero */}
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Planera er föräldraledighet på 5 minuter</h1>
        <p className="text-muted-foreground">Se hur länge dagarna räcker och hur mycket ni får ut – innan ni ansöker.</p>
        <Button variant="outline" size="sm" onClick={() => document.getElementById("snabbstart")?.scrollIntoView({ behavior: "smooth" })}>Börja med snabbstart</Button>
      </div>

      {/* Steg 1 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold border-b border-border pb-2">Steg 1 – Skapa grundplan</h2>

        <div id="snabbstart" className="border border-border rounded-lg p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold">Snabbstart</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Beräknat datum (BF)</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Månader {PARENTS[0].name}</Label>
            <Input type="number" min={0} value={months1} onChange={(e) => setMonths1(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div className="space-y-1">
            <Label>Månader {PARENTS[1].name}</Label>
            <Input type="number" min={0} value={months2} onChange={(e) => setMonths2(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>
        <Button size="sm" disabled={!dueDate} onClick={generateQuickStart}>Generera startplan</Button>
      </div>

      {result && (() => {
        const budgetInsufficient = Boolean(result.warnings?.budgetInsufficient);
        const unfulfilled = Number(result.unfulfilledDaysTotal ?? 0);
        return budgetInsufficient ? (
          <div className="border border-destructive rounded-lg p-4 bg-destructive/10 text-destructive text-sm font-medium">
            Planen kräver fler dagar än ni har kvar. Saknas totalt: {Math.abs(unfulfilled) < 0.05 ? 0 : unfulfilled.toFixed(1)} dagar.
          </div>
        ) : null;
      })()}

      </section>

      {/* Steg 2 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold border-b border-border pb-2">Steg 2 – Justera & omfördela</h2>

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
        {(() => {
          const rendered = new Set<string>();
          return blocks.map((b) => {
            if (rendered.has(b.id)) return null;
            rendered.add(b.id);

            const partner = b.overlapGroupId
              ? blocks.find((o) => o.id !== b.id && o.overlapGroupId === b.overlapGroupId)
              : null;
            if (partner) rendered.add(partner.id);

            const renderBlock = (block: Block) => {
              const err = blockErrors.get(block.id);
              return (
                <div key={block.id} className={`border rounded-lg p-4 space-y-3 bg-card ${err ? "border-destructive" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{PARENTS.find((p) => p.id === block.parentId)?.name ?? "?"} – Block {block.id}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeBlock(block.id)}>Remove</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Parent</Label>
                      <Select value={block.parentId} onValueChange={(v) => updateBlock(block.id, { parentId: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PARENTS.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Days / week</Label>
                      <Input type="number" min={0} max={7} value={block.daysPerWeek} onChange={(e) => updateBlock(block.id, { daysPerWeek: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Start date</Label>
                      <Input type="date" value={block.startDate} onChange={(e) => updateBlock(block.id, { startDate: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>End date</Label>
                      <Input type="date" value={block.endDate} onChange={(e) => updateBlock(block.id, { endDate: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Lowest days / week (optional)</Label>
                      <Input type="number" min={0} max={7} placeholder="—" value={block.lowestDaysPerWeek ?? ""} onChange={(e) => updateBlock(block.id, { lowestDaysPerWeek: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    </div>
                  </div>
                  {err && <p className="text-xs text-destructive">{err}</p>}
                </div>
              );
            };

            if (partner) {
              return (
                <div key={b.overlapGroupId} className="border-2 border-dashed border-accent rounded-lg p-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">⬡ Dubbeldagar (överlapp)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {renderBlock(b)}
                    {renderBlock(partner)}
                  </div>
                </div>
              );
            }

            return renderBlock(b);
          });
        })()}
      </div>
      <div className="flex gap-3">
        <Button onClick={addBlock}>Lägg till block</Button>
        <Button variant="secondary" onClick={addDoubleDays}>Lägg till dubbeldagar (överlapp)</Button>
      </div>

      </section>

      {/* Steg 3 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold border-b border-border pb-2">Steg 3 – Förstå utfallet</h2>

        {result && (() => {
          const r2 = (v: number) => Math.round(v * 100) / 100;
          const totalSickness = result.parentsResult.reduce((s, pr) => s + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved, 0);
          const totalLowest = result.parentsResult.reduce((s, pr) => s + pr.remaining.lowest, 0);
          const totalAll = totalSickness + totalLowest;
          const allTransferableUsed = result.parentsResult.every(pr => pr.remaining.sicknessTransferable < 0.01);
          const validBlocks = blocks.filter(b => !blockErrors.get(b.id));
          const latestEnd = validBlocks.length > 0 ? validBlocks.reduce((max, b) => b.endDate > max ? b.endDate : max, validBlocks[0].endDate) : null;

          return (
          <div className="space-y-4">
            <div className="border border-border rounded-lg p-4 bg-card space-y-2">
              <h3 className="text-sm font-semibold">Strategisk översikt</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Sjukpenningdagar kvar</p>
                  <p className="font-medium">{r2(totalSickness)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lägstanivådagar kvar</p>
                  <p className="font-medium">{r2(totalLowest)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Totalt kvar</p>
                  <p className="font-medium">{r2(totalAll)}</p>
                </div>
              </div>
              <p className="text-sm">Ni sparar totalt <span className="font-medium">{r2(totalAll)}</span> dagar.</p>
              {latestEnd && <p className="text-sm text-muted-foreground">Planen räcker till: <span className="font-medium text-foreground">{latestEnd}</span></p>}
              {allTransferableUsed && (
                <p className="text-xs text-muted-foreground italic">Ni har använt alla överförbara sjukpenningdagar.</p>
              )}
            </div>

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
                    <p className="font-medium">Beräknad månadsutbetalning (brutto)</p>
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
          );
        })()}

        <div className="flex gap-3">
          <Button variant="outline" disabled={!result} onClick={copyPlan}>Kopiera plan</Button>
          <Button disabled={!result} onClick={sharePlan}>Dela med din partner</Button>
        </div>
      </section>
    </div>
  );
};

export default PlanBuilder;
