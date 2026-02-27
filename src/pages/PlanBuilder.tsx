import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { simulatePlan } from "@/lib/simulatePlan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { loadPlanInput, savePlanInput } from "@/lib/persistence";
import PlanTimeline from "@/components/PlanTimeline";
import BlockEditDrawer from "@/components/BlockEditDrawer";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_PARENTS = [
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
  if (b.daysPerWeek < 0 || b.daysPerWeek > 7 || isNaN(b.daysPerWeek) || !Number.isInteger(b.daysPerWeek))
    return "Days per week must be an integer 0–7.";
  if (b.lowestDaysPerWeek !== undefined) {
    if (isNaN(b.lowestDaysPerWeek) || b.lowestDaysPerWeek < 0 || b.lowestDaysPerWeek > b.daysPerWeek || !Number.isInteger(b.lowestDaysPerWeek))
      return `Lowest days/week must be an integer 0–${b.daysPerWeek}.`;
  }
  return null;
}

const PlanBuilder = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [parents, setParents] = useState(DEFAULT_PARENTS);
  const [blocks, setBlocks] = useState<Block[]>([makeBlock("b1")]);
  const [transfer, setTransfer] = useState<{ fromParentId: string; toParentId: string; sicknessDays: number } | null>(null);
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [months1, setMonths1] = useState(6);
  const [months2, setMonths2] = useState(6);
  const [isSharedPlan, setIsSharedPlan] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "result">("result");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [noSavedPlan, setNoSavedPlan] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"edit" | "create">("edit");

  const loadFromLocalStorage = useCallback(() => {
    const saved = loadPlanInput() as any;
    if (saved && saved.parents && saved.blocks && saved.blocks.length > 0) {
      setParents(saved.parents);
      setBlocks(saved.blocks);
      if (saved.transfers?.length > 0) setTransfer(saved.transfers[0]);
      setViewMode("result");
      setLoaded(true);
      setNoSavedPlan(false);
      return true;
    }
    return false;
  }, []);

  // Load plan from URL param or localStorage
  useEffect(() => {
    const planParam = searchParams.get("plan");
    if (planParam) {
      try {
        const decoded = JSON.parse(atob(planParam));
        if (decoded.blocks) setBlocks(decoded.blocks);
        if (decoded.transfer) setTransfer(decoded.transfer);
        if (decoded.dueDate) setDueDate(decoded.dueDate);
        if (decoded.months1 !== undefined) setMonths1(decoded.months1);
        if (decoded.months2 !== undefined) setMonths2(decoded.months2);
        if (decoded.parents) setParents(decoded.parents);
        setIsSharedPlan(true);
        setViewMode("result");
        setLoaded(true);
        return;
      } catch { /* ignore */ }
    }

    if (!loadFromLocalStorage()) {
      navigate("/wizard", { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadSaved = () => {
    if (!loadFromLocalStorage()) {
      setNoSavedPlan(true);
    }
  };

  const handleClearPlan = () => {
    localStorage.removeItem("planBuilderLastPlanV1");
    setLoaded(false);
    navigate("/wizard", { replace: true });
  };

  const sharePlan = useCallback(() => {
    const payload = { blocks, transfer, dueDate, months1, months2, parents };
    const encoded = btoa(JSON.stringify(payload));
    setSearchParams({ plan: encoded }, { replace: true });
    const url = `${window.location.origin}${window.location.pathname}?plan=${encoded}`;
    navigator.clipboard.writeText(url);
    toast({ description: "Länk kopierad" });
  }, [blocks, transfer, dueDate, months1, months2, parents, setSearchParams, toast]);

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

  const handleTimelineBlockClick = (blockId: string) => {
    setEditingBlockId(blockId);
    setDrawerMode("edit");
    setDrawerOpen(true);
  };

  const handleAddPeriod = () => {
    setEditingBlockId(null);
    setDrawerMode("create");
    setDrawerOpen(true);
  };

  const handleDrawerSave = (updated: Block) => {
    if (drawerMode === "create") {
      const newBlocks = [...blocks, updated];
      setBlocks(newBlocks);
      const valid = newBlocks.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
      const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
      savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS });
    } else {
      updateBlock(updated.id, updated);
      const valid = blocks.map(b => b.id === updated.id ? updated : b).filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
      const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
      savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS });
    }
  };

  const handleDrawerDelete = (id: string) => {
    removeBlock(id);
    const remaining = blocks.filter(b => b.id !== id);
    const valid = remaining.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS });
  };

  const blockErrors = useMemo(
    () => new Map(blocks.map((b) => [b.id, validateBlock(b)])),
    [blocks]
  );

  const planInput = useMemo(() => {
    const valid = blocks
      .filter((b) => !blockErrors.get(b.id))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    return { parents, blocks: valid, transfers, constants: CONSTANTS };
  }, [blocks, blockErrors, transfer, parents]);

  const result = useMemo(() => {
    if (planInput.blocks.length === 0) return null;
    try {
      return simulatePlan(planInput);
    } catch {
      return null;
    }
  }, [planInput]);

  const handleTransfer = (toParentId: string) => {
    const fromParentId = toParentId === "p1" ? "p2" : "p1";
    const senderResult = result?.parentsResult.find((pr) => pr.parentId === fromParentId);
    const available = senderResult?.remaining.sicknessTransferable ?? 0;
    if (transferAmount > available) {
      const senderName = parents.find((p) => p.id === fromParentId)?.name ?? "?";
      setTransferError(`${senderName} har bara ${Math.round(available)} överförbara dagar kvar.`);
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
      lines.push(`  Kvar: överförbar ${Math.round(pr.remaining.sicknessTransferable)}, reserverad ${Math.round(pr.remaining.sicknessReserved)}, lägstanivå ${Math.round(pr.remaining.lowest)}`);
      lines.push("");
    }
    lines.push("Simulering – kontrollera alltid i Försäkringskassan.");
    navigator.clipboard.writeText(lines.join("\n"));
    toast({ description: "Plan kopierad" });
  }, [result, blocks, blockErrors, toast]);

  // Show loading until plan is loaded
  if (!loaded) {
    return (
      <div className="max-w-lg mx-auto px-6 py-24 text-center space-y-4">
        <p className="text-lg text-muted-foreground">Laddar plan…</p>
      </div>
    );
  }

  const renderBlockEditor = () => (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold border-b border-border pb-2">Redigera block</h2>

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
                    <span className="text-sm font-medium">{parents.find((p) => p.id === block.parentId)?.name ?? "?"} – Block {block.id}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeBlock(block.id)}>Ta bort</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Förälder</Label>
                      <Select value={block.parentId} onValueChange={(v) => updateBlock(block.id, { parentId: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {parents.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Dagar / vecka</Label>
                      <Input type="number" min={0} max={7} value={block.daysPerWeek} onChange={(e) => updateBlock(block.id, { daysPerWeek: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Startdatum</Label>
                      <Input type="date" value={block.startDate} onChange={(e) => updateBlock(block.id, { startDate: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Slutdatum</Label>
                      <Input type="date" value={block.endDate} onChange={(e) => updateBlock(block.id, { endDate: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Lägstanivådagar / vecka (valfritt)</Label>
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
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
      {isSharedPlan && (
        <div className="border border-border rounded-lg p-3 bg-muted text-sm text-muted-foreground text-center">
          Du tittar på en delad plan
        </div>
      )}

      {viewMode === "edit" && (
        <>
          {/* Hero */}
          <div className="space-y-3 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Planera er föräldraledighet på 5 minuter</h1>
            <p className="text-muted-foreground">Se hur länge dagarna räcker och hur mycket ni får ut – innan ni ansöker.</p>
          </div>

          {/* Snabbstart */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Skapa grundplan</h2>

            <div id="snabbstart" className="border border-border rounded-lg p-4 bg-card space-y-3">
              <h3 className="text-sm font-semibold">Snabbstart</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Beräknat datum (BF)</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Månader {parents[0].name}</Label>
                  <Input type="number" min={0} value={months1} onChange={(e) => setMonths1(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div className="space-y-1">
                  <Label>Månader {parents[1].name}</Label>
                  <Input type="number" min={0} value={months2} onChange={(e) => setMonths2(Math.max(0, Number(e.target.value) || 0))} />
                </div>
              </div>
              <Button size="sm" disabled={!dueDate} onClick={() => {
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
              }}>Generera startplan</Button>
            </div>

            {result && (() => {
              const unfulfilled = result.unfulfilledDaysTotal ?? 0;
              if (unfulfilled <= 0) return null;
              const householdTransferableRemaining = result.parentsResult.reduce((s, pr) => s + pr.remaining.sicknessTransferable, 0);
              if (householdTransferableRemaining > 0) {
                return (
                  <div className="border border-warning/50 rounded-lg p-4 bg-warning/10 text-warning-foreground text-sm space-y-1">
                    <p className="font-medium">Planen kräver att ni omfördelar dagar mellan er för att gå ihop.</p>
                    <p className="text-xs">Testa att flytta överförbara sjukpenningdagar under &quot;Omfördela dagar&quot;.</p>
                  </div>
                );
              }
              return (
                <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/10 text-destructive text-sm font-medium">
                  Planen saknar totalt {unfulfilled} dagar för att gå ihop.
                </div>
              );
            })()}
          </section>

          {renderBlockEditor()}

          <Button className="w-full" size="lg" disabled={!result} onClick={() => { setViewMode("result"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            Se resultat
          </Button>
        </>
      )}

      {viewMode === "result" && result && (() => {
        const r2 = (v: number) => Math.round(v);
        const validBlocks = blocks.filter(b => !blockErrors.get(b.id));
        const latestEnd = validBlocks.length > 0 ? validBlocks.reduce((max, b) => b.endDate > max ? b.endDate : max, validBlocks[0].endDate) : null;
        const allMonthly = result.parentsResult.flatMap(pr => pr.monthlyBreakdown);
        const totalGross = allMonthly.reduce((s, m) => s + m.grossAmount, 0);
        const monthTotals = new Map<string, number>();
        for (const m of allMonthly) {
          monthTotals.set(m.monthKey, (monthTotals.get(m.monthKey) ?? 0) + m.grossAmount);
        }
        const activeMonths = Array.from(monthTotals.values()).filter(v => v > 0).length;
        const avgMonthly = activeMonths > 0 ? totalGross / activeMonths : 0;
        const totalAll = result.parentsResult.reduce((s, pr) => s + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest, 0);
        const unfulfilled = result.unfulfilledDaysTotal ?? 0;

        return (
          <>
            {/* ── HERO ── */}
            <section className="text-center space-y-6 py-8">
              <h1 className="text-3xl font-bold tracking-tight">Er plan i korthet</h1>
              <div className="grid grid-cols-3 gap-6 max-w-xl mx-auto">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Planen räcker till</p>
                  <p className="text-2xl font-bold mt-1">{latestEnd ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Genomsnittlig ersättning</p>
                  <p className="text-2xl font-bold mt-1">{Math.round(avgMonthly).toLocaleString()} kr/mån</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Dagar kvar totalt</p>
                  <p className="text-2xl font-bold mt-1">{r2(totalAll)}</p>
                </div>
              </div>

              {unfulfilled > 0 ? (
                <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/10 text-destructive font-medium text-sm max-w-md mx-auto">
                  ⚠ Planen saknar {unfulfilled} dagar för att gå ihop.
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">✓ Planen går ihop.</p>
              )}

              <Button
                size="lg"
                onClick={() => {
                  setAdjustOpen(true);
                  setTimeout(() => document.getElementById("adjust-section")?.scrollIntoView({ behavior: "smooth" }), 100);
                }}
              >
                Justera planen
              </Button>
            </section>

            {/* ── TIMELINE ── */}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Tidslinje</h2>
              <PlanTimeline
                blocks={validBlocks}
                parents={parents}
                unfulfilledDaysTotal={unfulfilled}
                onBlockClick={handleTimelineBlockClick}
              />
            </section>

            {/* ── ADJUSTMENTS & DETAILS (collapsed) ── */}
            <Collapsible open={adjustOpen} onOpenChange={setAdjustOpen}>
              <CollapsibleTrigger id="adjust-section" className="flex items-center justify-between w-full border border-border rounded-lg p-4 bg-card text-sm font-semibold cursor-pointer hover:bg-accent/50 transition-colors [&[data-state=open]>svg]:rotate-180">
                Justeringar &amp; detaljer
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent className="border border-t-0 border-border rounded-b-lg p-5 bg-card space-y-8">

                {/* Add period */}
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={handleAddPeriod}>+ Lägg till period</Button>
                </div>

                {/* Transfer section */}
                <div id="transfer-section" className="space-y-3">
                  <h4 className="text-sm font-semibold">Omfördela dagar</h4>
                  {(() => {
                    const householdTransferableRemaining = result.parentsResult.reduce((s, pr) => s + pr.remaining.sicknessTransferable, 0);
                    if (unfulfilled <= 0 || householdTransferableRemaining <= 0) return null;
                    return (
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-warning/50 text-warning-foreground hover:bg-warning/10"
                          onClick={() => {
                            const scored = result.parentsResult.map(pr => ({
                              ...pr,
                              totalRemaining: pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest,
                              totalTaken: pr.taken.sickness + pr.taken.lowest,
                            }));
                            scored.sort((a, b) => a.totalRemaining - b.totalRemaining || b.totalTaken - a.totalTaken);
                            const needs = scored[0];
                            const gives = scored[scored.length - 1];
                            const suggested = Math.max(1, Math.min(Math.floor(unfulfilled), Math.floor(gives.remaining.sicknessTransferable)));
                            setTransferAmount(suggested);
                            setTransferError(null);
                            const needsName = parents.find(p => p.id === needs.parentId)?.name ?? "";
                            toast({ description: `Förslag: ge ${suggested} dagar till ${needsName}` });
                          }}
                        >
                          Föreslå omfördelning
                        </Button>
                        <p className="text-xs text-muted-foreground">Förslag baserat på att planen inte går ihop utan omfördelning.</p>
                      </div>
                    );
                  })()}
                  {(() => {
                    const p1Transferable = Math.round(result.parentsResult.find(pr => pr.parentId === "p1")?.remaining.sicknessTransferable ?? 0);
                    const p2Transferable = Math.round(result.parentsResult.find(pr => pr.parentId === "p2")?.remaining.sicknessTransferable ?? 0);
                    const anyTransferable = p1Transferable > 0 || p2Transferable > 0;
                    return (
                      <>
                        <div className="flex items-end gap-3">
                          <div className="space-y-1">
                            <Label className="text-sm">Antal dagar</Label>
                            <Input type="number" min={0} step={1} className="w-28" value={transferAmount || ""} onChange={(e) => { setTransferAmount(Math.max(0, Math.floor(Number(e.target.value) || 0))); setTransferError(null); }} disabled={!anyTransferable} />
                          </div>
                          <Button variant="outline" size="sm" disabled={transferAmount === 0 || p2Transferable === 0} onClick={() => handleTransfer("p1")}>
                            Ge till {parents[0].name}
                          </Button>
                          <Button variant="outline" size="sm" disabled={transferAmount === 0 || p1Transferable === 0} onClick={() => handleTransfer("p2")}>
                            Ge till {parents[1].name}
                          </Button>
                        </div>
                        {!anyTransferable && (
                          <p className="text-xs text-muted-foreground italic">Inga överförbara dagar kvar att flytta.</p>
                        )}
                      </>
                    );
                  })()}
                  {transferError && <p className="text-xs text-destructive">{transferError}</p>}
                  {transfer && (
                    <p className="text-xs text-muted-foreground">
                      Aktiv överföring: {transfer.sicknessDays} dagar från {parents.find(p => p.id === transfer.fromParentId)?.name} till {parents.find(p => p.id === transfer.toParentId)?.name}
                    </p>
                  )}
                </div>

                <div className="border-t border-border" />

                {/* Budget details per parent */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Budgetdetaljer</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {result.parentsResult.map((pr) => {
                      const parentDaysLeft = Math.round(pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest);
                      const parentTotalGross = pr.monthlyBreakdown.reduce((s, m) => s + m.grossAmount, 0);
                      const parentActiveMonths = pr.monthlyBreakdown.filter(m => m.grossAmount > 0).length;
                      const parentAvgMonthly = parentActiveMonths > 0 ? Math.round(parentTotalGross / parentActiveMonths) : 0;
                      return (
                        <div key={pr.parentId} className="border border-border rounded-lg p-4 bg-muted/30 space-y-3">
                          <h5 className="text-sm font-semibold">{pr.name}</h5>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Uttagna</p>
                              <p className="font-medium">{Math.round(pr.taken.sickness + pr.taken.lowest)} d</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Kvar</p>
                              <p className="font-medium">{parentDaysLeft} d</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Snitt/mån</p>
                              <p className="font-medium">{parentAvgMonthly.toLocaleString()} kr</p>
                            </div>
                          </div>
                          <Collapsible>
                            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                              Visa månad för månad
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200" />
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-2 space-y-0.5">
                              {pr.monthlyBreakdown.length > 0 ? (
                                pr.monthlyBreakdown.map((m) => (
                                  <p key={m.monthKey} className="text-sm text-muted-foreground">
                                    {m.monthKey}: {Math.round(m.grossAmount).toLocaleString()} kr
                                  </p>
                                ))
                              ) : (
                                <p className="text-sm text-muted-foreground">—</p>
                              )}
                            </CollapsibleContent>
                          </Collapsible>
                          <Collapsible>
                            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                              Detaljerad budget
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200" />
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-2 space-y-2 text-xs text-muted-foreground">
                              <div>
                                <p className="font-medium text-foreground">Kvar</p>
                                <p>Överförbara: {Math.round(pr.remaining.sicknessTransferable)}</p>
                                <p>Reserverade: {Math.round(pr.remaining.sicknessReserved)}</p>
                                <p>Lägstanivå: {Math.round(pr.remaining.lowest)}</p>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Strategic overview */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Strategisk översikt</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total ersättning</p>
                      <p className="text-xl font-bold">{Math.round(totalGross).toLocaleString()} kr</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Genomsnitt / månad</p>
                      <p className="text-xl font-bold">{Math.round(avgMonthly).toLocaleString()} kr</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Advanced block editor */}
                <div className="space-y-3">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
                  >
                    {showAdvanced ? "Dölj avancerade inställningar" : "Avancerade inställningar"}
                  </button>
                  {showAdvanced && renderBlockEditor()}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Så räknar vi */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center justify-between w-full border-b border-border pb-2 text-sm font-semibold cursor-pointer text-muted-foreground hover:text-foreground [&[data-state=open]>svg]:rotate-180">
                Så räknar vi
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 text-sm text-muted-foreground space-y-2">
                <p>Varje förälder har <span className="font-medium text-foreground">240 dagar</span> totalt: 195 på sjukpenningnivå och 45 på lägstanivå (180 kr/dag).</p>
                <p>Av sjukpenningdagarna är <span className="font-medium text-foreground">90 dagar reserverade</span> per förälder och kan inte överföras. Resterande 105 dagar kan delas.</p>
                <p>SGI-taket är <span className="font-medium text-foreground">592 000 kr/år</span>. Inkomst över taket ger inte högre ersättning.</p>
                <p>Utbetalningen beräknas som <span className="font-medium text-foreground">80 % × 0,97</span> (reduktionsfaktor) av din dagsinkomst.</p>
                <p className="italic">Detta är en simulering – kontrollera alltid med Försäkringskassan innan ni ansöker.</p>
              </CollapsibleContent>
            </Collapsible>

            {/* Action bar */}
            <div className="flex gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={copyPlan}>Kopiera plan</Button>
              <Button variant="outline" size="sm" onClick={sharePlan}>Dela med din partner</Button>
              <Button variant="ghost" size="sm" onClick={handleClearPlan}>Rensa plan</Button>
            </div>
          </>
        );
      })()}

      {viewMode === "result" && !result && (
        <div className="border border-border rounded-lg p-4 bg-card text-center">
          <p className="text-muted-foreground">Laddar simulering…</p>
        </div>
      )}
      <BlockEditDrawer
        mode={drawerMode}
        block={drawerMode === "edit" ? (blocks.find(b => b.id === editingBlockId) ?? null) : null}
        parents={parents}
        allBlocks={blocks}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSave={handleDrawerSave}
        onDelete={handleDrawerDelete}
      />
    </div>
  );
};

export default PlanBuilder;
