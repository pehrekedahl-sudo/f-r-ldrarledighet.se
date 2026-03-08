import { mergeAdjacentBlocks } from "./mergeAdjacentBlocks";
import { diffDaysInclusive } from "@/utils/dateOnly";

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
  isOverlap?: boolean;
};

function calendarDays(b: Block): number {
  return diffDaysInclusive(b.startDate, b.endDate);
}

/**
 * Normalize blocks:
 * 1) Merge adjacent identical blocks (same parent, same dpw, same lowest)
 * 2) Absorb micro-blocks (<14 calendar days) into their nearest neighbor
 *    when they share the same parentId. The neighbor's dpw wins.
 */
export function normalizeBlocks(blocks: Block[]): Block[] {
  // Step 1: merge adjacent identical
  let result = mergeAdjacentBlocks(blocks);

  // Step 2: absorb micro-blocks
  // Group by parent, sort by startDate
  const byParent = new Map<string, Block[]>();
  const otherBlocks: Block[] = [];
  for (const b of result) {
    if (!byParent.has(b.parentId)) byParent.set(b.parentId, []);
    byParent.get(b.parentId)!.push(b);
  }

  const normalized: Block[] = [];
  for (const [, pBlocks] of byParent) {
    const sorted = pBlocks.sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (sorted.length <= 1) {
      normalized.push(...sorted);
      continue;
    }

    // Find micro-blocks and merge them into adjacent blocks
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
          // Absorb into the neighbor with the closest dpw, preferring the previous block
          const prev = i > 0 ? next[next.length - 1] : null;
          const nextB = i < merged.length - 1 ? merged[i + 1] : null;

          if (prev && (!nextB || Math.abs(prev.daysPerWeek - b.daysPerWeek) <= Math.abs(nextB.daysPerWeek - b.daysPerWeek))) {
            // Extend previous block to cover this one
            prev.endDate = b.endDate;
            changed = true;
          } else if (nextB) {
            // Extend next block to cover this one
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
    normalized.push(...merged);
  }

  // Final merge pass after absorptions
  return mergeAdjacentBlocks(normalized);
}
