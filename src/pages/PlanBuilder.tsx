import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { addMonths, addDays as addDaysUtil, compareDates, isoWeekdayIndex } from "@/utils/dateOnly";
import { ChevronDown } from "lucide-react";
import { simulatePlan } from "@/lib/simulatePlan";
import { FK, FK_CONSTANTS, computeBlockMonthlyBenefit } from "@/lib/fkConstants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { loadPlanInput, savePlanInput } from "@/lib/persistence";
import { assertUniqueBlockIds } from "@/lib/blockIdUtils";
import { normalizeBlocks, applySmartChange } from "@/lib/adjustmentPolicy";
import { canonicalizeBlocks } from "@/lib/canonicalizeBlocks";
import PlanTimeline from "@/components/PlanTimeline";
import BlockEditDrawer from "@/components/BlockEditDrawer";
import SaveDaysDrawer from "@/components/SaveDaysDrawer";
import FitPlanDrawer from "@/components/FitPlanDrawer";
import HandoverDrawer from "@/components/HandoverDrawer";
import DoubleDaysDrawer from "@/components/DoubleDaysDrawer";
import TransferDaysDrawer from "@/components/TransferDaysDrawer";

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
  isOverlap?: boolean;
  source?: "system" | "user";
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
  const [originalBlocks, setOriginalBlocks] = useState<Block[]>([makeBlock("b1")]);
  const [transfer, setTransfer] = useState<{ fromParentId: string; toParentId: string; sicknessDays: number } | null>(null);
  const [_savedDaysCountLegacy, setSavedDaysCount] = useState(0);
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ blocks: Block[]; savedDaysCount: number }[]>([]);
  const [canUndo, setCanUndo] = useState(false);
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
  const [saveDaysOpen, setSaveDaysOpen] = useState(false);
  const [fitPlanOpen, setFitPlanOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [doubleDaysOpen, setDoubleDaysOpen] = useState(false);
  const [transferDaysOpen, setTransferDaysOpen] = useState(false);
  const [hasManualEdits, setHasManualEdits] = useState(false);

  const loadFromLocalStorage = useCallback(() => {
    const saved = loadPlanInput() as any;
    if (saved && saved.parents && saved.blocks && saved.blocks.length > 0) {
      setParents(saved.parents);
      setBlocks(saved.blocks);
      setOriginalBlocks(saved.blocks);
      if (saved.transfers?.length > 0) {
        setTransfer(saved.transfers[0]);
      } else {
        setTransfer(null);
      }
      if (typeof saved.savedDaysCount === "number") {
        setSavedDaysCount(saved.savedDaysCount);
      } else {
        setSavedDaysCount(0);
      }
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
        if (decoded.blocks) setOriginalBlocks(decoded.blocks);
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
    setHistory([]);
    setCanUndo(false);
    navigate("/wizard", { replace: true });
  };

  const pushHistory = () => {
    setHistory(prev => [...prev.slice(-19), { blocks, savedDaysCount }]);
    setCanUndo(true);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setBlocks(prev.blocks);
    setSavedDaysCount(prev.savedDaysCount);
    setHistory(h => h.slice(0, -1));
    setCanUndo(history.length > 1);
    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    savePlanInput({ parents, blocks: prev.blocks, transfers, constants: CONSTANTS, savedDaysCount: prev.savedDaysCount });
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
    setBlocks((prev) => {
      const updated = prev.map((b) => (b.id === id ? { ...b, ...patch } : b));
      // Sync overlap pair daysPerWeek
      if (patch.daysPerWeek !== undefined) {
        const changed = updated.find(b => b.id === id);
        if (changed?.isOverlap) {
          return updated.map(b => {
            if (b.id !== id && b.isOverlap && b.parentId !== changed.parentId &&
                b.startDate === changed.startDate && b.endDate === changed.endDate) {
              return { ...b, daysPerWeek: patch.daysPerWeek! };
            }
            return b;
          });
        }
      }
      return updated;
    });
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
    setHasManualEdits(true);
    if (drawerMode === "create") {
      const newBlocks = normalizeBlocks([...blocks, updated]);
      assertUniqueBlockIds(newBlocks, "drawerSave-create");
      setBlocks(newBlocks);
      const valid = newBlocks.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
      const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
      savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
    } else {
      let replaced = blocks.map(b => b.id === updated.id ? updated : b);
      // Sync overlap pair daysPerWeek
      if (updated.isOverlap) {
        replaced = replaced.map(b => {
          if (b.id !== updated.id && b.isOverlap && b.parentId !== updated.parentId &&
              b.startDate === updated.startDate && b.endDate === updated.endDate) {
            return { ...b, daysPerWeek: updated.daysPerWeek };
          }
          return b;
        });
      }
      const merged = normalizeBlocks(replaced);
      assertUniqueBlockIds(merged, "drawerSave-edit");
      setBlocks(merged);
      const valid = merged.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
      const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
      savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
    }
  };

  const handleDrawerDelete = (id: string) => {
    setHasManualEdits(true);
    removeBlock(id);
    const remaining = blocks.filter(b => b.id !== id);
    const valid = remaining.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
    savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
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
      const r = simulatePlan(planInput);
      console.group('[PLAN] Simulation result');
      console.log('[PLAN] unfulfilledDaysTotal =', r.unfulfilledDaysTotal);
      for (const pr of r.parentsResult) {
        const totalTaken = pr.taken.sickness + pr.taken.lowest;
        console.log(`[PLAN] ${pr.parentId}: taken.sickness=${pr.taken.sickness}, taken.lowest=${pr.taken.lowest}, TOTAL_TAKEN=${totalTaken}, remaining.transferable=${pr.remaining.sicknessTransferable}, remaining.reserved=${pr.remaining.sicknessReserved}, remaining.lowest=${pr.remaining.lowest}`);
      }
      console.groupEnd();
      return r;
    } catch {
      return null;
    }
  }, [planInput]);

  const savedDaysCount = useMemo(() => {
    if (!result) return 0;
    const currentRemaining = Math.round(
      result.parentsResult.reduce(
        (s: number, pr: any) => s + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest, 0
      )
    );
    try {
      const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
      const maxResult = simulatePlan({ parents, blocks: [], transfers, constants: CONSTANTS });
      const maxDays = Math.round(
        maxResult.parentsResult.reduce(
          (s: number, pr: any) => s + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest, 0
        )
      );
      return currentRemaining;
    } catch { return 0; }
  }, [result, parents, transfer]);

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
                <div key={b.overlapGroupId} data-overlap="true" className="border-2 border-dashed border-accent rounded-lg p-3 space-y-3 transition-all">
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
                const end1 = addMonths(dueDate, months1);
                const end2 = addMonths(end1, months2);
                const b1: Block = { id: `b${nextId++}`, parentId: "p1", startDate: dueDate, endDate: end1, daysPerWeek: 5, source: "system" };
                const b2: Block = { id: `b${nextId++}`, parentId: "p2", startDate: end1, endDate: end2, daysPerWeek: 5, source: "system" };
                setBlocks([b1, b2]);
                setOriginalBlocks([b1, b2]);
                setTransfer(null);
                setSavedDaysCount(0);
                setTransferAmount(0);
                setTransferError(null);
                setHistory([]);
                setCanUndo(false);
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

        // Compute avg as total FK benefit across all blocks / total plan months
        const computedAvg = (() => {
          const summary = result.parentSummary ?? [];
          if (summary.length === 0 || validBlocks.length === 0) return avgMonthly;
          let totalBenefitMonths = 0;
          let totalMonths = 0;
          for (const b of validBlocks) {
            const parent = parents.find(p => p.id === b.parentId);
            if (!parent) continue;
            // Approximate duration in months
            const startMs = new Date(b.startDate + "T12:00:00").getTime();
            const endMs = new Date(b.endDate + "T12:00:00").getTime();
            const dayCount = Math.round((endMs - startMs) / 86400000) + 1;
            const durationMonths = dayCount / 30.44;
            const monthlyForBlock = computeBlockMonthlyBenefit(parent.monthlyIncomeFixed, b.daysPerWeek);
            totalBenefitMonths += monthlyForBlock * durationMonths;
            totalMonths += durationMonths;
          }
          return totalMonths > 0 ? totalBenefitMonths / totalMonths : avgMonthly;
        })();

        const totalAll = result.parentsResult.reduce((s, pr) => s + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest, 0);
        const unfulfilled = result.unfulfilledDaysTotal ?? 0;

        const startYear = validBlocks.length > 0 ? validBlocks.reduce((min, b) => b.startDate < min ? b.startDate : min, validBlocks[0].startDate).slice(0, 4) : "";
        const endYear = validBlocks.length > 0 ? validBlocks.reduce((max, b) => b.endDate > max ? b.endDate : max, validBlocks[0].endDate).slice(0, 4) : "";
        const planTitle = parents.length >= 2
          ? `${parents[0].name} & ${parents[1].name} – Planerad ledighet ${startYear}–${endYear}`
          : `${parents[0].name} – Planerad ledighet ${startYear}–${endYear}`;

        return (
          <>
            {/* ── PERSONALIZED HEADER ── */}
            <p className="text-center text-sm font-medium text-muted-foreground tracking-wide pt-4">{planTitle}</p>

            {/* ── HERO ── */}
            <section className="text-center space-y-6 py-4">
              <h1 className="text-3xl font-bold tracking-tight">Er plan i korthet</h1>
              <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Planen räcker till</p>
                  <p className="text-xl font-bold mt-1">{latestEnd ? (() => {
                    try {
                      const d = new Date(latestEnd + "T12:00:00");
                      return d.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });
                    } catch { return latestEnd; }
                  })() : "—"}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Genomsnittlig ersättning</p>
                  <p className="text-xl font-bold mt-1">{Math.round(computedAvg).toLocaleString()} kr/mån</p>
                </div>
              </div>

              {/* Per-parent days remaining */}
              <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
                {result.parentsResult.map((pr, i) => {
                  const daysLeft = Math.round(pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest);
                  const totalBudget = 480;
                  const used = Math.round(pr.taken.sickness + pr.taken.lowest);
                  const pct = totalBudget > 0 ? Math.min(100, Math.round((used / totalBudget) * 100)) : 0;
                  const isP1 = pr.parentId === "p1";
                  return (
                    <div key={pr.parentId} className={`rounded-lg border p-4 text-center ${isP1 ? "border-blue-200 bg-blue-50/50" : "border-emerald-200 bg-emerald-50/50"}`}>
                      <p className={`text-xs font-medium uppercase tracking-wide ${isP1 ? "text-blue-600" : "text-emerald-600"}`}>{pr.name}</p>
                      <p className="text-2xl font-bold mt-1">{daysLeft} <span className="text-sm font-normal text-muted-foreground">dagar kvar</span></p>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isP1 ? "bg-blue-400" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{Math.round(pr.taken.sickness + pr.taken.lowest)} av {totalBudget} använda</p>
                    </div>
                  );
                })}
              </div>

              {unfulfilled > 0 ? (
                <div className="max-w-md mx-auto space-y-3">
                  <p className="text-sm text-destructive font-medium">
                    ⚠ {(() => {
                      const householdTransferable = result.parentsResult.reduce((s, pr) => s + pr.remaining.sicknessTransferable, 0);
                      const hasTransfer = householdTransferable > 0;
                      const needsWeeks = unfulfilled > Math.floor(householdTransferable);
                      if (hasTransfer && needsWeeks) return "Planen kräver omfördelning av dagar och justering av uttagstakt för att gå ihop.";
                      if (hasTransfer) return "Planen kräver omfördelning av dagar mellan er för att gå ihop.";
                      if (needsWeeks) return "Planen kräver att ni minskar uttagstakten för att gå ihop.";
                      return "Planen behöver justeras.";
                    })()}
                  </p>
                  <div className="flex gap-3 justify-center">
                    <Button size="lg" onClick={() => setFitPlanOpen(true)}>
                      Auto-justera
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() => {
                        setTimeout(() => document.getElementById("adjust-panel")?.scrollIntoView({ behavior: "smooth" }), 100);
                      }}
                    >
                      Justera manuellt
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    ✓ Planen ser balanserad ut. Ni kan justera detaljer eller testa alternativa upplägg.
                  </p>
                  <Button
                    size="lg"
                    onClick={() => {
                      setTimeout(() => document.getElementById("adjust-panel")?.scrollIntoView({ behavior: "smooth" }), 100);
                    }}
                  >
                    Justera planen
                  </Button>
                </>
              )}
            </section>
            {/* ── INFO PANEL ── */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center justify-between w-full text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                Så fungerar beräkningen
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 pb-1">
                <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                  <li>Vi utgår från era inkomster och gällande ersättningstak.</li>
                  <li>Uttag beräknas per vecka (vardagar först).</li>
                  <li>Reserverade dagar används före överförbara.</li>
                  <li>Resultatet är en simulering och kan skilja något från Försäkringskassans slutliga beslut.</li>
                </ul>
              </CollapsibleContent>
            </Collapsible>

            {/* ── TIMELINE ── */}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Tidslinje</h2>
              <PlanTimeline
                blocks={validBlocks}
                parents={parents}
                unfulfilledDaysTotal={unfulfilled}
                onBlockClick={handleTimelineBlockClick}
                onDeleteOverlap={(blockId) => {
                  if (window.confirm("Ta bort dubbeldagarna?")) {
                    const updated = blocks.filter(b => b.id !== blockId);
                    setBlocks(updated);
                    const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
                    savePlanInput({ parents, blocks: updated, transfers, constants: CONSTANTS, savedDaysCount });
                  }
                }}
              />
              <div className="flex justify-end pt-1">
                <Button variant="outline" size="sm" onClick={handleAddPeriod}>+ Lägg till period</Button>
              </div>
            </section>

            {/* ── JUSTERA PLANEN ── */}
            <div id="adjust-panel" className="rounded-lg border border-border bg-muted/30">
              <div className="px-5 pt-4 pb-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Justera planen</p>
              </div>
              <div className="divide-y divide-border">
                {/* Växlingsdatum */}
                {parents.length >= 2 && (
                  <div
                    className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => setHandoverOpen(true)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">Växlingsdatum</p>
                      <p className="text-sm text-muted-foreground">Styr när föräldrarnas ledigheter avlöser varandra</p>
                    </div>
                    <div className="flex-shrink-0 text-right ml-4">
                      <p className="text-sm text-foreground font-medium">
                        {(() => {
                          const p1Blocks = validBlocks.filter(b => b.parentId === parents[0].id && !b.isOverlap);
                          if (p1Blocks.length === 0) return "Inte inställt";
                          const p1End = p1Blocks.reduce((max, b) => b.endDate > max ? b.endDate : max, p1Blocks[0].endDate);
                          try {
                            const d = new Date(p1End + "T12:00:00");
                            return `${parents[0].name} lämnar ${d.toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" })}`;
                          } catch {
                            return "Inte inställt";
                          }
                        })()}
                      </p>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-3 py-1 transition-colors cursor-pointer">Justera <span>→</span></span>
                    </div>
                  </div>
                )}

                {/* Sparade dagar */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setSaveDaysOpen(true)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">Sparade dagar</p>
                    <p className="text-sm text-muted-foreground">Håll dagar i reserv för VAB eller oplanerad ledighet</p>
                  </div>
                  <div className="flex-shrink-0 text-right ml-4">
                    <p className="text-sm text-foreground font-medium">
                      {savedDaysCount > 0 ? `${savedDaysCount} dagar sparade` : "Inga sparade dagar"}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-3 py-1 transition-colors cursor-pointer">Justera <span>→</span></span>
                  </div>
                </div>

                {/* Dagöverföring */}
                {parents.length >= 2 && (
                  <div
                    className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => setTransferDaysOpen(true)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">Dagöverföring</p>
                      <p className="text-sm text-muted-foreground">Flytta dagar permanent från en förälders kvot till den andres</p>
                    </div>
                    <div className="flex-shrink-0 text-right ml-4">
                      <p className="text-sm text-foreground font-medium">
                        {transfer && transfer.sicknessDays > 0
                          ? `${transfer.sicknessDays} dagar ${parents.find(p => p.id === transfer.fromParentId)?.name ?? "?"} → ${parents.find(p => p.id === transfer.toParentId)?.name ?? "?"}`
                          : "Ingen överföring"}
                      </p>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-3 py-1 transition-colors cursor-pointer">Justera <span>→</span></span>
                    </div>
                  </div>
                )}

                {/* Dubbeldagar */}
                {parents.length >= 2 && (() => {
                  const overlaps = blocks.filter(b => b.isOverlap === true);
                  let overlapDayCount = 0;
                  if (overlaps.length > 0) {
                    const seen = new Set<string>();
                    for (const ob of overlaps) {
                      const key = `${ob.startDate}_${ob.endDate}`;
                      if (seen.has(key)) continue;
                      seen.add(key);
                      for (let d = ob.startDate; compareDates(d, ob.endDate) <= 0; d = addDaysUtil(d, 1)) {
                        const wd = isoWeekdayIndex(d);
                        if (wd < 5) overlapDayCount++;
                      }
                    }
                  }

                  return (
                    <div
                      className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => setDoubleDaysOpen(true)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">Dubbeldagar</p>
                        <p className="text-sm text-muted-foreground">Båda tar ut ersättning samtidigt — max 30 dagar under barnets första år</p>
                      </div>
                      <div className="flex-shrink-0 text-right ml-4">
                        <p className="text-sm text-foreground font-medium">
                          {overlaps.length > 0 ? `${overlapDayCount} dagar inlagda` : "Inga dubbeldagar"}
                        </p>
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-3 py-1 transition-colors cursor-pointer">
                          Lägg till <span>→</span>
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Ångra senaste ändring */}
                <div className="px-5 py-3 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canUndo}
                    onClick={handleUndo}
                    className="w-full text-muted-foreground"
                  >
                    ↩ Ångra senaste ändring
                  </Button>
                </div>
              </div>
            </div>

            {/* ── ERSÄTTNING PER FÖRÄLDER ── */}
            {(result.parentSummary ?? []).length > 0 && (() => {
              const svMonths = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
              const fmtPeriod = (start: string, end: string) => {
                const [sy, sm] = start.split("-").map(Number);
                const [ey, em] = end.split("-").map(Number);
                const s = `${svMonths[sm - 1]}`;
                const e = `${svMonths[em - 1]}`;
                if (sy === ey) return `${s} – ${e} ${ey}`;
                return `${s} ${sy} – ${e} ${ey}`;
              };
              const hasAnyAboveTak = result.parentSummary.some(s => s.isAboveSgiTak);
              return (
              <section className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                <div className="px-5 pt-4 pb-2">
                  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Ersättning per förälder</p>
                </div>
                {result.parentSummary.map(s => {
                  const parentBlocks = blocks
                    .filter(b => b.parentId === s.parentId && !b.isOverlap)
                    .sort((a, b) => a.startDate.localeCompare(b.startDate));
                  return (
                    <div key={s.parentId} className="px-5 py-4 space-y-2">
                      <p className="font-medium text-foreground">{s.name}</p>
                      {parentBlocks.map(b => {
                        const monthlyFull = computeBlockMonthlyBenefit(
                          parents.find(p => p.id === s.parentId)?.monthlyIncomeFixed ?? 0,
                          5
                        );
                        const monthly = monthlyFull * (b.daysPerWeek / 5);
                        return (
                          <div key={b.id} className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">{fmtPeriod(b.startDate, b.endDate)} · {b.daysPerWeek} dagar/v</span>
                            <span className="font-medium text-foreground tabular-nums">≈ {Math.round(monthly).toLocaleString("sv-SE")} kr/mån</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                <div className="px-5 py-3">
                  <p className="text-xs text-muted-foreground">
                    {hasAnyAboveTak
                      ? `FK betalar 77,6% av din lön upp till taket (${Math.round(FK.sgiTakArslon / 12).toLocaleString("sv-SE")} kr/mån). Lön därutöver ersätts inte.`
                      : "FK betalar 77,6% av din lön."}
                  </p>
                </div>
              </section>
              );
            })()}


            {/* Disclaimer */}
            <p className="text-xs text-muted-foreground italic text-center">
              Detta är en simulering – kontrollera alltid med Försäkringskassan innan ni ansöker.
            </p>

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
      <SaveDaysDrawer
        open={saveDaysOpen}
        onOpenChange={setSaveDaysOpen}
        blocks={blocks.filter(b => !blockErrors.get(b.id)).sort((a, b) => a.startDate.localeCompare(b.startDate))}
        parents={parents}
        constants={CONSTANTS}
        transfer={transfer}
        hasManualEdits={hasManualEdits}
        onApply={(newBlocks) => {
          pushHistory();
          // Blocks are already canonicalized by the drawer — apply idempotently
          const merged = canonicalizeBlocks(newBlocks);
          assertUniqueBlockIds(merged, "SaveDaysDrawer-apply");
          setBlocks(merged);
          setOriginalBlocks(merged);
          setHasManualEdits(false);
          const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
          savePlanInput({ parents, blocks: merged, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
      <FitPlanDrawer
        open={fitPlanOpen}
        onOpenChange={setFitPlanOpen}
        blocks={blocks.sort((a, b) => a.startDate.localeCompare(b.startDate))}
        parents={parents}
        constants={CONSTANTS}
        transfer={transfer}
        onApply={(newBlocks, newTransfer) => {
          pushHistory();
          const withSource = newBlocks.map(b => ({ ...b, source: (b as any).source ?? ("system" as const) }));
          const normalized = canonicalizeBlocks(withSource);
          assertUniqueBlockIds(normalized, "FitPlanDrawer-apply");
          setBlocks(normalized);
          setOriginalBlocks(normalized);
          setTransfer(newTransfer);
          const transfers = newTransfer && newTransfer.sicknessDays > 0 ? [newTransfer] : [];
          savePlanInput({ parents, blocks: normalized, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
      <HandoverDrawer
        open={handoverOpen}
        onOpenChange={setHandoverOpen}
        blocks={blocks.filter(b => !blockErrors.get(b.id)).sort((a, b) => a.startDate.localeCompare(b.startDate))}
        parents={parents}
        constants={CONSTANTS}
        transfer={transfer}
        onApply={(newBlocks) => {
          pushHistory();
          const merged = canonicalizeBlocks(newBlocks);
          assertUniqueBlockIds(merged, "HandoverDrawer-apply");
          setBlocks(merged);
          const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
          savePlanInput({ parents, blocks: merged, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
      <DoubleDaysDrawer
        open={doubleDaysOpen}
        onOpenChange={setDoubleDaysOpen}
        parents={parents}
        onApply={(newBlocks) => {
          pushHistory();
          const updated = canonicalizeBlocks([...blocks, ...newBlocks]);
          assertUniqueBlockIds(updated, "DoubleDaysDrawer-apply");
          setBlocks(updated);
          const transfers = transfer && transfer.sicknessDays > 0 ? [transfer] : [];
          savePlanInput({ parents, blocks: updated, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
      <TransferDaysDrawer
        open={transferDaysOpen}
        onOpenChange={setTransferDaysOpen}
        blocks={blocks.filter(b => !blockErrors.get(b.id)).sort((a, b) => a.startDate.localeCompare(b.startDate))}
        parents={parents}
        constants={CONSTANTS}
        transfer={transfer}
        onApply={(newTransfer) => {
          setTransfer(newTransfer);
          setTransferAmount(newTransfer?.sicknessDays ?? 0);
          setTransferError(null);
          const transfers = newTransfer && newTransfer.sicknessDays > 0 ? [newTransfer] : [];
          const valid = blocks.filter(b => !blockErrors.get(b.id)).sort((a, b) => a.startDate.localeCompare(b.startDate));
          savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
    </div>
  );
};

export default PlanBuilder;
