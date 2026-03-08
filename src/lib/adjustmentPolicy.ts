import { generateBlockId } from "./blockIdUtils";
import { addDays, diffDaysInclusive, compareDates } from "../utils/dateOnly";

// ── Shared Block type ──

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

// ── Constants ──

export const MIN_AUTO_DPW = 3;

// ── Helpers ──

function calendarDays(b: Block): number {
  return diffDaysInclusive(b.startDate, b.endDate);
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

// ── A) normalizeBlocks ──

/**
 * Normalize blocks into a clean, deterministic, minimal representation.
 * 1) Remove invalid ranges (start > end)
 * 2) Clamp dpw/lowest to valid integer ranges
 * 3) Sort by (parentId, startDate)
 * 4) Merge adjacent blocks with identical settings (same parent, dpw, lowest)
 * 5) Absorb micro-blocks (<14 calendar days) into nearest same-parent neighbor
 * 6) Final merge pass
 */
export function normalizeBlocks(blocks: Block[]): Block[] {
  // Step 1: deep copy + remove invalid ranges
  let working = blocks
    .map(b => ({ ...b }))
    .filter(b => b.startDate && b.endDate && compareDates(b.endDate, b.startDate) >= 0);

  // Step 2: clamp values
  for (const b of working) {
    b.daysPerWeek = clampInt(b.daysPerWeek, 0, 7);
    if (b.lowestDaysPerWeek !== undefined) {
      b.lowestDaysPerWeek = clampInt(b.lowestDaysPerWeek, 0, b.daysPerWeek);
    }
  }

  // Step 3: deterministic sort
  working.sort((a, b) => a.parentId.localeCompare(b.parentId) || compareDates(a.startDate, b.startDate));

  // Step 4: merge adjacent identical
  working = mergePass(working);

  // Step 5: absorb micro-blocks
  working = absorbMicroBlocks(working);

  // Step 6: final merge
  working = mergePass(working);

  // Deterministic sort for output
  working.sort((a, b) => a.parentId.localeCompare(b.parentId) || compareDates(a.startDate, b.startDate));

  return working;
}

function mergePass(blocks: Block[]): Block[] {
  const byParent = new Map<string, Block[]>();
  const parentOrder: string[] = [];
  for (const b of blocks) {
    if (!byParent.has(b.parentId)) {
      byParent.set(b.parentId, []);
      parentOrder.push(b.parentId);
    }
    byParent.get(b.parentId)!.push(b);
  }

  const result: Block[] = [];
  for (const pid of parentOrder) {
    const sorted = byParent.get(pid)!.sort((a, b) => compareDates(a.startDate, b.startDate));
    let i = 0;
    while (i < sorted.length) {
      const current = { ...sorted[i] };
      let j = i + 1;
      while (j < sorted.length) {
        const next = sorted[j];
        const dayAfter = addDays(current.endDate, 1);
        const sameSettings =
          current.daysPerWeek === next.daysPerWeek &&
          (current.lowestDaysPerWeek ?? 0) === (next.lowestDaysPerWeek ?? 0);
        if (dayAfter === next.startDate && sameSettings) {
          current.endDate = next.endDate;
          j++;
        } else {
          break;
        }
      }
      result.push(current);
      i = j;
    }
  }
  return result;
}

function absorbMicroBlocks(blocks: Block[]): Block[] {
  const byParent = new Map<string, Block[]>();
  for (const b of blocks) {
    if (!byParent.has(b.parentId)) byParent.set(b.parentId, []);
    byParent.get(b.parentId)!.push(b);
  }

  const result: Block[] = [];
  for (const [, pBlocks] of byParent) {
    const sorted = pBlocks.sort((a, b) => compareDates(a.startDate, b.startDate));
    if (sorted.length <= 1) {
      result.push(...sorted);
      continue;
    }

    let merged = [...sorted];
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 10) {
      changed = false;
      iterations++;
      const next: Block[] = [];
      for (let i = 0; i < merged.length; i++) {
        const b = merged[i];
        if (calendarDays(b) < 14 && merged.length > 1 && !b.isOverlap) {
          const prev = i > 0 ? next[next.length - 1] : null;
          const nextB = i < merged.length - 1 ? merged[i + 1] : null;
          if (prev && (!nextB || Math.abs(prev.daysPerWeek - b.daysPerWeek) <= Math.abs(nextB.daysPerWeek - b.daysPerWeek))) {
            prev.endDate = b.endDate;
            changed = true;
          } else if (nextB) {
            nextB.startDate = b.startDate;
            changed = true;
          } else {
            next.push(b);
          }
        } else {
          next.push(b);
        }
      }
      merged = next;
    }
    result.push(...merged);
  }
  return result;
}

