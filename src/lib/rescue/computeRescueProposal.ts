/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — DEDICATED MODULE                        │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. Rescue uses its own transfer-first algorithm:  │
 * │ max transfer first → then reduce dpw by 1 for N weeks           │
 * │ (late-first) only if shortage remains.                          │
 * │                                                                  │
 * │ Policy modules are for smart drawers only (Sparade dagar, etc). │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { simulatePlan } from "@/lib/simulatePlan";
import { mergeAdjacentBlocks } from "@/lib/mergeAdjacentBlocks";
import { generateBlockId } from "@/lib/blockIdUtils";

// ── Types ──

export type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
};

export type Parent = {
  id: string;
  name: string;
  monthlyIncomeFixed: number;
  monthlyIncomeVariableAvg?: number;
  has240Days: boolean;
};

export type Constants = {
  SGI_CAP_ANNUAL: number;
  LOWEST_LEVEL_DAILY_AMOUNT: number;
  BASIC_LEVEL_DAILY_AMOUNT: number;
  SICKNESS_RATE: number;
  REDUCTION: number;
  SICKNESS_DAILY_MAX?: number;
};

export type Transfer = { fromParentId: string; toParentId: string; sicknessDays: number };

export type DistributionMode = "proportional" | "split" | string;

export type Proposal = {
  newBlocks: Block[];
  proposedTransfer: Transfer | null;
  // ── Single source of truth numbers ──
  missingDaysTotal: number;
  transferDays: number;
  missingAfterTransferOnly: number;
  weeksTotal: number;
  perParentWeeks: Record<string, number>;
  // ── UI text ──
  actionsText: string[];
  detailText: string[];
  // ── Other ──
  deltaMonthly: number;
  success: boolean;
  transferOnly: boolean;
  debug: {
    shortageBefore: number;
    shortageAfter: number;
    maxTransfer: number;
    consistent: boolean;
    rawReductionWeeks: number;
    sumPerParentWeeks: number;
  };
  debugBefore: Block[];
  debugAfter: Block[];
};

// ── Helpers ──

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarDays(b: Block): number {
  return Math.ceil(
    (new Date(b.endDate + "T00:00:00Z").getTime() - new Date(b.startDate + "T00:00:00Z").getTime()) /
    (1000 * 60 * 60 * 24)
  ) + 1;
}

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

function calcParentLoad(blocks: Block[], parentId: string): number {
  return blocks
    .filter(b => b.parentId === parentId)
    .reduce((s, b) => s + Math.floor(calendarDays(b) / 7) * b.daysPerWeek, 0);
}

/** Largest-remainder method: integers summing exactly to `total`. */
function distributeWeeks(
  total: number,
  weights: { id: string; weight: number }[],
): Record<string, number> {
  if (total <= 0 || weights.length === 0) {
    return Object.fromEntries(weights.map(w => [w.id, 0]));
  }
  const sumW = weights.reduce((s, w) => s + w.weight, 0);
  if (sumW <= 0) {
    const base = Math.floor(total / weights.length);
    let rem = total - base * weights.length;
    return Object.fromEntries(weights.map(w => {
      const v = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      return [w.id, v];
    }));
  }
  const raw = weights.map(w => ({ id: w.id, exact: (w.weight / sumW) * total, floor: 0, remainder: 0 }));
  for (const r of raw) { r.floor = Math.floor(r.exact); r.remainder = r.exact - r.floor; }
  let assigned = raw.reduce((s, r) => s + r.floor, 0);
  const sorted = [...raw].sort((a, b) => b.remainder - a.remainder);
  for (const r of sorted) {
    if (assigned >= total) break;
    r.floor++;
    assigned++;
  }
  return Object.fromEntries(raw.map(r => [r.id, Math.max(0, r.floor)]));
}

/**
 * Reduce dpw by 1 for `weeksNeeded` weeks, applied late-first within parentScope.
 */
