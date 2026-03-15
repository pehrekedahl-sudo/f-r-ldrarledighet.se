/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — SINGLE-SOURCE-OF-TRUTH SOLVER           │
 * │                                                                  │
 * │ The ONLY truth is the verified proposal object. All UI numbers  │
 * │ (weeksTotal, perParentWeeks, detailText) are derived from the   │
 * │ final reductions[] array AFTER engine verification.             │
 * │                                                                  │
 * │ Algorithm:                                                       │
 * │ A) shortageBefore = simulatePlan(currentPlan)                   │
 * │ B) Transfer-first → shortageAfterTransfer = simulatePlan(...)   │
 * │ C) Initial reduction schedule from shortageAfterTransfer        │
 * │ D) Apply + verify with simulatePlan                             │
 * │ E) If unfulfilled > 0, extend schedule until solved or stuck    │
 * │ F) Derive ALL output from final verified reductions[]           │
 * │                                                                  │
 * │ KEY INVARIANT: Each reduction = exactly -1 dpw on one 7-day    │
 * │ segment. No stacking. Preview === Apply (same object).          │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { simulatePlan } from "@/lib/simulatePlan";
import { mergeAdjacentBlocks } from "@/lib/mergeAdjacentBlocks";
import { generateBlockId } from "@/lib/blockIdUtils";
import { addDays as addDaysUtil, diffDaysInclusive, maxDate as maxDateUtil, minDate as minDateUtil } from "@/utils/dateOnly";

// ── Types ──

export type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
  isOverlap?: boolean;
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

export type ReductionRange = {
  parentId: string;
  startDate: string;
  endDate: string;
  oldDpw: number;
  newDpw: number;
  weeksCount: number;
};

/** All numbers derived from the FINAL verified state — no separate "initial estimate" */
export type Proposal = {
  /** The exact blocks to apply. Preview and Apply use this same object. */
  newBlocks: Block[];
  proposedTransfer: Transfer | null;
  /** Derived from final reductions[].weeksCount */
  weeksTotal: number;
  /** Derived from grouping final reductions[] by parentId */
  perParentWeeks: Record<string, number>;
  /** The actual reduction segments applied */
  reductions: ReductionRange[];
  /** UI text derived from reductions[] + transfer */
  actionsText: string[];
  detailText: string[];
  deltaMonthly: number;
  /** true IFF simulatePlan(proposalPlan).unfulfilledDaysTotal === 0 */
  success: boolean;
  transferOnly: boolean;
  meta: {
    shortageBefore: number;
    maxTransfer: number;
    transferDays: number;
    shortageAfterTransfer: number;
    unfulfilledAfterFull: number;
    weeksTotalApplied: number;
    perParentWeeksApplied: Record<string, number>;
    mode: string;
    weights: { p1Id: string; p1Weight: number; p2Id: string; p2Weight: number } | null;
    transferConfig: string;
  };
  debugBefore: Block[];
  debugAfter: Block[];
};

// ── Pure allocation function ──

