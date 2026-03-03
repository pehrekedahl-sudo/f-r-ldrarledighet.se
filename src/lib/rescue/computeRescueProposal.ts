/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — ENGINE-DRIVEN DETERMINISTIC SOLVER      │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. All shortage numbers are derived from          │
 * │ simulatePlan (engine truth), never from arithmetic assumptions. │
 * │                                                                  │
 * │ Algorithm: transfer-first → iteratively discover weeksTotal     │
 * │ via engine verification → deterministically rebuild blocks      │
 * │ using mode-based per-parent allocation.                         │
 * │                                                                  │
 * │ KEY INVARIANT: Each reduction is exactly -1 dpw on one 7-day   │
 * │ segment, applied once. No stacking. Preview === Apply.          │
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

export type ReductionRange = {
  parentId: string;
  startDate: string;
  endDate: string;
  oldDpw: number;
  newDpw: number;
  weeksCount: number;
};

export type Proposal = {
  newBlocks: Block[];
  proposedTransfer: Transfer | null;
  missingDaysTotal: number;
  transferDays: number;
  missingAfterTransferOnly: number;
  weeksTotal: number;
  perParentWeeks: Record<string, number>;
  reductions: ReductionRange[];
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
    stepsApplied: number;
    noOpSkips: number;
    unfulfilledAfterFull: number;
    mode: string;
    weights: { p1Id: string; p1Weight: number; p2Id: string; p2Weight: number } | null;
  };
  debugBefore: Block[];
  debugAfter: Block[];
};

// ── Pure allocation function ──

/**
 * Deterministically allocate reduction weeks between two parents based on mode.
 * This is a PURE function — no engine calls, no side effects.
 */
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

  // "Endast [parent]"
  if (mode !== "proportional" && mode !== "split") {
    if (mode === p1.id) { result[p1.id] = weeksTotal; return result; }
    if (mode === p2.id) { result[p2.id] = weeksTotal; return result; }
  }

  // 50/50
  if (mode === "split") {
    result[p1.id] = Math.ceil(weeksTotal / 2);
    result[p2.id] = Math.floor(weeksTotal / 2);
    return result;
  }

  // Proportional
  const load1 = calcParentLoad(blocks, p1.id);
  const load2 = calcParentLoad(blocks, p2.id);
  const totalLoad = load1 + load2;

  if (totalLoad <= 0) {
    result[p1.id] = Math.ceil(weeksTotal / 2);
    result[p2.id] = Math.floor(weeksTotal / 2);
    return result;
  }

  const exact1 = (load1 / totalLoad) * weeksTotal;
  const exact2 = (load2 / totalLoad) * weeksTotal;
  let floor1 = Math.floor(exact1);
  let floor2 = Math.floor(exact2);
  let remainder = weeksTotal - floor1 - floor2;
  const frac1 = exact1 - floor1;
  const frac2 = exact2 - floor2;
  while (remainder > 0) {
    if (frac1 > frac2 || (frac1 === frac2 && load1 >= load2)) floor1++;
    else floor2++;
    remainder--;
  }

  result[p1.id] = floor1;
  result[p2.id] = floor2;
  return result;
}