function rescueReduceWeeks(
  blocks: Block[],
  parentScope: string[],
  weeksNeeded: number,
): { blocks: Block[]; perParent: { parentId: string; weeks: number; oldDpw: number; newDpw: number }[] } {
  const working = blocks.map(b => ({ ...b }));
  const allowed = new Set(parentScope);
  let remaining = weeksNeeded;
  const perParentMap = new Map<string, { weeks: number; oldDpw: number; newDpw: number }>();

  const candidates = working
    .filter(b => allowed.has(b.parentId) && b.daysPerWeek >= 1)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  for (const target of candidates) {
    if (remaining <= 0) break;
    if (target.daysPerWeek < 1) continue;

    const calDays = calendarDays(target);
    const blockWeeks = Math.floor(calDays / 7);
    if (blockWeeks <= 0) continue;

    const oldDpw = target.daysPerWeek;
    const newDpw = oldDpw - 1;

    if (blockWeeks <= remaining) {
      target.daysPerWeek = newDpw;
      remaining -= blockWeeks;
      const entry = perParentMap.get(target.parentId);
      if (!entry) {
        perParentMap.set(target.parentId, { weeks: blockWeeks, oldDpw, newDpw });
      } else {
        entry.weeks += blockWeeks;
      }
    } else {
      const headDays = calDays - remaining * 7;
      if (headDays <= 0) {
        target.daysPerWeek = newDpw;
        const entry = perParentMap.get(target.parentId);
        if (!entry) {
          perParentMap.set(target.parentId, { weeks: blockWeeks, oldDpw, newDpw });
        } else {
          entry.weeks += blockWeeks;
        }
        remaining = 0;
      } else {
        const splitDate = addDaysISO(target.startDate, headDays);
        const tailBlock: Block = {
          id: generateBlockId("rescue"),
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: newDpw,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        target.endDate = addDaysISO(splitDate, -1);
        working.push(tailBlock);

        const entry = perParentMap.get(target.parentId);
        if (!entry) {
          perParentMap.set(target.parentId, { weeks: remaining, oldDpw, newDpw });
        } else {
          entry.weeks += remaining;
        }
        remaining = 0;
      }
    }
  }

  const perParent = Array.from(perParentMap.entries()).map(([parentId, v]) => ({ parentId, ...v }));
  return { blocks: mergeAdjacentBlocks(working), perParent };
}

// ── Main computation ──

export function computeRescueProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  existingTransfer: Transfer | null,
  mode: DistributionMode,
): Proposal | null {
  // SAFETY: rescue must not use policy modules
  if (blocks.length === 0) return null;

  const baseTransfers = existingTransfer && existingTransfer.sicknessDays > 0 ? [existingTransfer] : [];
  const origResult = simulatePlan({ parents, blocks, transfers: baseTransfers, constants });
  const missingDaysTotal = Math.round(origResult.unfulfilledDaysTotal ?? 0);
  if (missingDaysTotal <= 0) return null;

  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const debugBefore = blocks.map(b => ({ ...b }));

  // ── Step 1: Transfer-first (max possible) ──
  const scored = origResult.parentsResult.map((pr: any) => ({
    id: pr.parentId,
    name: pr.name,
    transferable: pr.remaining.sicknessTransferable as number,
    totalRemaining: (pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest) as number,
    taken: (pr.taken.sickness + pr.taken.lowest) as number,
  }));
  scored.sort((a, b) => a.totalRemaining - b.totalRemaining || b.taken - a.taken);
  const needy = scored[0];
  const giver = scored[scored.length - 1];

  let proposedTransfer: Transfer | null = null;
  let maxTransfer = 0;
  let transferDays = 0;

  if (giver.transferable > 0 && needy.id !== giver.id) {
    maxTransfer = Math.floor(giver.transferable);
    // Transfer-first: use as much as possible, up to missingDaysTotal
    transferDays = Math.min(missingDaysTotal, maxTransfer);

    const existingAmount = existingTransfer &&
      existingTransfer.fromParentId === giver.id &&
      existingTransfer.toParentId === needy.id
      ? existingTransfer.sicknessDays : 0;

    proposedTransfer = {
      fromParentId: giver.id,
      toParentId: needy.id,
      sicknessDays: existingAmount + transferDays,
    };
  }

  // ── Step 2: Simulate transfer-only to get ground truth ──
  const transferOnlyTransfers = proposedTransfer ? [proposedTransfer] : baseTransfers;
  const transferOnlyRes = simulatePlan({ parents, blocks, transfers: transferOnlyTransfers, constants });
  const missingAfterTransferOnly = Math.round(transferOnlyRes.unfulfilledDaysTotal ?? 0);

  // Use simulation-derived value for weeksTotal (ground truth)
  const weeksTotal = Math.max(0, missingAfterTransferOnly);

  // Re-derive transferDays from simulation for consistency
  transferDays = missingDaysTotal - missingAfterTransferOnly;

  // ── Step 3: Distribute weeksTotal by mode ──
  let perParentWeeks: Record<string, number>;
  if (weeksTotal <= 0) {
    perParentWeeks = Object.fromEntries(parents.map(p => [p.id, 0]));
  } else if (mode !== "proportional" && mode !== "split" && parents.find(p => p.id === mode)) {
    perParentWeeks = Object.fromEntries(parents.map(p => [p.id, p.id === mode ? weeksTotal : 0]));
  } else if (mode === "split" && parents.length >= 2) {
    const half = Math.floor(weeksTotal / 2);
    const load0 = calcParentLoad(blocks, parents[0].id);
    const load1 = calcParentLoad(blocks, parents[1].id);
    const first = half;
    const second = weeksTotal - half;
    perParentWeeks = {
      [parents[0].id]: load0 >= load1 ? second : first,
      [parents[1].id]: load0 >= load1 ? first : second,
    };
  } else {
    const weights = parents.map(p => ({ id: p.id, weight: calcParentLoad(blocks, p.id) }));
    perParentWeeks = distributeWeeks(weeksTotal, weights);
  }

  // ── Step 4: Apply pace reductions ──
  let currentBlocks = blocks.map(b => ({ ...b }));
  let rawReductionWeeks = 0;

  if (weeksTotal > 0) {
    for (const p of parents) {
      const w = perParentWeeks[p.id] ?? 0;
      if (w <= 0) continue;
      const reduction = rescueReduceWeeks(currentBlocks, [p.id], w);
      currentBlocks = reduction.blocks;
      for (const pp of reduction.perParent) rawReductionWeeks += pp.weeks;
    }
  }

  const finalBlocks = mergeAdjacentBlocks(currentBlocks);
  const finalResult = simulatePlan({ parents, blocks: finalBlocks, transfers: transferOnlyTransfers, constants });
  const finalUnfulfilled = Math.round(finalResult.unfulfilledDaysTotal ?? 0);
  const newAvg = calcAvgMonthly(finalResult.parentsResult);

  // ── Step 5: Build UI text from proposal numbers ──
  const actionsText: string[] = [];
  if (transferDays > 0) actionsText.push(`Omfördela ${transferDays} dagar mellan er`);
  if (weeksTotal > 0) actionsText.push(`Minska uttaget med ${weeksTotal} veckor totalt (−1 dag/vecka)`);

  const detailText: string[] = [];
  if (transferDays > 0 && proposedTransfer) {
    const fromName = parents.find(p => p.id === proposedTransfer!.fromParentId)?.name ?? "?";
    const toName = parents.find(p => p.id === proposedTransfer!.toParentId)?.name ?? "?";
    detailText.push(`Överför ${transferDays} dagar från ${fromName} till ${toName}`);
  }
  for (const p of parents) {
    const w = perParentWeeks[p.id] ?? 0;
    if (w > 0) detailText.push(`${p.name} minskar uttaget med 1 dag/vecka i ${w} veckor`);
  }
  if (weeksTotal === 0 && transferDays > 0) {
    detailText.push("Enbart överföring av dagar löser bristen");
  }

  const sumPerParentWeeks = Object.values(perParentWeeks).reduce((s, v) => s + v, 0);

  return {
    newBlocks: finalBlocks,
    proposedTransfer,
    missingDaysTotal,
    transferDays,
    missingAfterTransferOnly,
    weeksTotal,
    perParentWeeks,
    actionsText,
    detailText,
    deltaMonthly: Math.round(newAvg - origAvg),
    success: finalUnfulfilled <= 0,
    transferOnly: weeksTotal === 0,
    debug: {
      shortageBefore: missingDaysTotal,
      shortageAfter: finalUnfulfilled,
      maxTransfer,
      sumPerParentWeeks,
      consistent: sumPerParentWeeks === weeksTotal && (transferDays + weeksTotal === missingDaysTotal),
      rawReductionWeeks,
    },
    debugBefore,
    debugAfter: finalBlocks,
  };
}
