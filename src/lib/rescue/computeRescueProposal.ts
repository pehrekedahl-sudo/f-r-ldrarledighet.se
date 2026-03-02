/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — ENGINE-DRIVEN ITERATIVE SOLVER          │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. All shortage numbers are derived from          │
 * │ simulatePlan (engine truth), never from arithmetic assumptions. │
 * │                                                                  │
 * │ Algorithm: transfer-first → iteratively apply minimal -1 dpw    │
 * │ reductions one week at a time, verifying with simulatePlan      │
 * │ after each step. Stops when unfulfilledDaysTotal == 0.          │
 * │ No assumption that "1 week always saves 1 day".                 │
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
    stepsApplied: number;
    noOpSkips: number;
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

/**
 * Find the latest eligible week segment for a given parent and apply -1 dpw.
 * Returns { blocks, applied } where applied=true if a reduction was made.
 *
 * Scans from END of timeline backwards to find a 7-day-aligned segment
 * where the parent has a block with dpw >= 1. Splits the block if needed
 * to isolate exactly one 7-day week, then reduces dpw by 1.
 */
function applyOneWeekReduction(
  blocks: Block[],
  parentId: string,
): { blocks: Block[]; applied: boolean } {
  const working = blocks.map(b => ({ ...b }));

  // Get all blocks for this parent with dpw >= 1, sorted by endDate descending (latest first)
  const candidates = working
    .filter(b => b.parentId === parentId && b.daysPerWeek >= 1)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  for (const target of candidates) {
    const calDays_ = calendarDays(target.startDate, target.endDate);
    if (calDays_ < 7) continue; // need at least 7 days for a full week

    const blockWeeks = Math.floor(calDays_ / 7);
    if (blockWeeks <= 0) continue;

    const reducedDpw = target.daysPerWeek - 1;

    if (blockWeeks === 1) {
      // Entire block IS one week — reduce in place
      target.daysPerWeek = reducedDpw;
      if (target.lowestDaysPerWeek !== undefined && target.lowestDaysPerWeek > reducedDpw) {
        target.lowestDaysPerWeek = reducedDpw;
      }
      return { blocks: working, applied: true };
    }

    // Multiple weeks: split off the LAST 7 days as a separate block with dpw-1
    const tailStart = addDaysISO(target.endDate, -6); // 7 days: tailStart..target.endDate
    const headEnd = addDaysISO(tailStart, -1);

    const tailBlock: Block = {
      id: generateBlockId("rescue"),
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

/**
 * Choose which parent should receive the next reduction step based on mode.
 */
function chooseTargetParent(
  mode: DistributionMode,
  parents: Parent[],
  blocks: Block[],
  perParentWeeks: Record<string, number>,
  originalBlocks: Block[],
  stepIndex: number,
): string | null {
  const hasEligible = (pid: string) =>
    blocks.some(b => b.parentId === pid && b.daysPerWeek >= 1 &&
      calendarDays(b.startDate, b.endDate) >= 7);

  // "Endast [parent]" mode
  if (mode !== "proportional" && mode !== "split" && parents.find(p => p.id === mode)) {
    if (hasEligible(mode)) return mode;
    // Spill to other parent
    return parents.find(p => p.id !== mode && hasEligible(p.id))?.id ?? null;
  }

  // 50/50: alternate, preferring the parent with fewer steps so far
  if (mode === "split" && parents.length >= 2) {
    const w0 = perParentWeeks[parents[0].id] ?? 0;
    const w1 = perParentWeeks[parents[1].id] ?? 0;
    // Pick the one with fewer weeks; tie → alternate by stepIndex
    let prefer: string;
    if (w0 < w1) prefer = parents[0].id;
    else if (w1 < w0) prefer = parents[1].id;
    else prefer = parents[stepIndex % 2].id;

    if (hasEligible(prefer)) return prefer;
    return parents.find(p => p.id !== prefer && hasEligible(p.id))?.id ?? null;
  }

  // Proportional: pick parent with lowest ratio of (stepsApplied / originalLoad)
  let bestRatio = Infinity;
  let bestPid: string | null = null;
  for (const p of parents) {
    if (!hasEligible(p.id)) continue;
    const load = calcParentLoad(originalBlocks, p.id);
    const ratio = load > 0 ? (perParentWeeks[p.id] ?? 0) / load : Infinity;
    if (ratio < bestRatio) { bestRatio = ratio; bestPid = p.id; }
  }
  return bestPid;
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
      },
      debugBefore,
      debugAfter: blocks.map(b => ({ ...b })),
    };
  }

  // ── Step 3: Iterative engine-driven reduction ──
  // Apply -1 dpw one week at a time, verify with simulatePlan after each step.
  // Stop when engine confirms unfulfilledDaysTotal == 0.
  const HARD_CAP = 260;
  let currentBlocks = blocks.map(b => ({ ...b }));
  let remaining = shortageAfterTransfer;
  let stepsApplied = 0;
  let noOpSkips = 0;
  const perParentWeeks: Record<string, number> = Object.fromEntries(parents.map(p => [p.id, 0]));

  while (remaining > 0 && stepsApplied + noOpSkips < HARD_CAP) {
    // Choose target parent based on mode
    const targetPid = chooseTargetParent(
      mode, parents, currentBlocks, perParentWeeks, blocks, stepsApplied
    );
    if (!targetPid) {
      console.warn(`[rescue] No eligible parent found after ${stepsApplied} steps, ${noOpSkips} skips. remaining=${remaining}`);
      break;
    }

    // Try applying one week reduction
    const { blocks: candidateBlocks, applied } = applyOneWeekReduction(currentBlocks, targetPid);
    if (!applied) {
      // This parent has no eligible weeks left; will be skipped by chooseTargetParent next iteration
      // But to prevent infinite loop, mark all blocks for this parent as exhausted
      console.warn(`[rescue] applyOneWeekReduction returned false for ${targetPid}`);
      break;
    }

    // Merge and verify with engine
    const merged = mergeAdjacentBlocks(candidateBlocks);
    const { shortage: newRemaining } = getShortage(parents, merged, transferList, constants);
    const effectiveDelta = remaining - newRemaining;

    if (effectiveDelta <= 0) {
      // No-op: this reduction didn't help. Rollback and skip.
      noOpSkips++;
      // Still apply it to avoid infinite loop (the block is modified), but don't count as effective
      // Actually, let's keep the reduction (it changed dpw) to avoid re-picking the same week
      currentBlocks = merged;
      // Don't count in perParentWeeks since it was ineffective
      continue;
    }

    // Effective step
    currentBlocks = merged;
    remaining = newRemaining;
    stepsApplied++;
    perParentWeeks[targetPid] = (perParentWeeks[targetPid] ?? 0) + 1;
  }

  // Final merge and verification
  const finalBlocks = mergeAdjacentBlocks(currentBlocks);
  const { shortage: finalShortage, result: finalResult } = getShortage(parents, finalBlocks, transferList, constants);

  if (finalShortage > 0) {
    console.warn(`[rescue] After ${stepsApplied} effective steps and ${noOpSkips} no-op skips, engine still shows shortage=${finalShortage}.`);
  }

  const weeksTotal = stepsApplied;
  const newAvg = calcAvgMonthly(finalResult.parentsResult);
  const success = finalShortage <= 0;

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
      stepsApplied,
      noOpSkips,
      unfulfilledAfterFull: finalShortage,
    },
    debugBefore,
    debugAfter: finalBlocks,
  };
}