// ── B) proposeEvenSpreadReduction ──

export type ReductionSummary = {
  weeksAffectedTotal: number;
  reductionPerWeek: number;
  startDateOfReduction: string | null;
  endDateOfReduction: string | null;
  perParent: { parentId: string; weeksAffected: number; oldDpw: number; newDpw: number }[];
};

export type ReductionResult = {
  nextBlocks: Block[];
  summary: ReductionSummary;
};

/**
 * Reduce withdrawal by `daysToReduce` days by spreading −1 dpw over weeks,
 * starting from the LATEST part of the plan and working backwards.
 * Never reduces below MIN_AUTO_DPW.
 * Uses week-sized chunks to avoid micro-blocks.
 */
export function proposeEvenSpreadReduction(opts: {
  plan: Block[];
  parentScope: string[] | "all";
  daysToReduce: number;
}): ReductionResult {
  const { plan, parentScope, daysToReduce } = opts;
  const working = plan.map(b => ({ ...b }));
  const allowedParents = parentScope === "all"
    ? new Set(working.map(b => b.parentId))
    : new Set(parentScope);

  let remaining = daysToReduce;
  const perParentMap = new Map<string, { weeksAffected: number; oldDpw: number; newDpw: number }>();
  let earliestReduction: string | null = null;
  let latestReduction: string | null = null;

  // Keep reducing until done or no more capacity
  let safetyLimit = 20;
  while (remaining > 0 && safetyLimit-- > 0) {
    // Find the highest dpw level among eligible blocks
    const eligible = working.filter(
      b => allowedParents.has(b.parentId) && b.daysPerWeek >= MIN_AUTO_DPW + 1 && !b.isOverlap
    );
    if (eligible.length === 0) break;

    const maxDpw = Math.max(...eligible.map(b => b.daysPerWeek));

    // Only consider blocks at this highest dpw level
    const atMaxLevel = eligible
      .filter(b => b.daysPerWeek === maxDpw)
      .sort((a, b) => compareDates(b.startDate, a.startDate)); // latest first

    // Total weeks available at this level
    const totalWeeksAtLevel = atMaxLevel.reduce(
      (s, b) => s + Math.floor(calendarDays(b) / 7), 0
    );

    if (totalWeeksAtLevel === 0) break;

    // How many weeks to take from this level in this pass
    const weeksToTake = Math.min(remaining, totalWeeksAtLevel);

    // Distribute weeksToTake evenly across blocks at this level (latest first)
    let stillToTake = weeksToTake;
    for (const target of atMaxLevel) {
      if (stillToTake <= 0) break;
      const blockWeeks = Math.floor(calendarDays(target) / 7);
      if (blockWeeks <= 0) continue;

      const takeFromThis = Math.min(stillToTake, blockWeeks);
      const newDpw = target.daysPerWeek - 1;

      // Update perParentMap
      const entry = perParentMap.get(target.parentId);
      if (!entry) {
        perParentMap.set(target.parentId, { weeksAffected: takeFromThis, oldDpw: target.daysPerWeek, newDpw });
      } else {
        entry.weeksAffected += takeFromThis;
      }

      if (takeFromThis >= blockWeeks) {
        // Take the whole block
        target.daysPerWeek = newDpw;
        if (!earliestReduction || compareDates(target.startDate, earliestReduction) < 0)
          earliestReduction = target.startDate;
        if (!latestReduction || compareDates(target.endDate, latestReduction) > 0)
          latestReduction = target.endDate;
      } else {
        // Split: keep a head at original dpw, reduce the tail
        const headDays = (blockWeeks - takeFromThis) * 7;
        const splitDate = addDays(target.startDate, headDays);
        const tailBlock: Block = {
          id: generateBlockId("policy-red"),
          parentId: target.parentId,
          startDate: splitDate,
          endDate: target.endDate,
          daysPerWeek: newDpw,
          lowestDaysPerWeek: target.lowestDaysPerWeek,
          overlapGroupId: target.overlapGroupId,
        };
        target.endDate = addDays(splitDate, -1);
        working.push(tailBlock);
        if (!earliestReduction || compareDates(splitDate, earliestReduction) < 0)
          earliestReduction = splitDate;
        if (!latestReduction || compareDates(tailBlock.endDate, latestReduction) > 0)
          latestReduction = tailBlock.endDate;
      }

      stillToTake -= takeFromThis;
    }

    remaining -= weeksToTake;
  }

  const perParent = Array.from(perParentMap.entries()).map(([parentId, v]) => ({
    parentId, ...v,
  }));
  const weeksAffectedTotal = perParent.reduce((s, p) => s + p.weeksAffected, 0);
  const nextBlocks = normalizeBlocks(working);

  return {
    nextBlocks,
    summary: {
      weeksAffectedTotal,
      reductionPerWeek: 1,
      startDateOfReduction: earliestReduction,
      endDateOfReduction: latestReduction,
      perParent,
    },
  };
}

