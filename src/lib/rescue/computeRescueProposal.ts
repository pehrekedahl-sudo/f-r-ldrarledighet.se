/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — ENGINE-DRIVEN ITERATIVE SOLVER          │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. All shortage numbers are derived from          │
 * │ simulatePlan (engine truth), never from arithmetic assumptions. │
 * │                                                                  │
 * │ Algorithm: max transfer first → iterative -1 dpw reductions    │
 * │ verified by simulatePlan after each step.                       │
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
  missingDaysTotal: number;
  transferDays: number;
  missingAfterTransferOnly: number;
  weeksTotal: number;
  perParentWeeks: Record<string, number>;
  actionsText: string[];
  detailText: string[];
  deltaMonthly: number;
  success: boolean;
  transferOnly: boolean;
  debug: {
    shortageBefore: number;
    shortageAfterTransfer: number;
    shortageAfter: number;
    maxTransfer: number;
    sumPerParentWeeks: number;
    iterationsUsed: number;
    unfulfilledAfterFull: number;
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

/** Engine truth: get shortage as integer */
function getShortage(
  parents: Parent[],
  blocks: Block[],
  transfers: Transfer[],
  constants: Constants,
): { shortage: number; result: any } {
  const result = simulatePlan({ parents, blocks, transfers, constants });
  const raw = result.unfulfilledDaysTotal ?? 0;
  return { shortage: Math.round(raw), result };
}

/**
 * Find the next reducible 7-day segment for a given parent, late-first.
 * Returns the block index and split info, or null if no reduction possible.
 */
function findNextReductionSegment(
  blocks: Block[],
  parentId: string,
): { blockIdx: number; needsSplit: boolean; splitCalDayOffset: number } | null {
  // Candidates: blocks for this parent with dpw >= 1, sorted latest-first
  const indices = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.parentId === parentId && b.daysPerWeek >= 1)
    .sort((a, b) => b.b.startDate.localeCompare(a.b.startDate));

  for (const { b, i } of indices) {
    const calDays_ = calendarDays(b);
    const blockWeeks = Math.floor(calDays_ / 7);
    if (blockWeeks <= 0) continue;

    if (blockWeeks === 1 || calDays_ <= 7) {
      // Entire block is one week — reduce whole block
      return { blockIdx: i, needsSplit: false, splitCalDayOffset: 0 };
    }
    // Split: reduce last 7 days only
    return { blockIdx: i, needsSplit: true, splitCalDayOffset: calDays_ - 7 };
  }
  return null;
}

/**
 * Apply a single -1 dpw reduction to one 7-day segment (late-first) for a parent.
 * Mutates working array in place, returns true if applied.
 */
function applyOneReduction(working: Block[], parentId: string): boolean {
  const seg = findNextReductionSegment(working, parentId);
  if (!seg) return false;

  const target = working[seg.blockIdx];
  if (!seg.needsSplit) {
    // Reduce entire block
    target.daysPerWeek = Math.max(0, target.daysPerWeek - 1);
    return true;
  }

  // Split block: head keeps original dpw, tail gets dpw-1
  const splitDate = addDaysISO(target.startDate, seg.splitCalDayOffset);
  const tailBlock: Block = {
    id: generateBlockId("rescue"),
    parentId: target.parentId,
    startDate: splitDate,
    endDate: target.endDate,
    daysPerWeek: Math.max(0, target.daysPerWeek - 1),
    lowestDaysPerWeek: target.lowestDaysPerWeek,
    overlapGroupId: target.overlapGroupId,
  };
  target.endDate = addDaysISO(splitDate, -1);
  working.push(tailBlock);
  return true;
}

/**
 * Pick which parent gets the next reduction unit based on distribution mode.
 */
function pickNextParent(
  parents: Parent[],
  mode: DistributionMode,
  currentAlloc: Record<string, number>,
  targetShares: Record<string, number>,
  blocks: Block[],
): string {
  if (mode !== "proportional" && mode !== "split" && parents.find(p => p.id === mode)) {
    return mode; // onlyP1 or onlyP2
  }

  if (mode === "split") {
    // 50/50: give to the parent with fewer allocated so far
    const a0 = currentAlloc[parents[0].id] ?? 0;
    const a1 = currentAlloc[parents[1]?.id] ?? 0;
    return a0 <= a1 ? parents[0].id : parents[1].id;
  }

  // Proportional: give to parent furthest below their target share
  let bestId = parents[0].id;
  let bestDeficit = -Infinity;
  const totalAlloc = Object.values(currentAlloc).reduce((s, v) => s + v, 0);

  for (const p of parents) {
    const target = targetShares[p.id] ?? 0;
    const actual = totalAlloc > 0 ? (currentAlloc[p.id] ?? 0) / (totalAlloc + 1) : 0;
    const deficit = target - actual;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestId = p.id;
    }
  }
  return bestId;
}

// ── Main computation ──