export function allocateReductionWeeks(
  weeksTotal: number,
  mode: DistributionMode,
  parents: Parent[],
  blocks: Block[],
): Record<string, number> {
  if (parents.length < 2 || weeksTotal <= 0) {
    const result: Record<string, number> = {};
    for (const p of parents) result[p.id] = 0;
    if (parents.length === 1) result[parents[0].id] = weeksTotal;
    if (parents.length >= 2 && mode !== "proportional" && mode !== "split") {
      const target = parents.find(p => p.id === mode);
      if (target) result[target.id] = weeksTotal;
    }
    return result;
  }

  const p1 = parents[0];
  const p2 = parents[1];
  const result: Record<string, number> = { [p1.id]: 0, [p2.id]: 0 };

  if (mode !== "proportional" && mode !== "split") {
    if (mode === p1.id) { result[p1.id] = weeksTotal; return result; }
    if (mode === p2.id) { result[p2.id] = weeksTotal; return result; }
  }

  if (mode === "split") {
    result[p1.id] = Math.ceil(weeksTotal / 2);
    result[p2.id] = Math.floor(weeksTotal / 2);
    return result;
  }

  // Proportional — equalize dpw first, then split remaining evenly
  const avgDpw1 = calcAvgDpw(blocks, p1.id);
  const avgDpw2 = calcAvgDpw(blocks, p2.id);
  const cap1 = parentCapacity(blocks, p1.id);
  const cap2 = parentCapacity(blocks, p2.id);

  let assigned1 = 0;
  let assigned2 = 0;
  let remaining = weeksTotal;

  // Phase 1: Equalize — reduce the parent with higher avg dpw first
  if (avgDpw1 > avgDpw2) {
    const equalizingWeeks = Math.min(remaining, cap1, Math.ceil((avgDpw1 - avgDpw2) * cap1));
    assigned1 = equalizingWeeks;
    remaining -= equalizingWeeks;
  } else if (avgDpw2 > avgDpw1) {
    const equalizingWeeks = Math.min(remaining, cap2, Math.ceil((avgDpw2 - avgDpw1) * cap2));
    assigned2 = equalizingWeeks;
    remaining -= equalizingWeeks;
  }

  // Phase 2: Split remaining evenly, respecting capacity
  while (remaining > 0) {
    const can1 = assigned1 < cap1;
    const can2 = assigned2 < cap2;
    if (!can1 && !can2) break;
    if (can1 && (!can2 || assigned1 <= assigned2)) { assigned1++; }
    else if (can2) { assigned2++; }
    else break;
    remaining--;
  }

  result[p1.id] = assigned1;
  result[p2.id] = assigned2;
  return result;
}

// ── Helpers ──

function addDaysISO(iso: string, days: number): string {
  return addDaysUtil(iso, days);
}

function calendarDays(startDate: string, endDate: string): number {
  return diffDaysInclusive(startDate, endDate);
}

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

function calcParentLoad(blocks: Block[], parentId: string): number {
  return blocks
    .filter(b => b.parentId === parentId && !b.isOverlap)
    .reduce((s, b) => s + Math.floor(calendarDays(b.startDate, b.endDate) / 7) * b.daysPerWeek, 0);
}

/** Weighted average dpw for a parent's blocks */
function calcAvgDpw(blocks: Block[], parentId: string): number {
  const pBlocks = blocks.filter(b => b.parentId === parentId && b.daysPerWeek >= 1 && !b.isOverlap);
  const totalWeeks = pBlocks.reduce((s, b) => s + Math.floor(calendarDays(b.startDate, b.endDate) / 7), 0);
  if (totalWeeks <= 0) return 0;
  const totalDays = pBlocks.reduce((s, b) => s + Math.floor(calendarDays(b.startDate, b.endDate) / 7) * b.daysPerWeek, 0);
  return totalDays / totalWeeks;
}

/** Run simulatePlan and return integer shortage */
function engineShortage(
  parents: Parent[],
  blocks: Block[],
  transfers: Transfer[],
  constants: Constants,
): { shortage: number; result: any } {
  const result = simulatePlan({ parents, blocks, transfers, constants });
  return { shortage: Math.round(result.unfulfilledDaysTotal ?? 0), result };
}

/** Derive weeksTotal and perParentWeeks from the final reductions list */
function deriveFromReductions(
  reductions: ReductionRange[],
  parents: Parent[],
): { weeksTotalApplied: number; perParentWeeksApplied: Record<string, number> } {
  const perParent: Record<string, number> = {};
  for (const p of parents) perParent[p.id] = 0;
  for (const r of reductions) {
    perParent[r.parentId] = (perParent[r.parentId] ?? 0) + r.weeksCount;
  }
  const total = Object.values(perParent).reduce((s, v) => s + v, 0);
  return { weeksTotalApplied: total, perParentWeeksApplied: perParent };
}

// ── Deterministic reduction helpers ──

/** Each week reduced by 1 dpw saves 1 day (since we reduce by exactly 1 dpw per range).
 *  Only if the block actually has eligible days in those weeks.
 *  For simplicity and correctness: 1 week × 1 dpw reduction = 1 day saved. */
