/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — ENGINE-DRIVEN SOLVER                    │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. All shortage numbers are derived from          │
 * │ simulatePlan (engine truth), never from arithmetic assumptions. │
 * │                                                                  │
 * │ Algorithm: max transfer first → bulk -1 dpw reductions          │
 * │ (one contiguous segment per parent, late-first) verified by     │
 * │ simulatePlan. Each block only ever reduced by exactly 1 from    │
 * │ its original dpw — never dpw=0 in rescue output.               │
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

/** Max reducible weeks for a parent (only blocks with dpw >= 2, so reduced dpw >= 1) */
function maxReducibleWeeks(blocks: Block[], parentId: string): number {
  return blocks
    .filter(b => b.parentId === parentId && b.daysPerWeek >= 2)
    .reduce((s, b) => s + Math.floor(calendarDays(b) / 7), 0);
}

/**
 * Bulk reduction: reduce dpw by exactly 1 for `weeksNeeded` calendar weeks,
 * applied as ONE contiguous segment from the END of the parent's timeline.
 * 
 * Only touches blocks with dpw >= 2 (ensures reduced dpw >= 1, never 0).
 * Creates at most one split per block (head=original, tail=original-1).
 */
function applyBulkReduction(
  blocks: Block[],
  parentId: string,
  weeksNeeded: number,
): Block[] {
  if (weeksNeeded <= 0) return blocks;

  const working = blocks.map(b => ({ ...b }));
  let remaining = weeksNeeded;

  // Get this parent's blocks sorted latest-first, only those with dpw >= 2
  const candidates = working
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.parentId === parentId && b.daysPerWeek >= 2)
    .sort((a, b) => b.b.startDate.localeCompare(a.b.startDate));

  const newBlocks: Block[] = [];

  for (const { b: target } of candidates) {
    if (remaining <= 0) break;

    const calDays_ = calendarDays(target);
    const blockWeeks = Math.floor(calDays_ / 7);
    if (blockWeeks <= 0) continue;

    const reducedDpw = target.daysPerWeek - 1;

    if (blockWeeks <= remaining) {
      // Reduce entire block
      target.daysPerWeek = reducedDpw;
      remaining -= blockWeeks;
    } else {
      // Split: keep head at original dpw, tail at dpw-1
      const tailCalDays = remaining * 7;
      const headCalDays = calDays_ - tailCalDays;

      if (headCalDays <= 0) {
        // Edge case: reduce whole block
        target.daysPerWeek = reducedDpw;
        remaining = 0;
      } else {
        const splitDate = addDaysISO(target.startDate, headCalDays);
        const tailBlock: Block = {
          id: generateBlockId("rescue"),
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: reducedDpw,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        target.endDate = addDaysISO(splitDate, -1);
        newBlocks.push(tailBlock);
        remaining = 0;
      }
    }
  }

  working.push(...newBlocks);
  return working;
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

  if (shortageAfterTransfer <= 0) {
    // Transfer alone solves it — no pace reduction needed
    const { result: finalResult } = getShortage(parents, blocks, transferList, constants);
    const newAvg = calcAvgMonthly(finalResult.parentsResult);
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
        iterationsUsed: 0,
        unfulfilledAfterFull: 0,
      },
      debugBefore,
      debugAfter: blocks.map(b => ({ ...b })),
    };
  }

  // ── Step 3: Distribute weeks across parents ──
  // Start with heuristic: shortageAfterTransfer weeks needed
  let targetWeeks = shortageAfterTransfer;

  // Cap each parent's allocation to their max reducible capacity
  const maxPerParent: Record<string, number> = Object.fromEntries(
    parents.map(p => [p.id, maxReducibleWeeks(blocks, p.id)])
  );
  const totalCapacity = Object.values(maxPerParent).reduce((s, v) => s + v, 0);
  targetWeeks = Math.min(targetWeeks, totalCapacity);

  let perParentWeeks: Record<string, number>;
  if (mode !== "proportional" && mode !== "split" && parents.find(p => p.id === mode)) {
    // Only one parent
    const cap = maxPerParent[mode] ?? 0;
    const assigned = Math.min(targetWeeks, cap);
    perParentWeeks = Object.fromEntries(parents.map(p => [p.id, p.id === mode ? assigned : 0]));
    // Spill remainder to other parent if needed
    const spill = targetWeeks - assigned;
    if (spill > 0) {
      for (const p of parents) {
        if (p.id !== mode) {
          perParentWeeks[p.id] = Math.min(spill, maxPerParent[p.id] ?? 0);
          break;
        }
      }
    }
  } else if (mode === "split" && parents.length >= 2) {
    const half = Math.floor(targetWeeks / 2);
    const w0 = Math.min(half, maxPerParent[parents[0].id] ?? 0);
    const w1 = Math.min(targetWeeks - w0, maxPerParent[parents[1].id] ?? 0);
    perParentWeeks = { [parents[0].id]: w0, [parents[1].id]: w1 };
    // If w0+w1 < targetWeeks, give remainder back to first
    const leftover = targetWeeks - w0 - w1;
    if (leftover > 0) {
      const extra0 = Math.min(leftover, (maxPerParent[parents[0].id] ?? 0) - w0);
      perParentWeeks[parents[0].id] += extra0;
    }
  } else {
    // Proportional
    const weights = parents.map(p => ({ id: p.id, weight: calcParentLoad(blocks, p.id) }));
    perParentWeeks = distributeWeeks(targetWeeks, weights);
    // Cap to capacity and redistribute
    let overflow = 0;
    for (const p of parents) {
      const cap = maxPerParent[p.id] ?? 0;
      if (perParentWeeks[p.id] > cap) {
        overflow += perParentWeeks[p.id] - cap;
        perParentWeeks[p.id] = cap;
      }
    }
    if (overflow > 0) {
      for (const p of parents) {
        const room = (maxPerParent[p.id] ?? 0) - perParentWeeks[p.id];
        const give = Math.min(overflow, room);
        perParentWeeks[p.id] += give;
        overflow -= give;
      }
    }
  }

  // ── Step 4: Apply bulk reductions (one contiguous segment per parent) ──
  let workingBlocks = blocks.map(b => ({ ...b }));
  for (const p of parents) {
    const w = perParentWeeks[p.id] ?? 0;
    if (w > 0) {
      workingBlocks = applyBulkReduction(workingBlocks, p.id, w);
    }
  }

  let finalBlocks = mergeAdjacentBlocks(workingBlocks);

  // ── Step 5: Engine verification + iterative correction ──
  let { shortage: finalShortage, result: finalResult } = getShortage(parents, finalBlocks, transferList, constants);
  let iterations = 0;
  const MAX_EXTRA_ITERATIONS = 30;

  // If still short, add more weeks one at a time (verified by engine)
  while (finalShortage > 0 && iterations < MAX_EXTRA_ITERATIONS) {
    // Find a parent that can still reduce
    let added = false;
    for (const p of parents) {
      const currentCap = maxReducibleWeeks(finalBlocks, p.id);
      if (currentCap > 0) {
        finalBlocks = applyBulkReduction(finalBlocks, p.id, 1);
        finalBlocks = mergeAdjacentBlocks(finalBlocks);
        perParentWeeks[p.id] = (perParentWeeks[p.id] ?? 0) + 1;
        added = true;
        break;
      }
    }
    if (!added) break;

    iterations++;
    const check = getShortage(parents, finalBlocks, transferList, constants);
    finalShortage = check.shortage;
    finalResult = check.result;
  }

  // Sanity: warn if any rescue block has unexpected dpw
  for (const b of finalBlocks) {
    const orig = blocks.find(ob => ob.parentId === b.parentId);
    if (orig && b.daysPerWeek < orig.daysPerWeek - 1 && b.daysPerWeek > 0) {
      console.warn(`[rescue] Block ${b.id} has dpw=${b.daysPerWeek}, expected ${orig.daysPerWeek} or ${orig.daysPerWeek - 1}`);
    }
  }

  const weeksTotal = Object.values(perParentWeeks).reduce((s, v) => s + v, 0);
  const newAvg = calcAvgMonthly(finalResult.parentsResult);
  const success = finalShortage <= 0;

  // ── Step 6: Build UI text from ACTUAL applied steps ──
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