// ── Helpers ──

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarDays(startDate: string, endDate: string): number {
  return Math.ceil(
    (new Date(endDate + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime()) /
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
    .reduce((s, b) => s + Math.floor(calendarDays(b.startDate, b.endDate) / 7) * b.daysPerWeek, 0);
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

// ── Deterministic reduction helpers ──

/**
 * Walk a parent's blocks from latest endDate backwards, allocating
 * weeksNeeded as contiguous 7-day chunks. Returns ordered ranges.
 * Each range references the original dpw so we know old→new.
 */
function getReductionRangesForParent(
  blocks: Block[],
  parentId: string,
  weeksNeeded: number,
): ReductionRange[] {
  if (weeksNeeded <= 0) return [];

  // Get this parent's blocks sorted by endDate descending
  const parentBlocks = blocks
    .filter(b => b.parentId === parentId && b.daysPerWeek >= 1)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  const ranges: ReductionRange[] = [];
  let weeksRemaining = weeksNeeded;

  for (const block of parentBlocks) {
    if (weeksRemaining <= 0) break;

    const days = calendarDays(block.startDate, block.endDate);
    const blockWeeks = Math.floor(days / 7);
    if (blockWeeks <= 0) continue;

    const weeksFromThis = Math.min(weeksRemaining, blockWeeks);
    // Take from the END of this block
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
    weeksRemaining -= weeksFromThis;
  }

  // Return ordered by date (earliest first)
  return ranges.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * Apply deterministic reductions to blocks. For each range, split blocks
 * at range boundaries and set the inner segment's dpw to oldDpw - 1.
 * Each range is applied ONCE — no stacking.
 */
function applyDeterministicReductions(
  blocks: Block[],
  reductions: ReductionRange[],
): Block[] {
  let working = blocks.map(b => ({ ...b }));

  for (const range of reductions) {
    const next: Block[] = [];
    for (const b of working) {
      // Only affect blocks for this parent
      if (b.parentId !== range.parentId) {
        next.push(b);
        continue;
      }

      // Check overlap
      if (b.endDate < range.startDate || b.startDate > range.endDate) {
        next.push(b);
        continue;
      }

      // Compute overlap
      const overlapStart = b.startDate > range.startDate ? b.startDate : range.startDate;
      const overlapEnd = b.endDate < range.endDate ? b.endDate : range.endDate;

      // Before segment (untouched)
      if (b.startDate < overlapStart) {
        next.push({
          ...b,
          endDate: addDaysISO(overlapStart, -1),
        });
      }

      // Inside segment (reduced by exactly 1)
      const newDpw = Math.max(0, b.daysPerWeek - 1);
      next.push({
        ...b,
        id: generateBlockId("rescue"),
        startDate: overlapStart,
        endDate: overlapEnd,
        daysPerWeek: newDpw,
        lowestDaysPerWeek: b.lowestDaysPerWeek !== undefined
          ? Math.min(b.lowestDaysPerWeek, newDpw)
          : undefined,
      });

      // After segment (untouched)
      if (b.endDate > overlapEnd) {
        next.push({
          ...b,
          id: generateBlockId("rescue"),
          startDate: addDaysISO(overlapEnd, 1),
        });
      }
    }
    working = next;
  }

  return working;
}

/**
 * Iterative discovery: find how many -1 dpw week-steps are needed to
 * reach zero shortage. This mutates a scratch copy only — the result
 * blocks are discarded. Only weeksTotal is kept.
 */
function discoverWeeksTotal(
  blocks: Block[],
  parents: Parent[],
  transfers: Transfer[],
  constants: Constants,
  shortageAfterTransfer: number,
): { weeksTotal: number; noOpSkips: number } {
  const HARD_CAP = 260;
  let currentBlocks = blocks.map(b => ({ ...b }));
  let remaining = shortageAfterTransfer;
  let stepsApplied = 0;
  let noOpSkips = 0;

  while (remaining > 0 && stepsApplied + noOpSkips < HARD_CAP) {
    // Try each parent until we find an effective step
    let stepDone = false;
    for (const p of parents) {
      const candidates = currentBlocks
        .filter(b => b.parentId === p.id && b.daysPerWeek >= 1 &&
          calendarDays(b.startDate, b.endDate) >= 7);
      if (candidates.length === 0) continue;

      const { blocks: candidateBlocks, applied } = applyOneDiscoveryReduction(currentBlocks, p.id);
      if (!applied) continue;

      const merged = mergeAdjacentBlocks(candidateBlocks);
      const { shortage: newRemaining } = getShortage(parents, merged, transfers, constants);
      const effectiveDelta = remaining - newRemaining;

      if (effectiveDelta <= 0) {
        noOpSkips++;
        continue;
      }

      currentBlocks = merged;
      remaining = newRemaining;
      stepsApplied++;
      stepDone = true;
      break;
    }

    if (!stepDone) {
      // Try a forced step on any parent to advance
      const anyPid = parents.find(p =>
        currentBlocks.some(b => b.parentId === p.id && b.daysPerWeek >= 1 &&
          calendarDays(b.startDate, b.endDate) >= 7)
      )?.id;
      if (!anyPid) break;
      const { blocks: fb, applied } = applyOneDiscoveryReduction(currentBlocks, anyPid);
      if (!applied) break;
      currentBlocks = mergeAdjacentBlocks(fb);
      stepsApplied++;
      const { shortage: nr } = getShortage(parents, currentBlocks, transfers, constants);
      remaining = nr;
    }
  }

  return { weeksTotal: stepsApplied, noOpSkips };
}

/**
 * Apply one -1 dpw reduction on the latest eligible 7-day segment for discovery.
 */
function applyOneDiscoveryReduction(
  blocks: Block[],
  parentId: string,
): { blocks: Block[]; applied: boolean } {
  const working = blocks.map(b => ({ ...b }));
  const candidates = working
    .filter(b => b.parentId === parentId && b.daysPerWeek >= 1)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  for (const target of candidates) {
    const days = calendarDays(target.startDate, target.endDate);
    if (days < 7) continue;

    const blockWeeks = Math.floor(days / 7);
    if (blockWeeks <= 0) continue;

    const reducedDpw = target.daysPerWeek - 1;

    if (blockWeeks === 1) {
      target.daysPerWeek = reducedDpw;
      if (target.lowestDaysPerWeek !== undefined && target.lowestDaysPerWeek > reducedDpw) {
        target.lowestDaysPerWeek = reducedDpw;
      }
      return { blocks: working, applied: true };
    }

    // Split off last 7 days
    const tailStart = addDaysISO(target.endDate, -6);
    const headEnd = addDaysISO(tailStart, -1);

    const tailBlock: Block = {
      id: generateBlockId("rescue-disc"),
      parentId: target.parentId,
      startDate: tailStart,
      endDate: target.endDate,
      daysPerWeek: reducedDpw,
      lowestDaysPerWeek: target.lowestDaysPerWeek !== undefined
        ? Math.min(target.lowestDaysPerWeek, reducedDpw)
        : undefined,
      overlapGroupId: target.overlapGroupId,
    };

    target.endDate = headEnd;
    working.push(tailBlock);
    return { blocks: working, applied: true };
  }

  return { blocks: working, applied: false };
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

  // ── Step 1: Transfer-first ──
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

  const transferList = proposedTransfer ? [proposedTransfer] : [];

  // ── Step 2: Check shortage after transfer only ──
  const { shortage: shortageAfterTransfer, result: afterTransferResult } = getShortage(parents, blocks, transferList, constants);

  if (shortageAfterTransfer <= 0) {
    const newAvg = calcAvgMonthly(afterTransferResult.parentsResult);
    const perParentWeeks = Object.fromEntries(parents.map(p => [p.id, 0]));
    return {
      newBlocks: blocks.map(b => ({ ...b })),
      proposedTransfer,
      missingDaysTotal,
      transferDays,
      missingAfterTransferOnly: 0,
      weeksTotal: 0,
      perParentWeeks,
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
      debug: {
        shortageBefore: missingDaysTotal,
        shortageAfterTransfer: 0,
        shortageAfter: 0,
        maxTransfer,
        sumPerParentWeeks: 0,
        stepsApplied: 0,
        noOpSkips: 0,
        unfulfilledAfterFull: 0,
        mode,
        weights: null,
      },
      debugBefore,
      debugAfter: blocks.map(b => ({ ...b })),
    };
  }

  // ── Step 3: Discover weeksTotal via iterative engine verification ──
  // This uses a scratch copy of blocks — the result blocks are discarded.
  const { weeksTotal, noOpSkips } = discoverWeeksTotal(
    blocks, parents, transferList, constants, shortageAfterTransfer,
  );

  // Compute weights for proportional mode
  const weights = parents.length >= 2 ? {
    p1Id: parents[0].id,
    p1Weight: calcParentLoad(blocks, parents[0].id),
    p2Id: parents[1].id,
    p2Weight: calcParentLoad(blocks, parents[1].id),
  } : null;

  // ── Step 4: Allocate weeks per parent using mode ──
  const perParentWeeks = allocateReductionWeeks(weeksTotal, mode, parents, blocks);

  // ── Step 5: Build deterministic reductions from original blocks ──
  // For each parent, get their reduction ranges (latest weeks first),
  // then apply all reductions to a fresh copy of blocks.
  const allReductions: ReductionRange[] = [];
  for (const p of parents) {
    const w = perParentWeeks[p.id] ?? 0;
    if (w <= 0) continue;
    const ranges = getReductionRangesForParent(blocks, p.id, w);
    allReductions.push(...ranges);
  }

  let deterministicBlocks = applyDeterministicReductions(blocks, allReductions);
  const finalBlocks = mergeAdjacentBlocks(deterministicBlocks);

  // ── Step 6: Verify with engine ──
  const { shortage: finalShortage, result: finalResult } = getShortage(parents, finalBlocks, transferList, constants);
  const success = finalShortage <= 0;

  if (finalShortage > 0) {
    console.warn(`[rescue] Deterministic rebuild: engine still shows shortage=${finalShortage} after ${weeksTotal} weeks. Mode=${mode}`);
  }

  const newAvg = calcAvgMonthly(finalResult.parentsResult);

  // ── Build UI text ──
  const actionsText: string[] = [];
  if (transferDays > 0) actionsText.push(`Omfördela ${transferDays} dagar mellan er`);
  if (weeksTotal > 0) actionsText.push(`Minska uttaget med 1 dag/vecka i ${weeksTotal} veckor`);

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

  return {
    newBlocks: finalBlocks,
    proposedTransfer,
    missingDaysTotal,
    transferDays,
    missingAfterTransferOnly: shortageAfterTransfer,
    weeksTotal,
    perParentWeeks,
    reductions: allReductions,
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
      sumPerParentWeeks: Object.values(perParentWeeks).reduce((s, v) => s + v, 0),
      stepsApplied: weeksTotal,
      noOpSkips,
      unfulfilledAfterFull: finalShortage,
      mode,
      weights,
    },
    debugBefore,
    debugAfter: finalBlocks,
  };
}