export function computeRescueProposal(
  blocks: Block[],
  parents: Parent[],
  constants: Constants,
  existingTransfer: Transfer | null,
  mode: DistributionMode,
): Proposal | null {
  if (blocks.length === 0) return null;

  // ── Step 0: Engine truth — current plan shortage ──
  const baseTransfers = existingTransfer && existingTransfer.sicknessDays > 0 ? [existingTransfer] : [];
  const { shortage: missingDaysTotal, result: origResult } = getShortage(parents, blocks, baseTransfers, constants);
  if (missingDaysTotal <= 0) return null;

  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const debugBefore = blocks.map(b => ({ ...b }));

  // ── Step 1: Transfer-first — determine donor & max transfer ──
  const scored = origResult.parentsResult.map((pr: any) => ({
    id: pr.parentId,
    transferable: Math.floor(pr.remaining.sicknessTransferable as number),
  }));
  scored.sort((a, b) => b.transferable - a.transferable);
  const giver = scored[0];
  const needy = scored[scored.length - 1];

  let proposedTransfer: Transfer | null = null;
  let maxTransfer = 0;
  let transferDays = 0;

  if (giver.transferable > 0 && needy.id !== giver.id) {
    maxTransfer = giver.transferable;
    transferDays = Math.min(missingDaysTotal, maxTransfer);
    proposedTransfer = {
      fromParentId: giver.id,
      toParentId: needy.id,
      sicknessDays: transferDays,
    };
  }

  // ── Step 2: Engine truth — shortage after transfer only ──
  const transferList = proposedTransfer ? [proposedTransfer] : [];
  const { shortage: shortageAfterTransfer } = getShortage(parents, blocks, transferList, constants);

  // ── Step 3: Iterative engine-driven reduction loop ──
  let workingBlocks = blocks.map(b => ({ ...b }));
  const perParentWeeks: Record<string, number> = Object.fromEntries(parents.map(p => [p.id, 0]));
  let currentShortage = shortageAfterTransfer;
  let iterations = 0;
  const MAX_ITERATIONS = 200; // safety cap

  // Compute target shares for proportional mode
  const totalLoad = parents.reduce((s, p) => s + calcParentLoad(blocks, p.id), 0);
  const targetShares: Record<string, number> = Object.fromEntries(
    parents.map(p => [p.id, totalLoad > 0 ? calcParentLoad(blocks, p.id) / totalLoad : 1 / parents.length])
  );

  while (currentShortage > 0 && iterations < MAX_ITERATIONS) {
    // Pick which parent gets the next reduction
    const targetParentId = pickNextParent(parents, mode, perParentWeeks, targetShares, workingBlocks);

    // Try to apply one reduction to target parent
    let applied = applyOneReduction(workingBlocks, targetParentId);

    // If target parent can't reduce, try the other parent(s) (spill)
    if (!applied) {
      for (const p of parents) {
        if (p.id === targetParentId) continue;
        applied = applyOneReduction(workingBlocks, p.id);
        if (applied) {
          perParentWeeks[p.id] = (perParentWeeks[p.id] ?? 0) + 1;
          break;
        }
      }
      if (!applied) break; // No parent can reduce further
    } else {
      perParentWeeks[targetParentId] = (perParentWeeks[targetParentId] ?? 0) + 1;
    }

    iterations++;

    // Merge and verify with engine
    const merged = mergeAdjacentBlocks(workingBlocks);
    const { shortage } = getShortage(parents, merged, transferList, constants);
    currentShortage = shortage;

    if (currentShortage <= 0) {
      workingBlocks = merged;
      break;
    }
  }

  const weeksTotal = Object.values(perParentWeeks).reduce((s, v) => s + v, 0);
  const finalBlocks = mergeAdjacentBlocks(workingBlocks);

  // ── Step 4: Final engine verification ──
  const { shortage: finalShortage, result: finalResult } = getShortage(parents, finalBlocks, transferList, constants);
  const newAvg = calcAvgMonthly(finalResult.parentsResult);
  const success = finalShortage <= 0;

  // ── Step 5: Build UI text from ACTUAL applied steps ──
  const actionsText: string[] = [];
  if (transferDays > 0) actionsText.push(`Omfördela ${transferDays} dagar mellan er`);
  if (weeksTotal > 0) actionsText.push(`Minska uttaget med ${weeksTotal} veckor totalt (−1 dag/vecka)`);

  const detailText: string[] = [];
  if (transferDays > 0 && proposedTransfer) {
    const fromName = parents.find(p => p.id === proposedTransfer!.fromParentId)?.name ?? "?";
    const toName = parents.find(p => p.id === proposedTransfer!.toParentId)?.name ?? "?";
    detailText.push(`${fromName} överför ${transferDays} dagar till ${toName}`);
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
    missingAfterTransferOnly: shortageAfterTransfer,
    weeksTotal,
    perParentWeeks,
    actionsText,
    detailText,
    deltaMonthly: Math.round(newAvg - origAvg),
    success,
    transferOnly: weeksTotal === 0,
    debug: {
      shortageBefore: missingDaysTotal,
      shortageAfterTransfer,
      shortageAfter: finalShortage,
      maxTransfer,
      sumPerParentWeeks,
      iterationsUsed: iterations,
      unfulfilledAfterFull: finalShortage,
    },
    debugBefore,
    debugAfter: finalBlocks,
  };
}
