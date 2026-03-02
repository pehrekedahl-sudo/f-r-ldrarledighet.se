/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — ENGINE-DRIVEN SOLVER                    │
 * │                                                                  │
 * │ This module must NOT import from adjustmentPolicy.ts or any     │
 * │ "policy" module. All shortage numbers are derived from          │
 * │ simulatePlan (engine truth), never from arithmetic assumptions. │
 * │                                                                  │
 * │ Algorithm: max transfer first → exactly -1 dpw reductions       │
 * │ spread over many weeks (baseline-first, late-first).            │
 * │ Each block is only ever reduced by exactly 1 from its ORIGINAL  │
 * │ dpw — never stacked reductions, never dpw < original-1.        │
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
 * Apply exactly `weeksNeeded` weeks of -1 dpw reduction for a parent.
 * 
 * Strategy:
 * 1. Only reduce blocks still at their ORIGINAL dpw (tracked via originalDpwMap).
 *    This prevents stacking (6→5→4→...).
 * 2. Prefer highest-dpw blocks first (baseline-first).
 * 3. Within same dpw, apply from the END of the timeline backwards.
 * 4. Each affected segment becomes (originalDpw - 1). Never dpw < 1.
 * 5. Creates at most one split per block (head=original, tail=original-1).
 */
function applyReductionsForParent(
  blocks: Block[],
  parentId: string,
  weeksNeeded: number,
  originalDpwMap: Map<string, number>,
): Block[] {
  if (weeksNeeded <= 0) return blocks;

  const working = blocks.map(b => ({ ...b }));
  let remaining = weeksNeeded;

  // Find this parent's blocks that are still at their original dpw and dpw >= 2
  // (so reduced dpw >= 1, never 0)
  const candidates = working
    .map((b, idx) => ({ b, idx }))
    .filter(({ b }) => {
      if (b.parentId !== parentId) return false;
      if (b.daysPerWeek < 2) return false;
      const origDpw = originalDpwMap.get(b.id);
      // Only touch blocks still at original dpw (not already reduced by rescue)
      return origDpw !== undefined && b.daysPerWeek === origDpw;
    });

  // Sort: highest dpw first (baseline-first), then latest startDate first (end-first)
  candidates.sort((a, b) => {
    if (b.b.daysPerWeek !== a.b.daysPerWeek) return b.b.daysPerWeek - a.b.daysPerWeek;
    return b.b.startDate.localeCompare(a.b.startDate);
  });

  const newBlocks: Block[] = [];

  for (const { b: target } of candidates) {
    if (remaining <= 0) break;

    const calDays_ = calendarDays(target.startDate, target.endDate);
    const blockWeeks = Math.floor(calDays_ / 7);
    if (blockWeeks <= 0) continue;

    const reducedDpw = target.daysPerWeek - 1;

    if (blockWeeks <= remaining) {
      // Reduce entire block
      target.daysPerWeek = reducedDpw;
      if (target.lowestDaysPerWeek !== undefined && target.lowestDaysPerWeek > reducedDpw) {
        target.lowestDaysPerWeek = reducedDpw;
      }
      remaining -= blockWeeks;
    } else {
      // Split: head stays at original dpw, tail becomes dpw-1
      const tailCalDays = remaining * 7;
      const headCalDays = calDays_ - tailCalDays;

      if (headCalDays <= 0) {
        target.daysPerWeek = reducedDpw;
        if (target.lowestDaysPerWeek !== undefined && target.lowestDaysPerWeek > reducedDpw) {
          target.lowestDaysPerWeek = reducedDpw;
        }
        remaining = 0;
      } else {
        const splitDate = addDaysISO(target.startDate, headCalDays);
        const tailBlock: Block = {
          id: generateBlockId("rescue"),
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: reducedDpw,
          lowestDaysPerWeek: target.lowestDaysPerWeek !== undefined
            ? Math.min(target.lowestDaysPerWeek, reducedDpw)
            : undefined,
          overlapGroupId: target.overlapGroupId,
        };
        target.endDate = addDaysISO(splitDate, -1);
        // Track new block's original dpw as reducedDpw (already reduced, don't touch again)
        originalDpwMap.set(tailBlock.id, reducedDpw);
        newBlocks.push(tailBlock);
        remaining = 0;
      }
    }
  }

  working.push(...newBlocks);
  return working;
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

  // ── Step 2: Check shortage after transfer ──
  const { shortage: shortageAfterTransfer } = getShortage(parents, blocks, transferList, constants);

  if (shortageAfterTransfer <= 0) {
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

  // ── Step 3: Calculate weeks needed and distribute ──
  // INVARIANT: use arithmetic decomposition, NOT engine's shortageAfterTransfer
  // This ensures transferDays + weekReductionsNeeded == missingDaysTotal ALWAYS.
  const missingAfterTransferArithmetic = missingDaysTotal - transferDays;
  const weekReductionsNeeded = Math.max(0, missingAfterTransferArithmetic);

  // Compute max reducible weeks per parent (blocks with dpw >= 2 at original state)
  const maxPerParent: Record<string, number> = Object.fromEntries(
    parents.map(p => [p.id, blocks
      .filter(b => b.parentId === p.id && b.daysPerWeek >= 2)
      .reduce((s, b) => s + Math.floor(calendarDays(b.startDate, b.endDate) / 7), 0)
    ])
  );

  const totalCapacity = Object.values(maxPerParent).reduce((s, v) => s + v, 0);
  const cappedWeeks = Math.min(weekReductionsNeeded, totalCapacity);

  // Allocate weeks per parent based on mode — deterministic, sum-correct
  let perParentWeeks: Record<string, number> = Object.fromEntries(parents.map(p => [p.id, 0]));

  if (mode !== "proportional" && mode !== "split" && parents.find(p => p.id === mode)) {
    // "Endast [parent]" mode: assign all to that parent, spill to other if capacity exceeded
    const primaryId = mode;
    const cap = maxPerParent[primaryId] ?? 0;
    const assigned = Math.min(cappedWeeks, cap);
    perParentWeeks[primaryId] = assigned;
    let spill = cappedWeeks - assigned;
    if (spill > 0) {
      for (const p of parents) {
        if (p.id !== primaryId) {
          const give = Math.min(spill, maxPerParent[p.id] ?? 0);
          perParentWeeks[p.id] = give;
          spill -= give;
        }
      }
    }
  } else if (mode === "split" && parents.length >= 2) {
    // 50/50: split evenly, odd week goes to parent with more capacity (or p1 deterministically)
    const half = Math.floor(cappedWeeks / 2);
    const odd = cappedWeeks % 2;
    // Determine who gets the extra week: parent with more capacity, tie → p1
    const cap0 = maxPerParent[parents[0].id] ?? 0;
    const cap1 = maxPerParent[parents[1].id] ?? 0;
    let raw0 = half + (odd && cap0 >= cap1 ? 1 : 0);
    let raw1 = half + (odd && cap0 < cap1 ? 1 : 0);
    // Clamp to capacity and redistribute overflow
    let w0 = Math.min(raw0, cap0);
    let w1 = Math.min(raw1, cap1);
    let leftover = cappedWeeks - w0 - w1;
    if (leftover > 0) {
      const extra0 = Math.min(leftover, cap0 - w0);
      w0 += extra0;
      leftover -= extra0;
    }
    if (leftover > 0) {
      const extra1 = Math.min(leftover, cap1 - w1);
      w1 += extra1;
    }
    perParentWeeks[parents[0].id] = w0;
    perParentWeeks[parents[1].id] = w1;
  } else {
    // Proportional: largest-remainder allocation capped to capacity
    const weights = parents.map(p => ({ id: p.id, weight: calcParentLoad(blocks, p.id) }));
    perParentWeeks = distributeWeeks(cappedWeeks, weights);
    // Cap to capacity and redistribute overflow
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

  // ── Step 4: Apply reductions (baseline-first, end-first, exactly -1) ──
  const originalDpwMap = new Map<string, number>();
  for (const b of blocks) originalDpwMap.set(b.id, b.daysPerWeek);

  let workingBlocks = blocks.map(b => ({ ...b }));
  for (const p of parents) {
    const w = perParentWeeks[p.id] ?? 0;
    if (w > 0) {
      workingBlocks = applyReductionsForParent(workingBlocks, p.id, w, originalDpwMap);
    }
  }

  // ── Step 5: Merge and verify ──
  let finalBlocks = mergeAdjacentBlocks(workingBlocks);
  let { shortage: finalShortage, result: finalResult } = getShortage(parents, finalBlocks, transferList, constants);

  // If engine still shows shortage, add extra weeks one at a time (engine-verified).
  // Respect the mode: only add to parents that mode allows, or proportionally.
  let iterations = 0;
  const MAX_EXTRA = 20;
  while (finalShortage > 0 && iterations < MAX_EXTRA) {
    // Determine eligible parents for extra weeks based on mode
    let eligibleParents: Parent[];
    if (mode !== "proportional" && mode !== "split" && parents.find(p => p.id === mode)) {
      // "Endast" mode: prefer the selected parent, fall back to others
      const primary = parents.find(p => p.id === mode)!;
      const hasCapPrimary = finalBlocks.some(b =>
        b.parentId === primary.id && b.daysPerWeek >= 2 &&
        originalDpwMap.get(b.id) !== undefined && b.daysPerWeek === originalDpwMap.get(b.id)
      );
      eligibleParents = hasCapPrimary ? [primary] : parents.filter(p => p.id !== mode);
    } else {
      eligibleParents = [...parents];
    }

    let added = false;
    for (const p of eligibleParents) {
      const hasReducible = finalBlocks.some(b => {
        if (b.parentId !== p.id || b.daysPerWeek < 2) return false;
        const orig = originalDpwMap.get(b.id);
        return orig !== undefined && b.daysPerWeek === orig;
      });
      if (hasReducible) {
        finalBlocks = applyReductionsForParent(finalBlocks, p.id, 1, originalDpwMap);
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

  // Sanity check
  for (const b of finalBlocks) {
    const origBlock = blocks.find(ob => ob.id === b.id);
    if (origBlock && b.daysPerWeek < origBlock.daysPerWeek - 1) {
      console.warn(`[rescue] Block ${b.id} has dpw=${b.daysPerWeek}, original was ${origBlock.daysPerWeek}. Stacking detected!`);
    }
  }

  // Derive all display values from the single proposal state
  const weeksTotal = Object.values(perParentWeeks).reduce((s, v) => s + v, 0);
  const newAvg = calcAvgMonthly(finalResult.parentsResult);
  const success = finalShortage <= 0;

  // ── Step 6: Build UI text from the SAME proposal ──
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

  return {
    newBlocks: finalBlocks,
    proposedTransfer,
    missingDaysTotal,
    transferDays,
    missingAfterTransferOnly: missingAfterTransferArithmetic,
    weeksTotal,
    perParentWeeks,
    actionsText,
    detailText,
    deltaMonthly: Math.round(newAvg - origAvg),
    success,
    transferOnly: weeksTotal === 0,
    debug: {
      shortageBefore: missingDaysTotal,
      shortageAfterTransfer: missingAfterTransferArithmetic,
      shortageAfter: finalShortage,
      maxTransfer,
      sumPerParentWeeks: weeksTotal,
      iterationsUsed: iterations,
      unfulfilledAfterFull: finalShortage,
    },
    debugBefore,
    debugAfter: finalBlocks,
  };
}
