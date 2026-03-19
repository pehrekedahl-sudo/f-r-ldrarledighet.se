import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { addMonths, addDays as addDaysUtil, compareDates, isoWeekdayIndex, diffDaysInclusive, toLocalDate, todayISO } from "@/utils/dateOnly";
import { ChevronDown, CalendarPlus, Users, CalendarSync, PiggyBank, ArrowLeftRight, UserPlus, ClipboardList } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
import DoubleDaysDrawer, { type CompensationMode } from "@/components/DoubleDaysDrawer";
import { adjustToTarget, calcRemaining, getTransfers } from "@/components/SaveDaysDrawer";
import TransferDaysDrawer from "@/components/TransferDaysDrawer";
import FKGuideDrawer from "@/components/FKGuideDrawer";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_PARENTS = [
  { id: "p1", name: "Anna", monthlyIncomeFixed: 45000, has240Days: true, topUpMonthly: 0 },
  { id: "p2", name: "Erik", monthlyIncomeFixed: 38000, has240Days: true, topUpMonthly: 0 },
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

/** Check if a transfer has any active days (sickness or lowest) */
function hasActiveTransfer(t: { sicknessDays: number; lowestDays?: number } | null | undefined): boolean {
  return !!t && (t.sicknessDays > 0 || (t.lowestDays ?? 0) > 0);
}

function transferToArray(t: { sicknessDays: number; lowestDays?: number; fromParentId: string; toParentId: string } | null | undefined) {
  return hasActiveTransfer(t) ? [t!] : [];
}

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
  const [transfer, setTransfer] = useState<{ fromParentId: string; toParentId: string; sicknessDays: number; lowestDays?: number } | null>(null);
  // savedDaysCount is derived via useMemo — no separate state needed
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ blocks: Block[]; transfer: typeof transfer }[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [months1, setMonths1] = useState(6);
  const [months2, setMonths2] = useState(6);
  const [isSharedPlan, setIsSharedPlan] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "result">("result");
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
  const [fkGuideOpen, setFkGuideOpen] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);

  const loadFromLocalStorage = useCallback(() => {
    const saved = loadPlanInput() as any;
    if (saved && saved.parents && saved.blocks && saved.blocks.length > 0) {
      setParents(saved.parents);
      if (saved.parents.some((p: any) => (p.topUpMonthly ?? 0) > 0)) setShowTopUp(true);
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
        if (decoded.parents) {
          setParents(decoded.parents);
          if (decoded.parents.some((p: any) => (p.topUpMonthly ?? 0) > 0)) setShowTopUp(true);
        }
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
    setHistory(prev => [...prev.slice(-19), { blocks, transfer }]);
    setCanUndo(true);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setBlocks(prev.blocks);
    setSavedDaysCount(prev.savedDaysCount);
    setHistory(h => h.slice(0, -1));
    setCanUndo(history.length > 1);
    const transfers = transferToArray(transfer);
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
      const transfers = transferToArray(transfer);
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
      const transfers = transferToArray(transfer);
      savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
    }
  };

  const handleDrawerDelete = (id: string) => {
    setHasManualEdits(true);
    removeBlock(id);
    const remaining = blocks.filter(b => b.id !== id);
    const valid = remaining.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transferToArray(transfer);
    savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
  };

  const handleSplitBlock = (blockId: string, splitDate: string) => {
    setHasManualEdits(true);
    pushHistory();
    const target = blocks.find(b => b.id === blockId);
    if (!target) return;
    const block1: Block = {
      ...target,
      endDate: addDaysUtil(splitDate, -1),
    };
    const block2: Block = {
      ...target,
      id: `b${Date.now()}-split`,
      startDate: splitDate,
      source: "user",
    };
    const newBlocks = blocks.map(b => b.id === blockId ? block1 : b).concat(block2);
    const normalized = normalizeBlocks(newBlocks);
    assertUniqueBlockIds(normalized, "splitBlock");
    setBlocks(normalized);
    const valid = normalized.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transferToArray(transfer);
    savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
    toast({ description: "Blocket har delats i två." });
  };

  const handleMergeBlock = (blockId: string, direction: "prev" | "next") => {
    setHasManualEdits(true);
    pushHistory();
    const target = blocks.find(b => b.id === blockId);
    if (!target) return;
    const siblings = blocks
      .filter(b => b.parentId === target.parentId && !b.isOverlap && b.id !== target.id)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    let neighbor: Block | null = null;
    for (const s of siblings) {
      if (direction === "prev" && addDaysUtil(s.endDate, 1) === target.startDate) neighbor = s;
      if (direction === "next" && addDaysUtil(target.endDate, 1) === s.startDate) neighbor = s;
    }
    if (!neighbor) return;
    // Merged block keeps target's dpw, spans both date ranges
    const mergedBlock: Block = {
      ...target,
      startDate: direction === "prev" ? neighbor.startDate : target.startDate,
      endDate: direction === "next" ? neighbor.endDate : target.endDate,
      source: "user",
    };
    const newBlocks = blocks
      .filter(b => b.id !== neighbor!.id)
      .map(b => b.id === blockId ? mergedBlock : b);
    const normalized = normalizeBlocks(newBlocks);
    assertUniqueBlockIds(normalized, "mergeBlock");
    setBlocks(normalized);
    const valid = normalized.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transferToArray(transfer);
    savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
    toast({ description: "Blocken har slagits ihop." });
  };

  const handleBlockResize = (blockId: string, newStart: string, newEnd: string) => {
    setHasManualEdits(true);
    pushHistory();
    const target = blocks.find(b => b.id === blockId);
    if (!target || target.isOverlap) return;
    if (compareDates(newEnd, newStart) < 0) return;

    // Find DD blocks for the same parent that overlap with [newStart, newEnd]
    const ddBlocks = blocks
      .filter(b => b.isOverlap && b.parentId === target.parentId)
      .filter(b => compareDates(b.startDate, newEnd) <= 0 && compareDates(b.endDate, newStart) >= 0)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Split the resized block around DD blocks
    let segments: { start: string; end: string }[] = [{ start: newStart, end: newEnd }];
    for (const dd of ddBlocks) {
      const newSegs: { start: string; end: string }[] = [];
      for (const seg of segments) {
        if (compareDates(dd.endDate, seg.start) < 0 || compareDates(dd.startDate, seg.end) > 0) {
          newSegs.push(seg);
          continue;
        }
        if (compareDates(seg.start, dd.startDate) < 0) {
          newSegs.push({ start: seg.start, end: addDaysUtil(dd.startDate, -1) });
        }
        if (compareDates(seg.end, dd.endDate) > 0) {
          newSegs.push({ start: addDaysUtil(dd.endDate, 1), end: seg.end });
        }
      }
      segments = newSegs;
    }

    // Build new blocks from segments
    const newBlockSegments: Block[] = segments
      .filter(seg => compareDates(seg.end, seg.start) >= 0)
      .map((seg, i) => ({
        ...target,
        id: i === 0 ? target.id : `${target.id}-resize-${i}`,
        startDate: seg.start,
        endDate: seg.end,
        source: "user" as const,
      }));

    if (newBlockSegments.length === 0) return;

    // Replace the original block with the new segments
    const otherBlocks = blocks.filter(b => b.id !== blockId);

    // Truncate or remove sibling blocks (same parent, non-overlap) that overlap with the new range
    const truncatedOther = otherBlocks.flatMap(b => {
      // Only truncate regular blocks for the same parent
      if (b.parentId !== target.parentId || b.isOverlap) return [b];
      // Completely outside → keep as-is
      if (compareDates(b.endDate, newStart) < 0 || compareDates(b.startDate, newEnd) > 0) return [b];
      // Completely inside → remove
      if (compareDates(b.startDate, newStart) >= 0 && compareDates(b.endDate, newEnd) <= 0) return [];
      // Partial overlap — truncate
      const result: Block[] = [];
      if (compareDates(b.startDate, newStart) < 0) {
        result.push({ ...b, id: b.id, endDate: addDaysUtil(newStart, -1) });
      }
      if (compareDates(b.endDate, newEnd) > 0) {
        result.push({ ...b, id: result.length > 0 ? `${b.id}-trunc` : b.id, startDate: addDaysUtil(newEnd, 1) });
      }
      return result.filter(r => compareDates(r.endDate, r.startDate) >= 0);
    });

    const newBlocks = [...truncatedOther, ...newBlockSegments];
    const normalized = normalizeBlocks(newBlocks);
    assertUniqueBlockIds(normalized, "blockResize");
    setBlocks(normalized);
    const valid = normalized.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transferToArray(transfer);
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
    const transfers = transferToArray(transfer);
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
      const transfers = transferToArray(transfer);
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
      <div className="max-w-lg mx-auto px-6 py-24 space-y-6">
        <div className="space-y-3">
          <div className="h-6 w-2/3 mx-auto rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-1/2 mx-auto rounded-md bg-muted animate-pulse" />
        </div>
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
        <div className="h-40 rounded-lg bg-muted animate-pulse" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-28 rounded-lg bg-muted animate-pulse" />
          <div className="h-28 rounded-lg bg-muted animate-pulse" />
        </div>
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
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {isSharedPlan && (
        <div className="border border-border rounded-lg p-3 bg-muted text-sm text-muted-foreground text-center">
          Du tittar på en delad plan
        </div>
      )}

      {viewMode === "edit" && (
        <>
          {/* Hero */}
          <div className="space-y-3 text-center">
            <h1 className="text-2xl font-normal tracking-tight" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>Planera er föräldraledighet på 5 minuter</h1>
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

          <Button className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground" size="lg" disabled={!result} onClick={() => { setViewMode("result"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
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
            const dayCount = diffDaysInclusive(b.startDate, b.endDate);
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

        const formattedEnd = latestEnd ? (() => {
          try {
            return toLocalDate(latestEnd).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" });
          } catch { return latestEnd; }
        })() : "—";

        return (
          <>
            {/* ── BANNER ── */}
            <section className="rounded-xl border border-border bg-gradient-to-r from-[#edf7f5]/60 to-[#fdf0ec]/60 px-5 py-4 mt-4 space-y-3">
              {/* Row 1: Title + KPIs + Actions */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-base font-semibold text-foreground truncate">{planTitle}</h1>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                  <div className="flex gap-4 text-sm">
                    <div className="text-left sm:text-center">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Räcker till</p>
                      <p className="font-bold text-foreground">{formattedEnd}</p>
                    </div>
                    <div className="w-px bg-border/60" />
                    <div className="text-left sm:text-center">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Snitt/mån</p>
                      <p className="font-bold text-foreground">~{Math.round(computedAvg).toLocaleString()} kr</p>
                    </div>
                  </div>
                  <div className="w-px h-6 bg-border/60 hidden sm:block" />
                  <div className="flex gap-1.5 flex-wrap">
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={copyPlan}>Kopiera</Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={sharePlan}>Dela</Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground" onClick={handleClearPlan}>Rensa</Button>
                  </div>
                </div>
              </div>

              {/* Row 2: Parent pills + status/actions */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex gap-2 flex-wrap">
                  {result.parentsResult.map((pr) => {
                    const daysLeft = Math.round(pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest);
                    const totalBudget = 480;
                    const used = Math.round(pr.taken.sickness + pr.taken.lowest);
                    const pct = totalBudget > 0 ? Math.min(100, Math.round((used / totalBudget) * 100)) : 0;
                    const isP1 = pr.parentId === "p1";
                    return (
                      <div key={pr.parentId} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${isP1 ? "border-[#4A9B8E]/30 bg-white/80" : "border-[#E8735A]/30 bg-white/80"}`}>
                        <span className={`inline-block w-2 h-2 rounded-full ${isP1 ? "bg-[#4A9B8E]" : "bg-[#E8735A]"}`} />
                        <span className="font-medium">{pr.name}</span>
                        <span className="text-muted-foreground">{daysLeft} kvar</span>
                        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ease-out ${isP1 ? "bg-[#4A9B8E]" : "bg-[#E8735A]"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {unfulfilled > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-destructive font-medium whitespace-nowrap">
                      ⚠ {(() => {
                        const householdTransferable = result.parentsResult.reduce((s, pr) => s + pr.remaining.sicknessTransferable, 0);
                        const hasTransfer = householdTransferable > 0;
                        const needsWeeks = unfulfilled > Math.floor(householdTransferable);
                        if (hasTransfer && needsWeeks) return "Kräver omfördelning & justering";
                        if (hasTransfer) return "Kräver omfördelning av dagar";
                        if (needsWeeks) return "Minska uttagstakten";
                        return "Behöver justeras";
                      })()}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" onClick={() => setFitPlanOpen(true)}>Auto-justera</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                        setTimeout(() => document.getElementById("adjust-panel")?.scrollIntoView({ behavior: "smooth" }), 100);
                      }}>Justera manuellt</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#b85240] font-medium">✓ Balanserad</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                      setTimeout(() => document.getElementById("adjust-panel")?.scrollIntoView({ behavior: "smooth" }), 100);
                    }}>Justera</Button>
                  </div>
                )}
              </div>
            </section>

            {/* ── TIMELINE ── */}
            <section className="space-y-3">
              <h2 className="text-lg font-medium tracking-tight">Tidslinje</h2>
              <PlanTimeline
                blocks={validBlocks}
                parents={parents}
                unfulfilledDaysTotal={unfulfilled}
                todayDate={todayISO()}
                onBlockClick={handleTimelineBlockClick}
                onBlockResize={handleBlockResize}
                onDeleteOverlap={(blockId) => {
                  if (window.confirm("Ta bort dubbeldagarna?")) {
                    const updated = blocks.filter(b => b.id !== blockId);
                    setBlocks(updated);
                    const transfers = transferToArray(transfer);
                    savePlanInput({ parents, blocks: updated, transfers, constants: CONSTANTS, savedDaysCount });
                  }
                }}
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" className="text-[#2d7a6f] hover:text-[#1f6059] hover:bg-[#edf7f5] border border-[#4A9B8E]/30" onClick={handleAddPeriod}>
                  <CalendarPlus className="w-3.5 h-3.5" />
                  Lägg till block
                </Button>
                {parents.length >= 2 && (
                  <Button variant="ghost" size="sm" className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 border border-purple-200/60" onClick={() => setDoubleDaysOpen(true)}>
                    <Users className="w-3.5 h-3.5" />
                    Dubbeldagar
                  </Button>
                )}
              </div>
            </section>

            {/* ── TWO-COLUMN: JUSTERA + ERSÄTTNING ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Justera planen */}
              <div id="adjust-panel" className="rounded-lg border border-border bg-muted/30">
                <div className="px-4 pt-3 pb-1.5">
                  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Justera planen</p>
                </div>
                <div className="divide-y divide-border">
                  {/* Växlingsdatum */}
                  {parents.length >= 2 && (
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-all duration-200"
                      onClick={() => setHandoverOpen(true)}
                    >
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <CalendarSync className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm text-foreground">Växlingsdatum</p>
                          <p className="text-xs text-muted-foreground">När ledigheter avlöser varandra</p>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right ml-3">
                        <p className="text-xs text-foreground font-medium">
                          {(() => {
                            const p1Blocks = validBlocks.filter(b => b.parentId === parents[0].id && !b.isOverlap);
                            if (p1Blocks.length === 0) return "Inte inställt";
                            const p1End = p1Blocks.reduce((max, b) => b.endDate > max ? b.endDate : max, p1Blocks[0].endDate);
                            try {
                              return `${parents[0].name} → ${toLocalDate(p1End).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}`;
                            } catch {
                              return "Inte inställt";
                            }
                          })()}
                        </p>
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-0.5 cursor-pointer">Justera →</span>
                      </div>
                    </div>
                  )}

                  {/* Sparade dagar */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-all duration-200"
                    onClick={() => setSaveDaysOpen(true)}
                  >
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <PiggyBank className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm text-foreground">Sparade dagar</p>
                        <p className="text-xs text-muted-foreground">Reserv för VAB eller oplanerad ledighet</p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right ml-3">
                      <p className="text-xs text-foreground font-medium">
                        {savedDaysCount > 0 ? `${savedDaysCount} dagar` : "Inga"}
                      </p>
                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-0.5 cursor-pointer">Justera →</span>
                    </div>
                  </div>

                  {/* Överförda dagar */}
                  {parents.length >= 2 && (
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-all duration-200"
                      onClick={() => setTransferDaysOpen(true)}
                    >
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <ArrowLeftRight className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm text-foreground">Överförda dagar</p>
                          <p className="text-xs text-muted-foreground">Flytta dagar mellan föräldrar</p>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right ml-3">
                        <p className="text-xs text-foreground font-medium">
                          {hasActiveTransfer(transfer)
                            ? (() => {
                                const parts: string[] = [];
                                if (transfer!.sicknessDays > 0) parts.push(`${transfer!.sicknessDays} sjukp.`);
                                if ((transfer!.lowestDays ?? 0) > 0) parts.push(`${transfer!.lowestDays} lägsta`);
                                return `${parts.join(" + ")} ${parents.find(p => p.id === transfer!.fromParentId)?.name ?? "?"} → ${parents.find(p => p.id === transfer!.toParentId)?.name ?? "?"}`;
                              })()
                            : "Ingen"}
                        </p>
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-0.5 cursor-pointer">Justera →</span>
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
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-all duration-200"
                        onClick={() => setDoubleDaysOpen(true)}
                      >
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <UserPlus className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-sm text-foreground">Dubbeldagar</p>
                            <p className="text-xs text-muted-foreground">Båda tar ut ersättning samtidigt</p>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right ml-3">
                          <p className="text-xs text-foreground font-medium">
                            {overlaps.length > 0 ? `${overlapDayCount} dagar` : "Inga"}
                          </p>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-0.5 cursor-pointer">Lägg till →</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Ångra */}
                  <div className="px-4 py-2">
                    <Button variant="ghost" size="sm" disabled={!canUndo} onClick={handleUndo} className="w-full text-xs text-muted-foreground h-7">
                      ↩ Ångra senaste ändring
                    </Button>
                  </div>
                </div>
              </div>

              {/* Right: Ersättning per förälder */}
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
                    <div className="px-4 pt-3 pb-1.5">
                      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Ersättning per förälder <span className="normal-case font-normal text-xs">(före skatt)</span></p>
                    </div>
                    {result.parentSummary.map(s => {
                      const parentBlocks = blocks
                        .filter(b => b.parentId === s.parentId && !b.isOverlap)
                        .sort((a, b) => a.startDate.localeCompare(b.startDate));
                      return (
                        <div key={s.parentId} className={`px-4 py-3 space-y-1.5 border-l-[3px] ${s.parentId === "p1" ? "border-l-[#4A9B8E]" : "border-l-[#E8735A]"}`}>
                          <p className="font-medium text-sm text-foreground">{s.name}</p>
                          {parentBlocks.map(b => {
                            const monthlyFull = computeBlockMonthlyBenefit(
                              parents.find(p => p.id === s.parentId)?.monthlyIncomeFixed ?? 0,
                              5
                            );
                            const fkMonthly = monthlyFull * (b.daysPerWeek / 5);
                            const topUp = (parents.find(p => p.id === s.parentId)?.topUpMonthly ?? 0) * Math.min(1, b.daysPerWeek / 5);
                            const totalMonthly = fkMonthly + topUp;
                            return (
                              <div key={b.id} className="text-xs">
                                <div className="flex items-baseline justify-between">
                                  <span className="text-muted-foreground">{fmtPeriod(b.startDate, b.endDate)} · {b.daysPerWeek} d/v</span>
                                  <span className="font-medium text-foreground tabular-nums">≈ {Math.round(totalMonthly).toLocaleString("sv-SE")} kr/mån</span>
                                </div>
                                {topUp > 0 && (
                                  <p className="text-[10px] text-muted-foreground text-right tabular-nums">
                                    FK {Math.round(fkMonthly).toLocaleString("sv-SE")} + top-up {Math.round(topUp).toLocaleString("sv-SE")}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                          {(() => {
                            const pr = result.parentsResult.find(p => p.parentId === s.parentId);
                            if (!pr) return null;
                            return (
                              <Collapsible>
                                <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                                  Budget
                                  <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200" />
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pt-1 space-y-0.5 text-xs text-muted-foreground">
                                  <p>Uttagna: {Math.round(pr.taken.sickness + pr.taken.lowest)} d</p>
                                  <p>Kvar överförbara: {Math.round(pr.remaining.sicknessTransferable)}</p>
                                  <p>Kvar reserverade: {Math.round(pr.remaining.sicknessReserved)}</p>
                                  <p>Kvar lägstanivå: {Math.round(pr.remaining.lowest)}</p>
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })()}
                        </div>
                      );
                    })}
                    <div className="px-4 py-2 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {hasAnyAboveTak
                          ? `FK betalar 77,6% av din lön upp till taket (${Math.round(FK.sgiTakArslon / 12).toLocaleString("sv-SE")} kr/mån).`
                          : "FK betalar 77,6% av din lön."}
                      </p>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="topup-toggle"
                          checked={showTopUp}
                          onCheckedChange={(checked) => {
                            setShowTopUp(!!checked);
                            if (!checked) {
                              const updated = parents.map(p => ({ ...p, topUpMonthly: 0 }));
                              setParents(updated);
                              const transfers = transferToArray(transfer);
                              savePlanInput({ parents: updated, blocks, transfers, constants: CONSTANTS, savedDaysCount });
                            }
                          }}
                        />
                        <label htmlFor="topup-toggle" className="text-xs text-muted-foreground cursor-pointer">
                          Har top-up från arbetsgivare
                        </label>
                      </div>
                      {showTopUp && (
                        <div className="space-y-1.5 pt-1">
                          {result.parentSummary.map(s => (
                            <div key={s.parentId} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-16 shrink-0">{s.name}</span>
                              <Input
                                type="number"
                                min={0}
                                placeholder="0"
                                className="h-7 w-28 text-xs tabular-nums"
                                value={parents.find(p => p.id === s.parentId)?.topUpMonthly || ""}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                                  const updated = parents.map(p => p.id === s.parentId ? { ...p, topUpMonthly: val } : p);
                                  setParents(updated);
                                  const transfers = transferToArray(transfer);
                                  savePlanInput({ parents: updated, blocks, transfers, constants: CONSTANTS, savedDaysCount });
                                }}
                              />
                              <span className="text-[10px] text-muted-foreground">kr/mån</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })()}
            </div>
          </>
        );
      })()}

      {viewMode === "result" && !result && (
        <div className="border border-border rounded-lg p-4 bg-card text-center">
          <p className="text-muted-foreground">Laddar simulering…</p>
        </div>
      )}
      {/* FK Registration Section */}
      {result && result.parentsResult.length > 0 && (
        <section className="rounded-xl border border-dashed border-border bg-card p-6 text-center space-y-3">
          <div className="space-y-1">
            <div className="flex justify-center mb-2">
              <ClipboardList className="w-6 h-6 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Redo att registrera hos Försäkringskassan?</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Logga in på Mina sidor → Föräldrapenning → Anmäl ledighet. Vi har förberett alla perioder åt dig.
            </p>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setFkGuideOpen(true)}
          >
            <ClipboardList className="w-4 h-4" />
            Visa steg-för-steg guide
          </Button>
        </section>
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
        onSplit={handleSplitBlock}
        onMerge={handleMergeBlock}
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
          const transfers = transferToArray(transfer);
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
          const transfers = transferToArray(newTransfer);
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
          const transfers = transferToArray(transfer);
          savePlanInput({ parents, blocks: merged, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
      <DoubleDaysDrawer
        open={doubleDaysOpen}
        onOpenChange={setDoubleDaysOpen}
        parents={parents}
        maxDoubleDays={dueDate >= "2024-07-01" ? 60 : 30}
        onApply={(newBlocks, compensationMode: CompensationMode) => {
          pushHistory();
          const transfers = getTransfers(transfer);

          if (compensationMode === "reduce-dpw") {
            // Calculate current saved days before adding DD
            const simBefore = simulatePlan({ parents, blocks, transfers, constants: CONSTANTS });
            const savedBefore = calcRemaining(simBefore.parentsResult).currentTotal;

            // Add DD blocks
            const withDD = canonicalizeBlocks([...blocks, ...newBlocks]);
            assertUniqueBlockIds(withDD, "DoubleDaysDrawer-apply");

            // Reduce DPW to restore saved days to pre-DD level
            const simAfterDD = simulatePlan({ parents, blocks: withDD, transfers, constants: CONSTANTS });
            const remainingAfterDD = calcRemaining(simAfterDD.parentsResult).currentTotal;
            const unfulfilledAfterDD = simAfterDD.unfulfilledDaysTotal ?? 0;
            // Account for unfulfilled days as negative remaining so the adjustment
            // engine knows it must free up budget to cover them
            const effectiveOriginal = remainingAfterDD - unfulfilledAfterDD;

            const adjusted = adjustToTarget({
              blocks: withDD,
              parents,
              constants: CONSTANTS,
              transfer,
              source: "both",
              targetTotal: savedBefore,
              originalTotal: effectiveOriginal,
            });

            const finalBlocks = adjusted ? adjusted.blocks : withDD;
            setBlocks(finalBlocks);
            savePlanInput({ parents, blocks: finalBlocks, transfers, constants: CONSTANTS, savedDaysCount });
          } else {
            const updated = canonicalizeBlocks([...blocks, ...newBlocks]);
            assertUniqueBlockIds(updated, "DoubleDaysDrawer-apply");
            setBlocks(updated);
            savePlanInput({ parents, blocks: updated, transfers, constants: CONSTANTS, savedDaysCount });
          }
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
          const transfers = transferToArray(newTransfer);
          const valid = blocks.filter(b => !blockErrors.get(b.id)).sort((a, b) => a.startDate.localeCompare(b.startDate));
          savePlanInput({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
      <FKGuideDrawer
        open={fkGuideOpen}
        onOpenChange={setFkGuideOpen}
        blocks={blocks.filter(b => !blockErrors.get(b.id)).sort((a, b) => a.startDate.localeCompare(b.startDate))}
        parents={parents}
      />
    </div>
  );
};

export default PlanBuilder;