function estimateDaysSavedByReduction(_block: Block, weeksCount: number): number {
  return weeksCount;
}

function getReductionRangesForParent(
  blocks: Block[],
  parentId: string,
  daysNeeded: number,
): ReductionRange[] {
  if (daysNeeded <= 0) return [];
  const parentBlocks = blocks
    .filter(b => b.parentId === parentId && b.daysPerWeek >= 1 && !b.isOverlap)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
  const ranges: ReductionRange[] = [];
  let daysRemaining = daysNeeded;
  for (const block of parentBlocks) {
    if (daysRemaining <= 0) break;
    const totalCalendarDays = calendarDays(block.startDate, block.endDate);
    const totalWeeks = Math.floor(totalCalendarDays / 7);
    if (totalWeeks <= 0) continue;
    // Each week reduced by 1 dpw saves exactly 1 day
    const weeksFromThis = Math.min(daysRemaining, totalWeeks);
    const rangeEnd = block.endDate;
    const rangeStart = addDaysISO(rangeEnd, -(weeksFromThis * 7) + 1);
    ranges.push({
      parentId,
      startDate: rangeStart,
      endDate: rangeEnd,
      oldDpw: block.daysPerWeek,
      newDpw: Math.max(0, block.daysPerWeek - 1),
      weeksCount: weeksFromThis,
    });
    daysRemaining -= weeksFromThis;
  }
  return ranges.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function applyDeterministicReductions(
  blocks: Block[],
  reductions: ReductionRange[],
): Block[] {
  let working = blocks.map(b => ({ ...b }));

  for (const range of reductions) {
    const next: Block[] = [];
    for (const b of working) {
      if (b.parentId !== range.parentId || b.isOverlap) { next.push(b); continue; }
      if (b.endDate < range.startDate || b.startDate > range.endDate) { next.push(b); continue; }

      const overlapStart = b.startDate > range.startDate ? b.startDate : range.startDate;
      const overlapEnd = b.endDate < range.endDate ? b.endDate : range.endDate;

      if (b.startDate < overlapStart) {
        next.push({ ...b, endDate: addDaysISO(overlapStart, -1) });
      }

      const newDpw = Math.max(0, b.daysPerWeek - 1);
      next.push({
        ...b,
        id: generateBlockId("rescue"),
        startDate: overlapStart,
        endDate: overlapEnd,
        daysPerWeek: newDpw,
        lowestDaysPerWeek: b.lowestDaysPerWeek !== undefined
          ? Math.min(b.lowestDaysPerWeek, newDpw) : undefined,
      });

      if (b.endDate > overlapEnd) {
        next.push({ ...b, id: generateBlockId("rescue"), startDate: addDaysISO(overlapEnd, 1) });
      }
    }
    working = next;
  }
  return working;
}

function buildReductionsFromAllocation(
  blocks: Block[],
  parents: Parent[],
  perParentWeeks: Record<string, number>,
): ReductionRange[] {
  const all: ReductionRange[] = [];
  for (const p of parents) {
    const w = perParentWeeks[p.id] ?? 0;
    if (w <= 0) continue;
    all.push(...getReductionRangesForParent(blocks, p.id, w));
  }
  return all;
}

function buildProposalBlocks(blocks: Block[], reductions: ReductionRange[]): Block[] {
  return mergeAdjacentBlocks(applyDeterministicReductions(blocks, reductions));
}

/** How many reducible whole-weeks does this parent have in the original blocks */
function parentCapacity(blocks: Block[], parentId: string): number {
  return blocks
    .filter(b => b.parentId === parentId && b.daysPerWeek >= 1 && !b.isOverlap)
    .reduce((s, b) => s + Math.floor(calendarDays(b.startDate, b.endDate) / 7), 0);
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

  // ══════════════════════════════════════════════
  // A) Engine truth — current plan shortage
  // ══════════════════════════════════════════════
  const baseTransfers = existingTransfer && existingTransfer.sicknessDays > 0 ? [existingTransfer] : [];
  const { shortage: shortageBefore, result: origResult } = engineShortage(parents, blocks, baseTransfers, constants);

  console.group('[RESCUE] computeRescueProposal');
  console.log('[RESCUE] A) shortageBefore =', shortageBefore);
  for (const pr of origResult.parentsResult) {
    console.log(`[RESCUE]   ${pr.parentId}: taken.sickness=${pr.taken.sickness}, taken.lowest=${pr.taken.lowest}, remaining.transferable=${pr.remaining.sicknessTransferable}, remaining.reserved=${pr.remaining.sicknessReserved}, remaining.lowest=${pr.remaining.lowest}`);
  }

  if (shortageBefore <= 0) { console.groupEnd(); return null; }

  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const debugBefore = blocks.map(b => ({ ...b }));

  // ══════════════════════════════════════════════
  // B) Transfer-first
  // ══════════════════════════════════════════════
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
    transferDays = Math.min(shortageBefore, maxTransfer);
    proposedTransfer = { fromParentId: giver.id, toParentId: needy.id, sicknessDays: transferDays };
  }

  const transferList: Transfer[] = proposedTransfer ? [proposedTransfer] : [];
  const transferConfigStr = JSON.stringify(transferList);

  // ══════════════════════════════════════════════
  // C) Engine truth — shortage after transfer only
  // ══════════════════════════════════════════════
  const { shortage: shortageAfterTransfer, result: afterTransferResult } = engineShortage(
    parents, blocks, transferList, constants,
  );
  console.log('[RESCUE] B) transferDays =', transferDays, ', maxTransfer =', maxTransfer);
  console.log('[RESCUE] C) shortageAfterTransfer =', shortageAfterTransfer);

  // Transfer-only success
  if (shortageAfterTransfer <= 0) {
    const newAvg = calcAvgMonthly(afterTransferResult.parentsResult);
    const ppw = Object.fromEntries(parents.map(p => [p.id, 0]));
    return {
      newBlocks: blocks.map(b => ({ ...b })),
      proposedTransfer,
      weeksTotal: 0,
      perParentWeeks: ppw,
      reductions: [],
      actionsText: [`Omfördela ${transferDays} dagar mellan er`],
      detailText: (() => {
        const lines: string[] = [];
        if (proposedTransfer) {
          const fromName = parents.find(p => p.id === proposedTransfer!.fromParentId)?.name ?? "?";
          const toName = parents.find(p => p.id === proposedTransfer!.toParentId)?.name ?? "?";
          lines.push(`${fromName} överför ${transferDays} dagar till ${toName}`);
        }
        lines.push("Enbart överföring av dagar löser bristen");
        return lines;
      })(),
      deltaMonthly: Math.round(newAvg - origAvg),
      success: true,
      transferOnly: true,
      meta: {
        shortageBefore, maxTransfer, transferDays, shortageAfterTransfer: 0,
        unfulfilledAfterFull: 0, weeksTotalApplied: 0, perParentWeeksApplied: ppw,
        mode, weights: null, transferConfig: transferConfigStr,
      },
      debugBefore,
      debugAfter: blocks.map(b => ({ ...b })),
    };
  }

  // ══════════════════════════════════════════════
  // D) Initial reduction schedule from mode
  // ══════════════════════════════════════════════
  const weights = parents.length >= 2 ? {
    p1Id: parents[0].id,
    p1Weight: calcParentLoad(blocks, parents[0].id),
    p2Id: parents[1].id,
    p2Weight: calcParentLoad(blocks, parents[1].id),
  } : null;

  // Find which parent is actually in deficit after transfer
  const deficitParentId = (() => {
    let worstId = parents[0].id;
    let worstRemaining = Infinity;
    for (const pr of afterTransferResult.parentsResult) {
      const remaining = pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest;
      if (remaining < worstRemaining) {
        worstRemaining = remaining;
        worstId = pr.parentId;
      }
    }
    return worstId;
  })();

  // For proportional/split: respect user's choice first, fallback to deficit parent if needed
  let perParentWeeks = allocateReductionWeeks(Math.ceil(shortageAfterTransfer), mode, parents, blocks);

  // ══════════════════════════════════════════════
  // E) Apply reductions + verify + extend if needed
  //    This loop IS the solver. "correctionSteps" is not
  //    a separate concept — the final reductions[] is the
  //    only truth.
  // ══════════════════════════════════════════════
  let allReductions = buildReductionsFromAllocation(blocks, parents, perParentWeeks);
  let proposalBlocks = buildProposalBlocks(blocks, allReductions);
  let { shortage: unfulfilledAfterFull, result: finalResult } = engineShortage(
    parents, proposalBlocks, transferList, constants,
  );

  // Safety net — extend if initial estimate is insufficient
  const MAX_EXTEND = 5;
  let extendIters = 0;

  while (unfulfilledAfterFull > 0 && extendIters < MAX_EXTEND) {
    let bestPid: string | null = null;
    let bestShortage = unfulfilledAfterFull;

    for (const p of parents) {
      if ((perParentWeeks[p.id] ?? 0) >= parentCapacity(blocks, p.id)) continue;

      const testWeeks = { ...perParentWeeks, [p.id]: (perParentWeeks[p.id] ?? 0) + 1 };
      const testReductions = buildReductionsFromAllocation(blocks, parents, testWeeks);
      const testBlocks = buildProposalBlocks(blocks, testReductions);
      const { shortage } = engineShortage(parents, testBlocks, transferList, constants);

      if (shortage < bestShortage) {
        bestShortage = shortage;
        bestPid = p.id;
      }
    }

    if (!bestPid) break;

    perParentWeeks[bestPid] = (perParentWeeks[bestPid] ?? 0) + 1;
    extendIters++;

    allReductions = buildReductionsFromAllocation(blocks, parents, perParentWeeks);
    proposalBlocks = buildProposalBlocks(blocks, allReductions);
    const v = engineShortage(parents, proposalBlocks, transferList, constants);
    unfulfilledAfterFull = v.shortage;
    finalResult = v.result;
  }

  // ══════════════════════════════════════════════
  // E2) Fallback: if user's mode didn't resolve, retry with deficit parent
  // ══════════════════════════════════════════════
  if (unfulfilledAfterFull > 0 && (mode === "proportional" || mode === "split")) {
    perParentWeeks = allocateReductionWeeks(Math.ceil(shortageAfterTransfer), deficitParentId, parents, blocks);
    allReductions = buildReductionsFromAllocation(blocks, parents, perParentWeeks);
    proposalBlocks = buildProposalBlocks(blocks, allReductions);
    const v2 = engineShortage(parents, proposalBlocks, transferList, constants);
    unfulfilledAfterFull = v2.shortage;
    finalResult = v2.result;

    let extendIters2 = 0;
    while (unfulfilledAfterFull > 0 && extendIters2 < MAX_EXTEND) {
      let bestPid: string | null = null;
      let bestShortage = unfulfilledAfterFull;

      for (const p of parents) {
        if ((perParentWeeks[p.id] ?? 0) >= parentCapacity(blocks, p.id)) continue;
        const testWeeks = { ...perParentWeeks, [p.id]: (perParentWeeks[p.id] ?? 0) + 1 };
        const testReductions = buildReductionsFromAllocation(blocks, parents, testWeeks);
        const testBlocks = buildProposalBlocks(blocks, testReductions);
        const { shortage } = engineShortage(parents, testBlocks, transferList, constants);
        if (shortage < bestShortage) { bestShortage = shortage; bestPid = p.id; }
      }
      if (!bestPid) break;
      perParentWeeks[bestPid] = (perParentWeeks[bestPid] ?? 0) + 1;
      extendIters2++;
      allReductions = buildReductionsFromAllocation(blocks, parents, perParentWeeks);
      proposalBlocks = buildProposalBlocks(blocks, allReductions);
      const v3 = engineShortage(parents, proposalBlocks, transferList, constants);
      unfulfilledAfterFull = v3.shortage;
      finalResult = v3.result;
    }
  }

  // ══════════════════════════════════════════════
  // E3) Shrink pass — remove excess reduction weeks
  //     to find the MINIMUM adjustment that solves the shortage
  // ══════════════════════════════════════════════
  if (unfulfilledAfterFull <= 0) {
    // Calculate baseline remaining days to preserve saved days
    const baselineRemaining = parents.reduce((sum, p) => {
      const pr = finalResult.parentsResult.find((r: any) => r.parentId === p.id);
      if (!pr) return sum;
      return sum + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest;
    }, 0);

    const MAX_SHRINK = 50;
    let shrinkIters = 0;

    while (shrinkIters < MAX_SHRINK) {
      // Try removing one week from the parent with the most reduction weeks
      const candidates = parents
        .filter(p => (perParentWeeks[p.id] ?? 0) > 0)
        .sort((a, b) => (perParentWeeks[b.id] ?? 0) - (perParentWeeks[a.id] ?? 0));

      let shrank = false;
      for (const p of candidates) {
        const testWeeks = { ...perParentWeeks, [p.id]: perParentWeeks[p.id] - 1 };
        const testReductions = buildReductionsFromAllocation(blocks, parents, testWeeks);
        const testBlocks = buildProposalBlocks(blocks, testReductions);
        const { shortage, result } = engineShortage(parents, testBlocks, transferList, constants);

        // Check that shrinking doesn't increase remaining days (which would mean saved days increased)
        const testRemaining = parents.reduce((sum, pp) => {
          const pr = result.parentsResult.find((r: any) => r.parentId === pp.id);
          if (!pr) return sum;
          return sum + pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest;
        }, 0);

        if (shortage <= 0 && testRemaining <= baselineRemaining) {
          perParentWeeks[p.id] = testWeeks[p.id];
          allReductions = testReductions;
          proposalBlocks = testBlocks;
          unfulfilledAfterFull = shortage;
          finalResult = result;
          shrank = true;
          break;
        }
      }

      if (!shrank) break;
      shrinkIters++;
    }
  }


  // F) Derive ALL output from the final verified state
  //    reductions[] is the single source of truth.
  // ══════════════════════════════════════════════
  const { weeksTotalApplied, perParentWeeksApplied } = deriveFromReductions(allReductions, parents);
  const success = unfulfilledAfterFull <= 0;
  const newAvg = calcAvgMonthly(finalResult.parentsResult);

  // UI text — derived from final reductions + transfer
  const actionsText: string[] = [];
  if (transferDays > 0) actionsText.push(`Omfördela ${transferDays} dagar mellan er`);
  if (weeksTotalApplied > 0) actionsText.push(`Minska uttaget med 1 dag/vecka i ${weeksTotalApplied} veckor`);

  const detailText: string[] = [];
  if (transferDays > 0 && proposedTransfer) {
    const fromName = parents.find(p => p.id === proposedTransfer!.fromParentId)?.name ?? "?";
    const toName = parents.find(p => p.id === proposedTransfer!.toParentId)?.name ?? "?";
    detailText.push(`${fromName} överför ${transferDays} dagar till ${toName}`);
  }
  for (const p of parents) {
    const w = perParentWeeksApplied[p.id] ?? 0;
    if (w > 0) detailText.push(`${p.name} minskar uttaget med 1 dag/vecka i ${w} veckor`);
  }

  return {
    newBlocks: proposalBlocks,
    proposedTransfer,
    weeksTotal: weeksTotalApplied,
    perParentWeeks: perParentWeeksApplied,
    reductions: allReductions,
    actionsText,
    detailText,
    deltaMonthly: Math.round(newAvg - origAvg),
    success,
    transferOnly: false,
    meta: {
      shortageBefore,
      maxTransfer,
      transferDays,
      shortageAfterTransfer,
      unfulfilledAfterFull,
      weeksTotalApplied,
      perParentWeeksApplied,
      mode,
      weights,
      transferConfig: transferConfigStr,
    },
    debugBefore,
    debugAfter: proposalBlocks,
  };
}
