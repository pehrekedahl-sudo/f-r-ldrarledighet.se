/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — ENGINE-DRIVEN DETERMINISTIC SOLVER      │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. All shortage numbers are derived from          │
 * │ simulatePlan (engine truth), never from arithmetic assumptions. │
 * │                                                                  │
 * │ Algorithm:                                                       │
 * │ 1. shortageBefore = simulatePlan(currentPlan)                   │
 * │ 2. Apply transfer → shortageAfterTransfer = simulatePlan(...)   │
 * │ 3. weeksTotal = shortageAfterTransfer                           │
 * │ 4. Allocate perParentWeeks by mode                              │
 * │ 5. Apply reductions, verify with engine                         │
 * │ 6. Correction loop: if still unfulfilled, add weeks to the      │
 * │    parent where reductions actually help (engine-tested)        │
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
    correctionSteps: number;
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

// ── Deterministic reduction helpers ──

function getReductionRangesForParent(
  blocks: Block[],
  parentId: string,
  weeksNeeded: number,
): ReductionRange[] {
  if (weeksNeeded <= 0) return [];

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
      if (b.parentId !== range.parentId) {
        next.push(b);
        continue;
      }

      if (b.endDate < range.startDate || b.startDate > range.endDate) {
        next.push(b);
        continue;
      }

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
          ? Math.min(b.lowestDaysPerWeek, newDpw)
          : undefined,
      });

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

/** Build all reduction ranges from perParentWeeks allocation */
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

