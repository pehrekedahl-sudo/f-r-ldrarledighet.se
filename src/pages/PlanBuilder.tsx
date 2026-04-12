import { useState, useMemo, useCallback, useEffect } from "react";
import AuthModal from "@/components/AuthModal";
import { useUser } from "@/hooks/useUser";
import { useHasPurchased } from "@/hooks/useHasPurchased";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams, useNavigate } from "react-router-dom";
import { addMonths, addDays as addDaysUtil, compareDates, isoWeekdayIndex, diffDaysInclusive, toLocalDate, todayISO } from "@/utils/dateOnly";
import { ChevronDown, CalendarPlus, Users, CalendarSync, PiggyBank, ArrowLeftRight, UserPlus, ClipboardList, Info, Share2, Copy, Mail, Check, Wallet, AlertTriangle, HelpCircle, Lock, ArrowDown } from "lucide-react";
import PlanTutorial, { usePlanTutorial } from "@/components/PlanTutorial";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { simulatePlan } from "@/lib/simulatePlan";
import { FK, FK_CONSTANTS, computeBlockMonthlyBenefit } from "@/lib/fkConstants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { loadPlanInput } from "@/lib/persistence";
import { useSavedPlan } from "@/hooks/useSavedPlan";
import { assertUniqueBlockIds } from "@/lib/blockIdUtils";
import { normalizeBlocks, applySmartChange } from "@/lib/adjustmentPolicy";
import { resolveDeletedDoubleDays } from "@/lib/resolveDeletedDoubleDays";
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
  SGI_CAP_ANNUAL: 588000,
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
  const { user, loading: userLoading } = useUser();
  const { hasPurchased, loading: purchaseLoading } = useHasPurchased(user, userLoading);
  const { savePlan, loadPlan, loadingPlan, dbPlan } = useSavedPlan(user, userLoading);
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
  const [authOpen, setAuthOpen] = useState(false);
  const [transferDaysOpen, setTransferDaysOpen] = useState(false);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [fkGuideOpen, setFkGuideOpen] = useState(false);
  const [topUpEnabled, setTopUpEnabled] = useState<Record<string, boolean>>({});
  const [topUpMode, setTopUpMode] = useState<Record<string, "amount" | "percent">>({ p1: "amount", p2: "amount" });
  const [topUpPercent, setTopUpPercent] = useState<Record<string, number>>({ p1: 10, p2: 10 });
  const [childName, setChildName] = useState("");
  const [topUpMonths, setTopUpMonths] = useState<Record<string, number>>({ p1: 3, p2: 3 });
  const { showTutorial, setShowTutorial } = usePlanTutorial();
  const [pendingCtaAction, setPendingCtaAction] = useState<string | null>(
    () => localStorage.getItem("pendingCtaAction")
  );

  const startCheckout = useCallback(async () => {
    // Persist plan before navigating away so it survives the redirect
    const transfers = transferToArray(transfer);
    savePlan({ parents, blocks, transfers, constants: CONSTANTS });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ returnUrl: `${window.location.origin}/plan-builder?success=true` }),
        }
      );
      const data = await res.json();
      if (data.url) {
        if (window.top === window.self) {
          window.location.href = data.url;
          return;
        }

        try {
          if (window.top) {
            window.top.location.href = data.url;
            return;
          }
        } catch {
          // Fallback below when top-level navigation is blocked.
        }

        const opened = window.open(data.url, "_blank", "noopener,noreferrer");
        if (!opened) {
          window.location.href = data.url;
        }
      } else {
        toast({ title: "Fel", description: "Kunde inte starta betalningen.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Fel", description: "Något gick fel. Försök igen.", variant: "destructive" });
    }
  }, [toast, parents, blocks, transfer]);

  const handleCtaClick = useCallback(async (action: string) => {
    if (!user || !hasPurchased) {
      // Sign out unpaid users so they go through the full auth → checkout flow
      if (user && !hasPurchased) {
        await supabase.auth.signOut();
      }
      localStorage.setItem("pendingCtaAction", action);
      setPendingCtaAction(action);
      setAuthOpen(true);
      return;
    }
    // User is logged in and has paid — perform the action
    if (action === "save") {
      toast({ title: "Sparad!", description: "Din plan har sparats." });
    } else if (action === "share") {
      setShareDialogOpen(true);
    } else if (action === "fk") {
      setFkGuideOpen(true);
    }
  }, [user, hasPurchased, toast]);

  // After auth completes, check if there's a pending action
  useEffect(() => {
    if (purchaseLoading) return; // wait until purchase status is known
    if (user && pendingCtaAction && authOpen === false) {
      localStorage.removeItem("pendingCtaAction");
      if (!hasPurchased) {
        startCheckout();
      } else {
        handleCtaClick(pendingCtaAction);
      }
      setPendingCtaAction(null);
    }
  }, [user, authOpen, pendingCtaAction, hasPurchased, purchaseLoading, startCheckout, handleCtaClick]);

  const [overlapDialog, setOverlapDialog] = useState<{
    open: boolean;
    targetBlock: Block | null;
    otherBlock: Block | null;
    newStart: string;
    newEnd: string;
    overlapDays: number;
    overlapStart: string;
    overlapEnd: string;
    preResizeBlocks: Block[];
    source: "resize" | "drawer";
    pendingDrawerBlock?: Block;
  }>({
    open: false, targetBlock: null, otherBlock: null,
    newStart: "", newEnd: "", overlapDays: 0,
    overlapStart: "", overlapEnd: "", preResizeBlocks: [],
    source: "resize",
  });

  const loadFromAnySource = useCallback(() => {
    // Try DB first (via hook), then localStorage
    const saved = (loadPlan() ?? loadPlanInput()) as any;
    if (saved && saved.parents && saved.blocks && saved.blocks.length > 0) {
      setParents(saved.parents);
      if (saved.childName) setChildName(saved.childName);
      if (saved.parents.some((p: any) => (p.topUpMonthly ?? 0) > 0)) {
        const enabled: Record<string, boolean> = {};
        saved.parents.forEach((p: any) => { if ((p.topUpMonthly ?? 0) > 0) enabled[p.id] = true; });
        setTopUpEnabled(enabled);
      }
      setBlocks(saved.blocks);
      setOriginalBlocks(saved.blocks);
      if (saved.transfers?.length > 0) {
        setTransfer(saved.transfers[0]);
      } else {
        setTransfer(null);
      }
      setViewMode("result");
      setLoaded(true);
      setNoSavedPlan(false);
      return true;
    }
    return false;
  }, [loadPlan]);

  // Handle Stripe success redirect
  useEffect(() => {
    if (searchParams.get("success") === "true") {
      toast({ title: "Betalning genomförd!", description: "Tack! Du har nu full tillgång." });
      searchParams.delete("success");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, toast]);

  // Load plan from URL param, DB, or localStorage
  useEffect(() => {
    // Wait for DB plan to finish loading before deciding
    if (loadingPlan) return;

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
          if (decoded.parents.some((p: any) => (p.topUpMonthly ?? 0) > 0)) {
            const enabled: Record<string, boolean> = {};
            decoded.parents.forEach((p: any) => { if ((p.topUpMonthly ?? 0) > 0) enabled[p.id] = true; });
            setTopUpEnabled(enabled);
          }
        }
        setIsSharedPlan(true);
        setViewMode("result");
        setLoaded(true);
        return;
      } catch { /* ignore */ }
    }

    // If URL has auth hash fragments (email verification redirect), wait for auth
    // before deciding to redirect — the plan is still in localStorage
    const hash = window.location.hash;
    if (hash && (hash.includes("access_token") || hash.includes("type=signup") || hash.includes("type=recovery"))) {
      loadFromAnySource();
      return;
    }

    if (!loadFromAnySource()) {
      navigate("/wizard", { replace: true });
    }
  }, [loadingPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadSaved = () => {
    if (!loadFromAnySource()) {
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
    setTransfer(prev.transfer);
    setHistory(h => h.slice(0, -1));
    setCanUndo(history.length > 1);
    const transfers = transferToArray(prev.transfer);
    savePlan({ parents, blocks: prev.blocks, transfers, constants: CONSTANTS });
  };

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const sharePlan = useCallback(() => {
    const payload = { blocks, transfer, dueDate, months1, months2, parents };
    const encoded = btoa(JSON.stringify(payload));
    setSearchParams({ plan: encoded }, { replace: true });
    const url = `${window.location.origin}${window.location.pathname}?plan=${encoded}`;
    setShareUrl(url);
    setCopied(false);
    setShareDialogOpen(true);
  }, [blocks, transfer, dueDate, months1, months2, parents, setSearchParams]);

  const copyShareUrl = useCallback(() => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast({ description: "Länk kopierad!" });
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl, toast]);

  const emailShareUrl = useCallback(() => {
    const subject = encodeURIComponent("Min föräldraledighetsplan");
    const body = encodeURIComponent(`Kolla in vår plan:\n${shareUrl}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
  }, [shareUrl]);

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

  const applyDrawerSave = (updated: Block) => {
    if (drawerMode === "create") {
      const newBlocks = normalizeBlocks([...blocks, updated]);
      assertUniqueBlockIds(newBlocks, "drawerSave-create");
      setBlocks(newBlocks);
      const valid = newBlocks.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
      const transfers = transferToArray(transfer);
      savePlan({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
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
      savePlan({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
    }
  };

  const handleDrawerSave = (updated: Block) => {
    setHasManualEdits(true);

    // Skip cross-parent overlap check for DD blocks
    if (updated.isOverlap) {
      applyDrawerSave(updated);
      return;
    }

    // Detect cross-parent overlap
    const otherParentBlocks = blocks.filter(
      b => b.parentId !== updated.parentId && !b.isOverlap && b.id !== updated.id
    );
    const overlapping = otherParentBlocks.find(
      b => compareDates(b.startDate, updated.endDate) <= 0 && compareDates(b.endDate, updated.startDate) >= 0
    );

    if (overlapping) {
      const oStart = compareDates(updated.startDate, overlapping.startDate) > 0 ? updated.startDate : overlapping.startDate;
      const oEnd = compareDates(updated.endDate, overlapping.endDate) < 0 ? updated.endDate : overlapping.endDate;
      let overlapDays = 0;
      for (let d = oStart; compareDates(d, oEnd) <= 0; d = addDaysUtil(d, 1)) {
        if (isoWeekdayIndex(d) < 5) overlapDays++;
      }

      setOverlapDialog({
        open: true,
        targetBlock: updated,
        otherBlock: overlapping,
        newStart: updated.startDate,
        newEnd: updated.endDate,
        overlapDays,
        overlapStart: oStart,
        overlapEnd: oEnd,
        preResizeBlocks: blocks.map(b => ({ ...b })),
        source: "drawer",
        pendingDrawerBlock: updated,
      });
      return;
    }

    applyDrawerSave(updated);
  };

  const handleDrawerDelete = (id: string) => {
    setHasManualEdits(true);
    removeBlock(id);
    const remaining = blocks.filter(b => b.id !== id);
    const valid = remaining.filter(b => !validateBlock(b)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const transfers = transferToArray(transfer);
    savePlan({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
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
    savePlan({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
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
    savePlan({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
    toast({ description: "Blocken har slagits ihop." });
  };

  const applyResizeWithoutOverlapCheck = useCallback((blockId: string, newStart: string, newEnd: string) => {
    const target = blocks.find(b => b.id === blockId);
    if (!target || target.isOverlap) return;
    if (compareDates(newEnd, newStart) < 0) return;

    const ddBlocks = blocks
      .filter(b => b.isOverlap && b.parentId === target.parentId)
      .filter(b => compareDates(b.startDate, newEnd) <= 0 && compareDates(b.endDate, newStart) >= 0)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

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

    const otherBlocks = blocks.filter(b => b.id !== blockId);
    const truncatedOther = otherBlocks.flatMap(b => {
      if (b.parentId !== target.parentId || b.isOverlap) return [b];
      if (compareDates(b.endDate, newStart) < 0 || compareDates(b.startDate, newEnd) > 0) return [b];
      if (compareDates(b.startDate, newStart) >= 0 && compareDates(b.endDate, newEnd) <= 0) return [];
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
    savePlan({ parents, blocks: valid, transfers, constants: CONSTANTS });
  }, [blocks, parents, transfer]);

  const handleBlockResize = (blockId: string, newStart: string, newEnd: string) => {
    setHasManualEdits(true);
    pushHistory();
    const target = blocks.find(b => b.id === blockId);
    if (!target || target.isOverlap) return;
    if (compareDates(newEnd, newStart) < 0) return;

    // Detect cross-parent overlap (non-DD blocks from other parent)
    const otherParentBlocks = blocks.filter(
      b => b.parentId !== target.parentId && !b.isOverlap && b.id !== blockId
    );
    const overlapping = otherParentBlocks.find(
      b => compareDates(b.startDate, newEnd) <= 0 && compareDates(b.endDate, newStart) >= 0
    );

    if (overlapping) {
      // Calculate overlap range
      const oStart = compareDates(newStart, overlapping.startDate) > 0 ? newStart : overlapping.startDate;
      const oEnd = compareDates(newEnd, overlapping.endDate) < 0 ? newEnd : overlapping.endDate;
      let overlapDays = 0;
      for (let d = oStart; compareDates(d, oEnd) <= 0; d = addDaysUtil(d, 1)) {
        if (isoWeekdayIndex(d) < 5) overlapDays++;
      }

      setOverlapDialog({
        open: true,
        targetBlock: target,
        otherBlock: overlapping,
        newStart,
        newEnd,
        overlapDays,
        overlapStart: oStart,
        overlapEnd: oEnd,
        preResizeBlocks: blocks.map(b => ({ ...b })),
        source: "resize",
      });
      return;
    }

    applyResizeWithoutOverlapCheck(blockId, newStart, newEnd);
  };

  // Count existing DD weekdays
  const existingDDDays = useMemo(() => {
    let count = 0;
    // Count unique DD days (only one parent side to avoid double-counting)
    const ddBlocks = blocks.filter(b => b.isOverlap);
    const seen = new Set<string>();
    for (const dd of ddBlocks) {
      const key = `${dd.overlapGroupId}-${dd.startDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (let d = dd.startDate; compareDates(d, dd.endDate) <= 0; d = addDaysUtil(d, 1)) {
        if (isoWeekdayIndex(d) < 5) count++;
      }
    }
    return count;
  }, [blocks]);

  const ddCapExceeded = useMemo(() => {
    return existingDDDays >= 60;
  }, [existingDDDays]);

  const ddWillBeCapped = useMemo(() => {
    const proposed = overlapDialog.overlapDays || 0;
    return !ddCapExceeded && (existingDDDays + proposed) > 60;
  }, [existingDDDays, overlapDialog.overlapDays, ddCapExceeded]);

  /**
   * Apply the pending block change (drawer or resize) to a blocks array inline,
   * WITHOUT calling setBlocks or normalizeBlocks. Returns the modified array.
   */
  const applyPendingChangeInline = (base: Block[], dialog: typeof overlapDialog): Block[] => {
    if (dialog.source === "resize" && dialog.targetBlock) {
      // Replicate applyResizeWithoutOverlapCheck logic inline
      const target = base.find(b => b.id === dialog.targetBlock!.id);
      if (!target || target.isOverlap) return base;
      const { newStart, newEnd } = dialog;
      if (compareDates(newEnd, newStart) < 0) return base;

      const ddBlocks = base
        .filter(b => b.isOverlap && b.parentId === target.parentId)
        .filter(b => compareDates(b.startDate, newEnd) <= 0 && compareDates(b.endDate, newStart) >= 0)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      let segments: { start: string; end: string }[] = [{ start: newStart, end: newEnd }];
      for (const dd of ddBlocks) {
        const newSegs: { start: string; end: string }[] = [];
        for (const seg of segments) {
          if (compareDates(dd.endDate, seg.start) < 0 || compareDates(dd.startDate, seg.end) > 0) {
            newSegs.push(seg); continue;
          }
          if (compareDates(seg.start, dd.startDate) < 0)
            newSegs.push({ start: seg.start, end: addDaysUtil(dd.startDate, -1) });
          if (compareDates(seg.end, dd.endDate) > 0)
            newSegs.push({ start: addDaysUtil(dd.endDate, 1), end: seg.end });
        }
        segments = newSegs;
      }

      const newBlockSegments: Block[] = segments
        .filter(seg => compareDates(seg.end, seg.start) >= 0)
        .map((seg, i) => ({
          ...target, id: i === 0 ? target.id : `${target.id}-resize-${i}`,
          startDate: seg.start, endDate: seg.end, source: "user" as const,
        }));
      if (newBlockSegments.length === 0) return base;

      const otherBlocks = base.filter(b => b.id !== target.id);
      const truncatedOther = otherBlocks.flatMap(b => {
        if (b.parentId !== target.parentId || b.isOverlap) return [b];
        if (compareDates(b.endDate, newStart) < 0 || compareDates(b.startDate, newEnd) > 0) return [b];
        if (compareDates(b.startDate, newStart) >= 0 && compareDates(b.endDate, newEnd) <= 0) return [];
        const result: Block[] = [];
        if (compareDates(b.startDate, newStart) < 0)
          result.push({ ...b, id: b.id, endDate: addDaysUtil(newStart, -1) });
        if (compareDates(b.endDate, newEnd) > 0)
          result.push({ ...b, id: result.length > 0 ? `${b.id}-trunc` : b.id, startDate: addDaysUtil(newEnd, 1) });
        return result.filter(r => compareDates(r.endDate, r.startDate) >= 0);
      });

      return [...truncatedOther, ...newBlockSegments];
    } else if (dialog.pendingDrawerBlock) {
      const updated = dialog.pendingDrawerBlock;
      if (drawerMode === "create") {
        return [...base, updated];
      } else {
        let replaced = base.map(b => b.id === updated.id ? updated : b);
        if (updated.isOverlap) {
          replaced = replaced.map(b => {
            if (b.id !== updated.id && b.isOverlap && b.parentId !== updated.parentId &&
                b.startDate === updated.startDate && b.endDate === updated.endDate) {
              return { ...b, daysPerWeek: updated.daysPerWeek };
            }
            return b;
          });
        }
        return replaced;
      }
    }
    return base;
  };

  const handleOverlapCreateDD = () => {
    if (!overlapDialog.targetBlock || !overlapDialog.otherBlock) return;
    const { targetBlock, overlapStart } = overlapDialog;

    // Hard guard: re-compute remaining DD allowance inline
    const remainingDD = 60 - existingDDDays;
    if (remainingDD <= 0) {
      toast({ title: "Max antal dubbeldagar nått", description: "Ni har redan 60 dubbeldagar." });
      setOverlapDialog(prev => ({ ...prev, open: false }));
      return;
    }

    // Auto-cap: if overlap exceeds remaining DD, truncate endDate
    let cappedEnd = overlapDialog.overlapEnd;
    const proposedDays = overlapDialog.overlapDays;
    if (proposedDays > remainingDD) {
      // Advance from overlapStart by remainingDD weekdays to find capped end
      let weekdayCt = 0;
      let d = overlapStart;
      while (true) {
        if (isoWeekdayIndex(d) < 5) weekdayCt++;
        if (weekdayCt >= remainingDD) break;
        d = addDaysUtil(d, 1);
      }
      cappedEnd = d;
    }
    const actualDays = Math.min(proposedDays, remainingDD);

    // Step 1: apply pending change inline
    let working = applyPendingChangeInline(blocks, overlapDialog);

    // Step 2: create DD blocks with capped end
    const groupId = `overlap-${Date.now()}`;
    const dd1: Block = {
      id: `dd-${Date.now()}-p1`,
      parentId: targetBlock.parentId,
      startDate: overlapStart,
      endDate: cappedEnd,
      daysPerWeek: targetBlock.daysPerWeek,
      overlapGroupId: groupId,
      isOverlap: true,
    };
    const dd2: Block = {
      id: `dd-${Date.now()}-p2`,
      parentId: overlapDialog.otherBlock!.parentId,
      startDate: overlapStart,
      endDate: cappedEnd,
      daysPerWeek: overlapDialog.otherBlock!.daysPerWeek,
      overlapGroupId: groupId,
      isOverlap: true,
    };
    working = [...working, dd1, dd2];

    // Step 3: normalize once, set once
    const final = normalizeBlocks(working);
    assertUniqueBlockIds(final, "overlapCreateDD");
    setBlocks(final);
    const transfers = transferToArray(transfer);
    savePlan({ parents, blocks: final, transfers, constants: CONSTANTS, savedDaysCount });

    setOverlapDialog(prev => ({ ...prev, open: false }));
    const cappedNote = proposedDays > remainingDD ? ` (begränsat från ${proposedDays})` : "";
    toast({ description: `Dubbeldagar skapade för ${actualDays} dagar${cappedNote}` });
  };

  const handleOverlapTruncate = () => {
    if (!overlapDialog.targetBlock || !overlapDialog.otherBlock) return;
    const { otherBlock, newStart, newEnd } = overlapDialog;

    // Step 1: apply pending change inline
    let working = applyPendingChangeInline(blocks, overlapDialog);

    // Step 2: truncate the other parent's block
    working = working.map(b => {
      if (b.id === otherBlock.id) {
        if (compareDates(newStart, b.startDate) <= 0) {
          return { ...b, startDate: addDaysUtil(newEnd, 1) };
        }
        return { ...b, endDate: addDaysUtil(newStart, -1) };
      }
      return b;
    }).filter(b => compareDates(b.endDate, b.startDate) >= 0);

    // Step 3: normalize once, set once
    const final = normalizeBlocks(working);
    assertUniqueBlockIds(final, "overlapTruncate");
    setBlocks(final);
    const transfers = transferToArray(transfer);
    savePlan({ parents, blocks: final, transfers, constants: CONSTANTS, savedDaysCount });

    setOverlapDialog(prev => ({ ...prev, open: false }));
    const otherName = parents.find(p => p.id === otherBlock.parentId)?.name ?? "?";
    toast({ description: `${otherName}s block justerat` });
  };

  const handleOverlapCancel = () => {
    if (overlapDialog.source === "resize") {
      setBlocks(overlapDialog.preResizeBlocks);
    }
    // For drawer source, nothing was applied yet, so just close
    setOverlapDialog(prev => ({ ...prev, open: false }));
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
                      <Input type="text" inputMode="numeric" pattern="[0-9]*" value={block.daysPerWeek === 0 ? "" : block.daysPerWeek} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); updateBlock(block.id, { daysPerWeek: v === "" ? 0 : Math.min(7, Number(v)) }); }} />
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
                      <Input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="—" value={block.lowestDaysPerWeek ?? ""} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); updateBlock(block.id, { lowestDaysPerWeek: v === "" ? undefined : Math.min(7, Number(v)) }); }} />
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
    <div className="max-w-4xl mx-auto px-3 py-4 space-y-5 sm:px-6 sm:py-8 sm:space-y-8">
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
                  <Input type="text" inputMode="numeric" pattern="[0-9]*" value={months1 === 0 ? "" : months1} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setMonths1(v === "" ? 0 : Number(v)); }} />
                </div>
                <div className="space-y-1">
                  <Label>Månader {parents[1].name}</Label>
                  <Input type="text" inputMode="numeric" pattern="[0-9]*" value={months2 === 0 ? "" : months2} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setMonths2(v === "" ? 0 : Number(v)); }} />
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
                // savedDaysCount is derived — no reset needed
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
        const planTitle = childName
          ? `Plan för föräldraledighet med ${childName}`
          : parents.length >= 2
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
            <section id="plan-hero" className="rounded-xl border-2 border-border bg-gradient-to-r from-[#edf7f5]/80 to-[#fdf0ec]/80 shadow-sm px-4 py-4 sm:px-6 sm:py-5 mt-4 space-y-3">
              {/* Row 1: Title + help */}
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-base font-semibold text-foreground truncate min-w-0">{planTitle}</h1>
                <Button variant="ghost" size="sm" className="text-xs h-7 w-7 p-0 text-muted-foreground flex-shrink-0" onClick={() => setShowTutorial(true)} title="Visa guide"><HelpCircle className="h-3.5 w-3.5" /></Button>
              </div>

              {/* Row 2: Parent pills (left) + KPIs (right) */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex gap-2 flex-wrap">
                  {result.parentsResult.map((pr) => {
                    const reservedLeft = Math.round(pr.remaining.sicknessReserved);
                    const transferableLeft = Math.round(pr.remaining.sicknessTransferable);
                    const lowestLeft = Math.round(pr.remaining.lowest);
                    const daysLeft = reservedLeft + transferableLeft + lowestLeft;
                    const totalBudget = 480;
                    const used = Math.round(pr.taken.sickness + pr.taken.lowest);
                    const pct = totalBudget > 0 ? Math.min(100, Math.round((used / totalBudget) * 100)) : 0;
                    const isP1 = pr.parentId === "p1";
                    const detailParts: string[] = [];
                    if (reservedLeft > 0) detailParts.push(`${reservedLeft} reserv`);
                    if (transferableLeft > 0) detailParts.push(`${transferableLeft} sjukpenning`);
                    if (lowestLeft > 0) detailParts.push(`${lowestLeft} lägsta`);
                    return (
                      <div key={pr.parentId} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${isP1 ? "border-[#4A9B8E]/30 bg-white/80" : "border-[#E8735A]/30 bg-white/80"}`}>
                        <span className={`inline-block w-2 h-2 rounded-full ${isP1 ? "bg-[#4A9B8E]" : "bg-[#E8735A]"}`} />
                        <span className="font-medium">{pr.name}</span>
                        <span className="text-muted-foreground text-sm">{daysLeft} kvar</span>
                        {detailParts.length > 0 && (
                          <span className="text-muted-foreground text-xs hidden sm:inline">({detailParts.join(" · ")})</span>
                        )}
                        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ease-out ${isP1 ? "bg-[#4A9B8E]" : "bg-[#E8735A]"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-6 flex-shrink-0">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Räcker till</p>
                    <p className="text-2xl font-bold text-foreground leading-tight">{formattedEnd}</p>
                  </div>
                  <div className="w-px bg-border/60 self-stretch" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Snitt/mån</p>
                    <p className="text-2xl font-bold text-foreground leading-tight">~{Math.round(computedAvg).toLocaleString()} kr</p>
                  </div>
                </div>
              </div>

              {/* Row 3: Warning/status (left) + scroll link (right) */}
              <div className="flex items-center justify-between gap-2">
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
                    <Button size="sm" className="h-7 text-xs" onClick={() => setFitPlanOpen(true)}>Auto-justera</Button>
                  </div>
                ) : (
                  <span className="text-sm text-[#4A9B8E] font-medium">✓ Balanserad</span>
                )}
                {hasPurchased ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setFkGuideOpen(true)}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    FK-guide
                  </Button>
                ) : (
                  <a
                    href="#cta-block"
                    onClick={(e) => { e.preventDefault(); document.getElementById("cta-block")?.scrollIntoView({ behavior: "smooth" }); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 flex-shrink-0"
                  >
                    Spara eller exportera ↓
                  </a>
                )}
              </div>
            </section>

            {/* ── TIMELINE ── */}
            <section id="plan-timeline" className="space-y-3">
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
                    const resolved = resolveDeletedDoubleDays(blocks, blockId);
                    setBlocks(resolved);
                    const transfers = transferToArray(transfer);
                    savePlan({ parents, blocks: resolved, transfers, constants: CONSTANTS, savedDaysCount });
                  }
                }}
              />
              {/* SGI warnings per block */}
              {dueDate && (() => {
                const childFirstBirthday = addMonths(dueDate, 12);
                const sgiWarningBlocks = validBlocks.filter(b =>
                  b.daysPerWeek < 5 &&
                  !b.isOverlap &&
                  compareDates(b.endDate, childFirstBirthday) >= 0
                );
                if (sgiWarningBlocks.length === 0) return null;
                return (
                  <div className="flex flex-col gap-2 mt-2">
                    {sgiWarningBlocks.map(b => {
                      const parent = parents.find(p => p.id === b.parentId);
                      const parentName = parent?.name ?? "Förälder";
                      return (
                        <div key={`sgi-warn-${b.id}`} className="border border-amber-300 rounded-lg p-3 bg-amber-50 text-amber-900 text-sm flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <p>
                            <strong>{parentName}</strong>: Du tar ut färre än 5 dagar/vecka ({b.daysPerWeek} d/v) efter barnets 1-årsdag. Det kan påverka din SGI negativt om du inte arbetar de resterande dagarna.{" "}
                            <Link to="/foraldraledighet-101?section=tradeoffs" className="underline font-medium ml-1">Läs mer →</Link>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
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
              <div id="adjust-panel" className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                  <CalendarSync className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Justera planen</h3>
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
                        <p className="text-xs text-muted-foreground">Reserv för oplanerad ledighet</p>
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
                const parentColors: Record<string, { bg: string; border: string; dot: string }> = {
                  p1: { bg: "bg-[hsl(172,37%,95%)]", border: "border-l-[hsl(172,37%,44%)]", dot: "bg-[hsl(172,37%,44%)]" },
                  p2: { bg: "bg-[hsl(14,75%,88%)]", border: "border-l-[hsl(14,75%,63%)]", dot: "bg-[hsl(14,75%,63%)]" },
                };
                return (
                  <section id="benefit-panel" className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">Ersättning per förälder</h3>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full ml-auto">före skatt</span>
                    </div>
                    <div className="divide-y divide-border">
                      {result.parentSummary.map(s => {
                        const parent = parents.find(p => p.id === s.parentId);
                        const monthlyIncome = parent?.monthlyIncomeFixed ?? 0;
                        const colors = parentColors[s.parentId] ?? parentColors.p1;
                        const isEnabled = topUpEnabled[s.parentId] ?? false;
                        const mode = topUpMode[s.parentId] ?? "amount";
                        const pctVal = topUpPercent[s.parentId] ?? 10;

                        const parentBlocks = blocks
                          .filter(b => b.parentId === s.parentId && !b.isOverlap)
                          .sort((a, b) => a.startDate.localeCompare(b.startDate));

                        const effectiveTopUp = isEnabled
                          ? (mode === "percent"
                            ? Math.round(monthlyIncome * (pctVal / 100))
                            : (parent?.topUpMonthly ?? 0))
                          : 0;

                        let totalWeightedBenefit = 0;
                        let totalDays = 0;
                        parentBlocks.forEach(b => {
                          const days = Math.max(1, diffDaysInclusive(b.startDate, b.endDate));
                          const monthlyFull = computeBlockMonthlyBenefit(monthlyIncome, 5);
                          const fkMonthly = monthlyFull * (b.daysPerWeek / 5);
                          const topUpScaled = effectiveTopUp * Math.min(1, b.daysPerWeek / 5);
                          totalWeightedBenefit += (fkMonthly + topUpScaled) * days;
                          totalDays += days;
                        });
                        const avgMonthly = totalDays > 0 ? Math.round(totalWeightedBenefit / totalDays) : 0;
                        const coveragePercent = monthlyIncome > 0 ? Math.min(100, Math.round((avgMonthly / monthlyIncome) * 100)) : 0;

                        const periodStart = parentBlocks.length > 0 ? parentBlocks[0].startDate : "";
                        const periodEnd = parentBlocks.length > 0 ? parentBlocks[parentBlocks.length - 1].endDate : "";
                        const totalPeriodMonths = periodStart && periodEnd
                          ? Math.max(1, Math.round(diffDaysInclusive(periodStart, periodEnd) / 30.44))
                          : 0;
                        const tuMonths = topUpMonths[s.parentId] ?? 3;
                        const topUpEndDate = periodStart ? addMonths(periodStart, tuMonths) : "";

                        return (
                          <div key={s.parentId} className={`border-l-4 ${colors.border}`}>
                            <div className={`px-4 py-1.5 ${colors.bg}`}>
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold text-foreground">{s.name}</p>
                                <p className="text-[11px] text-muted-foreground">{monthlyIncome.toLocaleString("sv-SE")} kr/mån</p>
                              </div>
                            </div>

                            <div className="px-4 py-2 space-y-1.5">
                              {/* Compact summary line */}
                              <p className="text-sm text-foreground">
                                <span className="font-semibold tabular-nums">{avgMonthly.toLocaleString("sv-SE")} kr/mån</span>
                                <span className="text-muted-foreground"> i snitt · Täcker {coveragePercent}%</span>
                                {monthlyIncome - avgMonthly > 0 && (
                                  <span className="text-destructive text-xs font-medium tabular-nums ml-2">
                                    –{(monthlyIncome - avgMonthly).toLocaleString("sv-SE")} kr
                                  </span>
                                )}
                              </p>

                              {/* Block breakdown – collapsible */}
                              {parentBlocks.length > 0 && (
                                <Collapsible>
                                  <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                                    Visa {parentBlocks.length} perioder
                                    <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200" />
                                  </CollapsibleTrigger>
                                  <CollapsibleContent className="pt-1.5 space-y-1">
                                    {parentBlocks.map((b, i) => {
                                      const monthlyFull = computeBlockMonthlyBenefit(monthlyIncome, 5);
                                      const fkMonthly = monthlyFull * (b.daysPerWeek / 5);
                                      const topUpScaled = effectiveTopUp * Math.min(1, b.daysPerWeek / 5);
                                      const totalMonthly = fkMonthly + topUpScaled;
                                      return (
                                        <div key={b.id} className="flex items-start gap-2 text-xs">
                                          <div className="flex flex-col items-center mt-1">
                                            <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                                            {i < parentBlocks.length - 1 && <div className="w-px h-4 bg-border" />}
                                          </div>
                                          <div className="flex-1 flex items-baseline justify-between">
                                            <span className="text-muted-foreground text-[11px]">
                                              {fmtPeriod(b.startDate, b.endDate)} · {b.daysPerWeek} d/v
                                            </span>
                                            <span className="font-medium text-foreground tabular-nums text-[11px]">
                                              {Math.round(totalMonthly).toLocaleString("sv-SE")} kr
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </CollapsibleContent>
                                </Collapsible>
                              )}

                              {/* Integrated top-up – collapsible */}
                              <Collapsible>
                                <div className="flex items-center gap-2">
                                  <Switch
                                    id={`topup-${s.parentId}`}
                                    checked={isEnabled}
                                    className="scale-75"
                                    onCheckedChange={(checked) => {
                                      setTopUpEnabled(prev => ({ ...prev, [s.parentId]: !!checked }));
                                      if (!checked) {
                                        const updated = parents.map(p => p.id === s.parentId ? { ...p, topUpMonthly: 0 } : p);
                                        setParents(updated);
                                        const transfers = transferToArray(transfer);
                                        savePlan({ parents: updated, blocks, transfers, constants: CONSTANTS, savedDaysCount });
                                      }
                                    }}
                                  />
                                  <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                                    Tillägg från arbetsgivare
                                    {isEnabled && effectiveTopUp > 0 && (
                                      <span className="text-foreground font-medium tabular-nums ml-1">
                                        {effectiveTopUp.toLocaleString("sv-SE")} kr/mån, {tuMonths} mån
                                      </span>
                                    )}
                                    <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200" />
                                  </CollapsibleTrigger>
                                </div>
                                <CollapsibleContent className="pt-1.5 pl-7">
                                  {isEnabled && (
                                    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
                                      <ToggleGroup
                                        type="single"
                                        value={mode}
                                        onValueChange={(val) => {
                                          if (val) {
                                            setTopUpMode(prev => ({ ...prev, [s.parentId]: val as "amount" | "percent" }));
                                            if (val === "percent") {
                                              const amt = Math.round(monthlyIncome * (pctVal / 100));
                                              const updated = parents.map(p => p.id === s.parentId ? { ...p, topUpMonthly: amt } : p);
                                              setParents(updated);
                                              const transfers = transferToArray(transfer);
                                              savePlan({ parents: updated, blocks, transfers, constants: CONSTANTS, savedDaysCount });
                                            }
                                          }
                                        }}
                                        className="justify-start"
                                      >
                                        <ToggleGroupItem value="amount" className="text-[11px] h-6 px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                                          kr/mån
                                        </ToggleGroupItem>
                                        <ToggleGroupItem value="percent" className="text-[11px] h-6 px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                                          % av lön
                                        </ToggleGroupItem>
                                      </ToggleGroup>

                                      <div className="flex items-center gap-2">
                                        {mode === "amount" ? (
                                          <>
                                            <Input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              placeholder="0"
                                              className="h-7 w-24 text-xs tabular-nums"
                                              value={parent?.topUpMonthly || ""}
                                              onChange={(e) => {
                                                const val = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value.replace(/\D/g, "")) || 0);
                                                const updated = parents.map(p => p.id === s.parentId ? { ...p, topUpMonthly: val } : p);
                                                setParents(updated);
                                                const transfers = transferToArray(transfer);
                                                savePlan({ parents: updated, blocks, transfers, constants: CONSTANTS, savedDaysCount });
                                              }}
                                            />
                                            <span className="text-[11px] text-muted-foreground">kr/mån</span>
                                          </>
                                        ) : (
                                          <>
                                            <Input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              placeholder="10"
                                              className="h-7 w-16 text-xs tabular-nums"
                                              value={pctVal || ""}
                                              onChange={(e) => {
                                                const v = e.target.value.replace(/\D/g, "");
                                                const val = v === "" ? 0 : Math.min(100, Number(v));
                                                setTopUpPercent(prev => ({ ...prev, [s.parentId]: val }));
                                                const amt = Math.round(monthlyIncome * (val / 100));
                                                const updated = parents.map(p => p.id === s.parentId ? { ...p, topUpMonthly: amt } : p);
                                                setParents(updated);
                                                const transfers = transferToArray(transfer);
                                                savePlan({ parents: updated, blocks, transfers, constants: CONSTANTS, savedDaysCount });
                                              }}
                                            />
                                            <span className="text-[11px] text-muted-foreground">%</span>
                                            <span className="text-[11px] text-foreground font-medium tabular-nums">
                                              = {Math.round(monthlyIncome * (pctVal / 100)).toLocaleString("sv-SE")} kr
                                            </span>
                                          </>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] text-muted-foreground">Gäller i</span>
                                        <Input
                                          type="text"
                                          inputMode="numeric"
                                          pattern="[0-9]*"
                                          className="h-6 w-12 text-[11px] tabular-nums"
                                          value={tuMonths === 0 ? "" : tuMonths}
                                          onChange={(e) => {
                                            const v = e.target.value.replace(/\D/g, "");
                                            const val = v === "" ? 0 : Math.min(18, Number(v));
                                            setTopUpMonths(prev => ({ ...prev, [s.parentId]: val }));
                                          }}
                                        />
                                        <span className="text-[11px] text-muted-foreground">mån</span>
                                        {totalPeriodMonths > 0 && (
                                          <span className={`text-[11px] ml-1 ${tuMonths >= totalPeriodMonths ? "text-primary" : "text-muted-foreground"}`}>
                                            {tuMonths >= totalPeriodMonths ? "✓ Hela perioden" : `${tuMonths}/${totalPeriodMonths} mån`}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </CollapsibleContent>
                              </Collapsible>

                              {/* Budget collapsible */}
                              {(() => {
                                const pr = result.parentsResult.find(p => p.parentId === s.parentId);
                                if (!pr) return null;
                                return (
                                  <Collapsible>
                                    <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                                      <PiggyBank className="h-3 w-3" />
                                      Budget & dagstatus
                                      <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200" />
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="pt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                                      <p>Uttagna: {Math.round(pr.taken.sickness + pr.taken.lowest)} dagar</p>
                                      <p>Kvar att överföra: {Math.round(pr.remaining.sicknessTransferable)} d</p>
                                      <p>Reserverade: 90 tot, {Math.round(pr.remaining.sicknessReserved)} kvar</p>
                                      <TooltipProvider>
                                        <p className="flex items-center gap-1">
                                          Lägstanivå kvar: {Math.round(pr.remaining.lowest)} d
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Info className="h-3 w-3 text-muted-foreground cursor-help inline-block" />
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-[220px] text-[11px]">
                                              Lägstanivådagarna (180 kr/dag) tas normalt ut sist.
                                            </TooltipContent>
                                          </Tooltip>
                                        </p>
                                      </TooltipProvider>
                                    </CollapsibleContent>
                                  </Collapsible>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <TooltipProvider>
                      <div className="px-4 py-1.5 border-t border-border bg-muted/20 flex items-center gap-1">
                        <p className="text-[10px] text-muted-foreground">FK betalar 77,6% av lönen</p>
                        {result.parentSummary.some(s => s.isAboveSgiTak) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-[11px]">
                              Upp till taket ({Math.round(FK.sgiTakArslon / 12).toLocaleString("sv-SE")} kr/mån).
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TooltipProvider>
                  </section>
                );
              })()}
            </div>

            {/* ── CTA BLOCK ── */}
            {hasPurchased ? (
              <section id="cta-block" className="rounded-xl border border-border bg-card shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">Din verktygslåda</h2>
                  <span className="text-xs font-medium text-[#4A9B8E] bg-[#4A9B8E]/10 rounded-full px-2.5 py-0.5">Konto aktivt</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    onClick={() => setFkGuideOpen(true)}
                    className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 hover:bg-accent transition-colors text-center"
                  >
                    <ClipboardList className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium text-foreground">Steg-för-steg-guide</span>
                    <span className="text-xs text-muted-foreground">Anmäl till Försäkringskassan</span>
                  </button>
                  <button
                    onClick={() => handleCtaClick("save")}
                    className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 hover:bg-accent transition-colors text-center"
                  >
                    <Wallet className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium text-foreground">Spara plan</span>
                    <span className="text-xs text-muted-foreground">Sparas till ditt konto</span>
                  </button>
                  <button
                    onClick={() => sharePlan()}
                    className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 hover:bg-accent transition-colors text-center"
                  >
                    <Share2 className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium text-foreground">Dela med partner</span>
                    <span className="text-xs text-muted-foreground">Skicka en länk</span>
                  </button>
                </div>
              </section>
            ) : (
              <section id="cta-block" className="rounded-xl border border-border bg-card shadow-sm p-6 text-center space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Redo att gå vidare?</h2>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <Button variant="outline" className="gap-2" onClick={() => handleCtaClick("save")}>
                    <Lock className="h-4 w-4" />
                    Spara plan
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => handleCtaClick("share")}>
                    <Lock className="h-4 w-4" />
                    Dela med partner
                  </Button>
                  <Button variant="default" className="gap-2" onClick={() => handleCtaClick("fk")}>
                    <Lock className="h-4 w-4" />
                    Hämta FK-guide
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Skapa ett konto för 99 kr – en engångsbetalning. Spara planen, dela den med din partner och få ett färdigt underlag för Försäkringskassan. Du kan alltid komma tillbaka, justera och följa planen under hela ledigheten. Ingen prenumeration, inga annonser.
                </p>
              </section>
            )}
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
          savePlan({ parents, blocks: merged, transfers, constants: CONSTANTS, savedDaysCount });
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
          savePlan({ parents, blocks: normalized, transfers, constants: CONSTANTS, savedDaysCount });
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
          savePlan({ parents, blocks: merged, transfers, constants: CONSTANTS, savedDaysCount });
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
            savePlan({ parents, blocks: finalBlocks, transfers, constants: CONSTANTS, savedDaysCount });
          } else {
            const updated = canonicalizeBlocks([...blocks, ...newBlocks]);
            assertUniqueBlockIds(updated, "DoubleDaysDrawer-apply");
            setBlocks(updated);
            savePlan({ parents, blocks: updated, transfers, constants: CONSTANTS, savedDaysCount });
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
          savePlan({ parents, blocks: valid, transfers, constants: CONSTANTS, savedDaysCount });
        }}
      />
      <FKGuideDrawer
        open={fkGuideOpen}
        onOpenChange={setFkGuideOpen}
        blocks={blocks.filter(b => !blockErrors.get(b.id)).sort((a, b) => a.startDate.localeCompare(b.startDate))}
        parents={parents}
      />

      {/* Overlap Dialog */}
      <AlertDialog open={overlapDialog.open} onOpenChange={(open) => { if (!open) handleOverlapCancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Överlapp – vad vill du göra?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const targetName = parents.find(p => p.id === overlapDialog.targetBlock?.parentId)?.name ?? "?";
                const otherName = parents.find(p => p.id === overlapDialog.otherBlock?.parentId)?.name ?? "?";
                return `${targetName}s och ${otherName}s ledighet överlappar ${overlapDialog.overlapDays} dagar. Båda föräldrar kan ta ut ersättning samtidigt – det kallas dubbeldagar.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {ddCapExceeded && (
            <p className="text-xs text-destructive font-medium">
              Dubbeldagar kan vara max 60 dagar totalt. Ni har redan använt alla 60.
            </p>
          )}
          {ddWillBeCapped && (
            <p className="text-xs text-amber-600 font-medium">
              Överlappet är {overlapDialog.overlapDays} dagar men max {60 - existingDDDays} dubbeldagar kvar — perioden kortas automatiskt.
            </p>
          )}
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              onClick={handleOverlapCreateDD}
              disabled={ddCapExceeded}
              className="bg-[#4A9B8E] hover:bg-[#3d8578] text-white"
            >
              {ddWillBeCapped
                ? `Skapa dubbeldagar (max ${60 - existingDDDays} dagar)`
                : "Skapa dubbeldagar för överlappet"}
            </Button>
            <Button variant="outline" onClick={handleOverlapTruncate}>
              Korta ner {parents.find(p => p.id === overlapDialog.otherBlock?.parentId)?.name ?? "andra förälderns"} block istället
            </Button>
            <AlertDialogCancel onClick={handleOverlapCancel}>Avbryt</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dela din plan</DialogTitle>
            <DialogDescription>Skicka länken till din partner eller spara den som bokmärke.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={shareUrl} className="text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
            <Button variant="outline" size="icon" className="shrink-0" onClick={copyShareUrl}>
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button className="flex-1 gap-2" onClick={() => { copyShareUrl(); setShareDialogOpen(false); }}>
              <Copy className="h-4 w-4" />Kopiera länk
            </Button>
            <Button variant="outline" className="flex-1 gap-2" onClick={emailShareUrl}>
              <Mail className="h-4 w-4" />Skicka via e-post
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <PlanTutorial open={showTutorial} onClose={() => setShowTutorial(false)} />
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
};

export default PlanBuilder;