// ── B2) proposeProportionalReduction ──

export type ProportionalDebug = {
  loads: { parentId: string; load: number }[];
  shares: { parentId: string; share: number }[];
  requiredWeeksTotal: number;
  allocatedWeeks: { parentId: string; weeks: number }[];
};

export function proposeProportionalReduction(opts: {
  plan: Block[];
  parentIds: string[];
  daysToReduce: number;
}): ReductionResult & { proportionalDebug: ProportionalDebug } {
  const { plan, parentIds, daysToReduce } = opts;

  const loads = new Map<string, number>();
  for (const pid of parentIds) loads.set(pid, 0);
  for (const b of plan) {
    if (!loads.has(b.parentId)) continue;
    const weeks = Math.floor(calendarDays(b) / 7);
    loads.set(b.parentId, loads.get(b.parentId)! + weeks * b.daysPerWeek);
  }

  const totalLoad = Array.from(loads.values()).reduce((s, v) => s + v, 0);

  const shares = new Map<string, number>();
  for (const pid of parentIds) {
    shares.set(pid, totalLoad > 0 ? loads.get(pid)! / totalLoad : 1 / parentIds.length);
  }

  const allocated = new Map<string, number>();
  let assignedTotal = 0;
  const sortedPids = [...parentIds].sort();

  for (let i = 0; i < sortedPids.length; i++) {
    const pid = sortedPids[i];
    if (i === sortedPids.length - 1) {
      allocated.set(pid, Math.max(0, daysToReduce - assignedTotal));
    } else {
      const w = Math.round(daysToReduce * shares.get(pid)!);
      allocated.set(pid, Math.max(0, w));
      assignedTotal += Math.max(0, w);
    }
  }

  for (const pid of sortedPids) {
    const parentBlocks = plan.filter(b => b.parentId === pid);
    const maxCapacity = parentBlocks.reduce((s, b) => {
      const weeks = Math.floor(calendarDays(b) / 7);
      const reducible = Math.max(0, b.daysPerWeek - MIN_AUTO_DPW);
      return s + weeks * reducible;
    }, 0);
    const wanted = allocated.get(pid)!;
    if (wanted > maxCapacity) {
      const overflow = wanted - maxCapacity;
      allocated.set(pid, maxCapacity);
      for (const other of sortedPids) {
        if (other === pid) continue;
        allocated.set(other, allocated.get(other)! + overflow);
      }
    }
  }

  let currentPlan = plan.map(b => ({ ...b }));
  const allPerParent: ReductionSummary["perParent"] = [];
  let totalWeeks = 0;
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const pid of sortedPids) {
    const weeks = allocated.get(pid)!;
    if (weeks <= 0) continue;

    const result = proposeEvenSpreadReduction({
      plan: currentPlan,
      parentScope: [pid],
      daysToReduce: weeks,
    });

    currentPlan = result.nextBlocks;
    totalWeeks += result.summary.weeksAffectedTotal;
    allPerParent.push(...result.summary.perParent);
    if (result.summary.startDateOfReduction) {
      if (!earliest || compareDates(result.summary.startDateOfReduction, earliest) < 0)
        earliest = result.summary.startDateOfReduction;
    }
    if (result.summary.endDateOfReduction) {
      if (!latest || compareDates(result.summary.endDateOfReduction, latest) > 0)
        latest = result.summary.endDateOfReduction;
    }
  }

  const proportionalDebug: ProportionalDebug = {
    loads: parentIds.map(pid => ({ parentId: pid, load: loads.get(pid)! })),
    shares: parentIds.map(pid => ({ parentId: pid, share: Math.round((shares.get(pid)! || 0) * 100) / 100 })),
    requiredWeeksTotal: daysToReduce,
    allocatedWeeks: parentIds.map(pid => ({ parentId: pid, weeks: allocated.get(pid)! })),
  };

  return {
    nextBlocks: normalizeBlocks(currentPlan),
    summary: {
      weeksAffectedTotal: totalWeeks,
      reductionPerWeek: 1,
      startDateOfReduction: earliest,
      endDateOfReduction: latest,
      perParent: allPerParent,
    },
    proportionalDebug,
  };
}

// ── C) applySmartChange ──

export function applySmartChange(currentBlocks: Block[], nextBlocks: Block[]): Block[] {
  return normalizeBlocks(nextBlocks);
}
