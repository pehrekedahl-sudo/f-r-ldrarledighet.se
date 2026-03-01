import { generateBlockId } from "./blockIdUtils";

// ── Shared Block type ──

export type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
};

// ── Constants ──

export const MIN_AUTO_DPW = 3;

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
    .filter(b => b.startDate && b.endDate && b.endDate >= b.startDate);

  // Step 2: clamp values
  for (const b of working) {
    b.daysPerWeek = clampInt(b.daysPerWeek, 0, 7);
    if (b.lowestDaysPerWeek !== undefined) {
      b.lowestDaysPerWeek = clampInt(b.lowestDaysPerWeek, 0, b.daysPerWeek);
    }
  }

  // Step 3: deterministic sort
  working.sort((a, b) => a.parentId.localeCompare(b.parentId) || a.startDate.localeCompare(b.startDate));

  // Step 4: merge adjacent identical
  working = mergePass(working);

  // Step 5: absorb micro-blocks
  working = absorbMicroBlocks(working);

  // Step 6: final merge
  working = mergePass(working);

  // Deterministic sort for output
  working.sort((a, b) => a.parentId.localeCompare(b.parentId) || a.startDate.localeCompare(b.startDate));

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
    const sorted = byParent.get(pid)!.sort((a, b) => a.startDate.localeCompare(b.startDate));
    let i = 0;
    while (i < sorted.length) {
      const current = { ...sorted[i] };
      let j = i + 1;
      while (j < sorted.length) {
        const next = sorted[j];
        const dayAfter = addDaysISO(current.endDate, 1);
        const sameSettings =
          current.daysPerWeek === next.daysPerWeek &&
          (current.lowestDaysPerWeek ?? 0) === (next.lowestDaysPerWeek ?? 0);
        if (dayAfter === next.startDate && sameSettings) {
          current.endDate = next.endDate;
          // Keep current.id (earlier block's id)
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
    const sorted = pBlocks.sort((a, b) => a.startDate.localeCompare(b.startDate));
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
        if (calendarDays(b) < 14 && merged.length > 1) {
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
  let pass = 0;

  // Multi-pass: each pass reduces by 1 dpw, never below MIN_AUTO_DPW
  while (remaining > 0 && pass < 5) {
    pass++;
    // Get candidate blocks: sorted latest-first
    const candidates = working
      .filter(b => allowedParents.has(b.parentId) && b.daysPerWeek >= MIN_AUTO_DPW + 1)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));

    if (candidates.length === 0) break;

    for (const target of candidates) {
      if (remaining <= 0) break;
      if (target.daysPerWeek < MIN_AUTO_DPW + 1) continue;

      const calDays = calendarDays(target);
      const blockWeeks = Math.floor(calDays / 7);
      if (blockWeeks <= 0) continue;

      const newDpw = target.daysPerWeek - 1;

      if (blockWeeks <= remaining) {
        // Reduce entire block
        const entry = perParentMap.get(target.parentId);
        if (!entry) {
          perParentMap.set(target.parentId, { weeksAffected: blockWeeks, oldDpw: target.daysPerWeek, newDpw });
        } else {
          entry.weeksAffected += blockWeeks;
        }
        target.daysPerWeek = newDpw;
        remaining -= blockWeeks;

        // Track date range
        if (!earliestReduction || target.startDate < earliestReduction) earliestReduction = target.startDate;
        if (!latestReduction || target.endDate > latestReduction) latestReduction = target.endDate;
      } else {
        // Split: keep head unchanged, reduce tail
        const headDays = calDays - remaining * 7;
        if (headDays <= 0) {
          // Reduce entire block
          const entry = perParentMap.get(target.parentId);
          if (!entry) {
            perParentMap.set(target.parentId, { weeksAffected: blockWeeks, oldDpw: target.daysPerWeek, newDpw });
          } else {
            entry.weeksAffected += blockWeeks;
          }
          target.daysPerWeek = newDpw;
          remaining = 0;
        } else {
          const splitDate = addDaysISO(target.startDate, headDays);
          const tailBlock: Block = {
            id: generateBlockId("policy-red"),
            parentId: target.parentId,
            startDate: splitDate,
            endDate: target.endDate,
            daysPerWeek: newDpw,
            lowestDaysPerWeek: target.lowestDaysPerWeek,
            overlapGroupId: target.overlapGroupId,
          };
          const entry = perParentMap.get(target.parentId);
          if (!entry) {
            perParentMap.set(target.parentId, { weeksAffected: remaining, oldDpw: target.daysPerWeek, newDpw });
          } else {
            entry.weeksAffected += remaining;
          }
          target.endDate = addDaysISO(splitDate, -1);
          working.push(tailBlock);

          if (!earliestReduction || splitDate < earliestReduction) earliestReduction = splitDate;
          if (!latestReduction || tailBlock.endDate > latestReduction) latestReduction = tailBlock.endDate;

          remaining = 0;
        }
      }
    }
  }

  const perParent = Array.from(perParentMap.entries()).map(([parentId, v]) => ({
    parentId,
    ...v,
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

// ── C) applySmartChange ──

/**
 * Replace current blocks with next blocks, immediately normalize.
 * Single source of truth for all smart feature apply actions.
 */
export function applySmartChange(currentBlocks: Block[], nextBlocks: Block[]): Block[] {
  return normalizeBlocks(nextBlocks);
}