/** Apply reductions to blocks and merge, returning final blocks */
function buildProposalBlocks(
  blocks: Block[],
  reductions: ReductionRange[],
): Block[] {
  const reduced = applyDeterministicReductions(blocks, reductions);
  return mergeAdjacentBlocks(reduced);
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

  // ══════════════════════════════════════════════════════════════
  // Step A: Engine truth — current plan shortage
  // ══════════════════════════════════════════════════════════════
  const baseTransfers = existingTransfer && existingTransfer.sicknessDays > 0 ? [existingTransfer] : [];
  const { shortage: shortageBefore, result: origResult } = engineShortage(parents, blocks, baseTransfers, constants);
  if (shortageBefore <= 0) return null;

  const origAvg = calcAvgMonthly(origResult.parentsResult);
  const debugBefore = blocks.map(b => ({ ...b }));

  // ══════════════════════════════════════════════════════════════
  // Step B: Transfer-first — compute optimal transfer
  // ══════════════════════════════════════════════════════════════
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
    proposedTransfer = {
      fromParentId: giver.id,
      toParentId: needy.id,
      sicknessDays: transferDays,
    };
  }

  // The transfer list that simulatePlan will consume — REPLACES any existing transfer
  const transferList: Transfer[] = proposedTransfer ? [proposedTransfer] : [];
  const transferConfigStr = JSON.stringify(transferList);
  console.log(`[rescue] Step B: transferDays=${transferDays}, maxTransfer=${maxTransfer}, transferConfig=${transferConfigStr}`);

  // ══════════════════════════════════════════════════════════════
  // Step C: Engine truth — shortage after transfer only
  // ══════════════════════════════════════════════════════════════
  const { shortage: shortageAfterTransfer, result: afterTransferResult } = engineShortage(
    parents, blocks, transferList, constants,
  );
  console.log(`[rescue] Step C: shortageAfterTransfer=${shortageAfterTransfer} (engine-derived)`);

  // Transfer-only success
  if (shortageAfterTransfer <= 0) {
    const newAvg = calcAvgMonthly(afterTransferResult.parentsResult);
    const perParentWeeks = Object.fromEntries(parents.map(p => [p.id, 0]));
    return {
      newBlocks: blocks.map(b => ({ ...b })),
      proposedTransfer,
      missingDaysTotal: shortageBefore,
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
        shortageBefore,
        shortageAfterTransfer: 0,
        shortageAfter: 0,
        maxTransfer,
        sumPerParentWeeks: 0,
        stepsApplied: 0,
        noOpSkips: 0,
        unfulfilledAfterFull: 0,
        mode,
        weights: null,
        correctionSteps: 0,
        transferConfig: transferConfigStr,
      },
      debugBefore,
      debugAfter: blocks.map(b => ({ ...b })),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Step D: weeksTotal = shortageAfterTransfer (engine-derived)
  //         Each -1 dpw week removes exactly 1 day of demand.
  // ══════════════════════════════════════════════════════════════
  let weeksTotal = shortageAfterTransfer;

  // Compute weights for proportional mode
  const weights = parents.length >= 2 ? {
    p1Id: parents[0].id,
    p1Weight: calcParentLoad(blocks, parents[0].id),
    p2Id: parents[1].id,
    p2Weight: calcParentLoad(blocks, parents[1].id),
  } : null;

  // ══════════════════════════════════════════════════════════════
  // Step E: Allocate weeks per parent using mode
  // ══════════════════════════════════════════════════════════════
  let perParentWeeks = allocateReductionWeeks(weeksTotal, mode, parents, blocks);

  // ══════════════════════════════════════════════════════════════
  // Step F: Build reductions, apply, and verify with engine
  // ══════════════════════════════════════════════════════════════
  let allReductions = buildReductionsFromAllocation(blocks, parents, perParentWeeks);
  let proposalBlocks = buildProposalBlocks(blocks, allReductions);
  let { shortage: unfulfilledAfterFull, result: finalResult } = engineShortage(
    parents, proposalBlocks, transferList, constants,
  );

  console.log(`[rescue] Step F: initial verify unfulfilledAfterFull=${unfulfilledAfterFull}`);

  // ══════════════════════════════════════════════════════════════
  // Step G: Correction loop — if mode-based allocation doesn't
  //         fully solve (e.g., proportional puts weeks on a parent
  //         that has no shortage), add weeks to whichever parent
  //         the engine says benefits most.
  // ══════════════════════════════════════════════════════════════
  const MAX_CORRECTIONS = 30;
  let correctionSteps = 0;

  while (unfulfilledAfterFull > 0 && correctionSteps < MAX_CORRECTIONS) {
    // Try adding 1 week to each parent, pick the one that helps most
    let bestPid: string | null = null;
    let bestShortage = unfulfilledAfterFull;

    for (const p of parents) {
      // Check if parent has eligible blocks with dpw >= 1 and >= 7 calendar days
      const hasCapacity = blocks.some(
        b => b.parentId === p.id && b.daysPerWeek >= 1 && calendarDays(b.startDate, b.endDate) >= 7,
      );
      if (!hasCapacity) continue;

      // Check if we haven't already used all available weeks for this parent
      const availableWeeks = blocks
        .filter(b => b.parentId === p.id && b.daysPerWeek >= 1)
        .reduce((s, b) => s + Math.floor(calendarDays(b.startDate, b.endDate) / 7), 0);
      if ((perParentWeeks[p.id] ?? 0) >= availableWeeks) continue;

      const testWeeks = { ...perParentWeeks, [p.id]: (perParentWeeks[p.id] ?? 0) + 1 };
      const testReductions = buildReductionsFromAllocation(blocks, parents, testWeeks);
      const testBlocks = buildProposalBlocks(blocks, testReductions);
      const { shortage: testShortage } = engineShortage(parents, testBlocks, transferList, constants);

      if (testShortage < bestShortage) {
        bestShortage = testShortage;
        bestPid = p.id;
      }
    }

    if (!bestPid) {
      console.warn(`[rescue] Correction loop: no parent improves shortage. Stopping.`);
      break;
    }

    perParentWeeks[bestPid] = (perParentWeeks[bestPid] ?? 0) + 1;
    weeksTotal++;
    correctionSteps++;

    allReductions = buildReductionsFromAllocation(blocks, parents, perParentWeeks);
    proposalBlocks = buildProposalBlocks(blocks, allReductions);
    const verifyResult = engineShortage(parents, proposalBlocks, transferList, constants);
    unfulfilledAfterFull = verifyResult.shortage;
    finalResult = verifyResult.result;

    console.log(`[rescue] Correction #${correctionSteps}: added 1w to ${bestPid}, unfulfilled=${unfulfilledAfterFull}`);
  }

  const success = unfulfilledAfterFull <= 0;

  if (!success) {
    console.warn(`[rescue] Final: engine still shows shortage=${unfulfilledAfterFull} after ${weeksTotal} weeks + ${correctionSteps} corrections. Mode=${mode}`);
  }

  const newAvg = calcAvgMonthly(finalResult.parentsResult);

  // ══════════════════════════════════════════════════════════════
  // Build UI text
  // ══════════════════════════════════════════════════════════════
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
    newBlocks: proposalBlocks,
    proposedTransfer,
    missingDaysTotal: shortageBefore,
    transferDays,
    missingAfterTransferOnly: shortageAfterTransfer,
    weeksTotal,
    perParentWeeks,
    reductions: allReductions,
    actionsText,
    detailText,
    deltaMonthly: Math.round(newAvg - origAvg),
    success,
    transferOnly: false,
    debug: {
      shortageBefore,
      shortageAfterTransfer,
      shortageAfter: unfulfilledAfterFull,
      maxTransfer,
      sumPerParentWeeks: Object.values(perParentWeeks).reduce((s, v) => s + v, 0),
      stepsApplied: weeksTotal,
      noOpSkips: 0,
      unfulfilledAfterFull,
      mode,
      weights,
      correctionSteps,
      transferConfig: transferConfigStr,
    },
    debugBefore,
    debugAfter: proposalBlocks,
  };
}
