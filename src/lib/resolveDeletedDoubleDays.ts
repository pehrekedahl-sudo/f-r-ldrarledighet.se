import type { Block } from "./adjustmentPolicy";
import { addDays, compareDates, diffDaysInclusive } from "../utils/dateOnly";

/**
 * When a DD (double-day) pair is deleted, resolve the gap left behind.
 *
 * Rules:
 * 1. Same parent on both sides, same DPW → merge across gap
 * 2. Same parent on both sides, different DPW → extend the shorter segment
 * 3. Cross-parent boundary → extend only the shortest adjacent segment; leave the other as-is
 * 4. No adjacent blocks → just remove the DD pair
 *
 * After resolution, run a light merge pass (no micro-block absorption).
 */
export function resolveDeletedDoubleDays(
  blocks: Block[],
  blockId: string
): Block[] {
  const target = blocks.find((b) => b.id === blockId);
  if (!target) return blocks;

  const groupId = target.overlapGroupId;
  if (!groupId) {
    // Not a DD block, just remove single block
    return blocks.filter((b) => b.id !== blockId);
  }

  // Find the DD pair
  const ddBlocks = blocks.filter((b) => b.overlapGroupId === groupId);
  if (ddBlocks.length === 0) return blocks;

  // Determine the DD window (union of all DD blocks in this group)
  const ddStart = ddBlocks
    .map((b) => b.startDate)
    .sort((a, b) => compareDates(a, b))[0];
  const ddEnd = ddBlocks
    .map((b) => b.endDate)
    .sort((a, b) => compareDates(b, a))[0];

  // Remove DD blocks
  let remaining = blocks.filter((b) => b.overlapGroupId !== groupId);

  // For each parent involved in the DD pair, find adjacent non-overlap blocks
  const ddParentIds = [...new Set(ddBlocks.map((b) => b.parentId))];

  // Collect adjacency info per parent
  type AdjInfo = {
    parentId: string;
    left: Block | null;  // block ending at ddStart-1 or earlier (closest)
    right: Block | null; // block starting at ddEnd+1 or later (closest)
  };

  const dayBeforeDd = addDays(ddStart, -1);
  const dayAfterDd = addDays(ddEnd, 1);

  const adjByParent: AdjInfo[] = ddParentIds.map((pid) => {
    const parentBlocks = remaining
      .filter((b) => b.parentId === pid && !b.isOverlap)
      .sort((a, b) => compareDates(a.startDate, b.startDate));

    // Left: block whose endDate == dayBeforeDd (directly adjacent)
    const left = parentBlocks.find((b) => b.endDate === dayBeforeDd) ?? null;
    // Right: block whose startDate == dayAfterDd
    const right = parentBlocks.find((b) => b.startDate === dayAfterDd) ?? null;

    return { parentId: pid, left, right };
  });

  // Now resolve the gap for each parent
  for (const adj of adjByParent) {
    const { left, right } = adj;

    if (left && right) {
      // Same parent has blocks on both sides
      if (left.daysPerWeek === right.daysPerWeek &&
          (left.lowestDaysPerWeek ?? 0) === (right.lowestDaysPerWeek ?? 0)) {
        // Same settings → merge: extend left to cover right, remove right
        const leftBlock = remaining.find((b) => b.id === left.id);
        const rightBlock = remaining.find((b) => b.id === right.id);
        if (leftBlock && rightBlock) {
          leftBlock.endDate = rightBlock.endDate;
          remaining = remaining.filter((b) => b.id !== right.id);
        }
      } else {
        // Different settings → extend the shorter one into the gap
        const leftDays = diffDaysInclusive(left.startDate, left.endDate);
        const rightDays = diffDaysInclusive(right.startDate, right.endDate);
        if (leftDays <= rightDays) {
          const leftBlock = remaining.find((b) => b.id === left.id);
          if (leftBlock) leftBlock.endDate = ddEnd;
        } else {
          const rightBlock = remaining.find((b) => b.id === right.id);
          if (rightBlock) rightBlock.startDate = ddStart;
        }
      }
    } else if (left) {
      const leftBlock = remaining.find((b) => b.id === left.id);
      if (leftBlock) leftBlock.endDate = ddEnd;
    } else if (right) {
      const rightBlock = remaining.find((b) => b.id === right.id);
      if (rightBlock) rightBlock.startDate = ddStart;
    }
    // No adjacent blocks for this parent → nothing to extend
  }

  // Cross-parent resolution: if two different parents both extended into the gap,
  // we need to keep only the shortest one's extension
  if (ddParentIds.length >= 2) {
    // Check if multiple parents now cover the DD window
    const parentsCoveringGap = ddParentIds.filter((pid) => {
      return remaining.some(
        (b) =>
          b.parentId === pid &&
          !b.isOverlap &&
          compareDates(b.startDate, ddEnd) <= 0 &&
          compareDates(b.endDate, ddStart) >= 0
      );
    });

    if (parentsCoveringGap.length >= 2) {
      // Both parents extended into the gap — revert and only extend the shortest
      // First, undo all extensions by re-reading from original
      remaining = blocks.filter((b) => b.overlapGroupId !== groupId).map((b) => ({ ...b }));

      // Re-collect adjacency
      const freshAdj = ddParentIds.map((pid) => {
        const parentBlocks = remaining
          .filter((b) => b.parentId === pid && !b.isOverlap)
          .sort((a, b) => compareDates(a.startDate, b.startDate));
        const left = parentBlocks.find((b) => b.endDate === dayBeforeDd) ?? null;
        const right = parentBlocks.find((b) => b.startDate === dayAfterDd) ?? null;
        return { parentId: pid, left, right };
      });

      // Find the shortest adjacent segment across all parents
      type Candidate = { parentId: string; block: Block; side: "left" | "right"; days: number };
      const candidates: Candidate[] = [];
      for (const adj of freshAdj) {
        if (adj.left) {
          candidates.push({
            parentId: adj.parentId,
            block: adj.left,
            side: "left",
            days: diffDaysInclusive(adj.left.startDate, adj.left.endDate),
          });
        }
        if (adj.right) {
          candidates.push({
            parentId: adj.parentId,
            block: adj.right,
            side: "right",
            days: diffDaysInclusive(adj.right.startDate, adj.right.endDate),
          });
        }
      }

      if (candidates.length > 0) {
        // Pick shortest
        candidates.sort((a, b) => a.days - b.days);
        const winner = candidates[0];
        const winnerBlock = remaining.find((b) => b.id === winner.block.id);
        if (winnerBlock) {
          if (winner.side === "left") {
            winnerBlock.endDate = ddEnd;
          } else {
            winnerBlock.startDate = ddStart;
          }
        }
      }
    }
  }

  // Light cleanup: merge adjacent identical blocks (no micro-block absorption)
  return lightMerge(remaining);
}

/** Merge only directly adjacent blocks with identical settings (same parent, dpw, lowest). */
function lightMerge(blocks: Block[]): Block[] {
  const working = blocks
    .map((b) => ({ ...b }))
    .filter((b) => b.startDate && b.endDate && compareDates(b.endDate, b.startDate) >= 0);

  working.sort(
    (a, b) => a.parentId.localeCompare(b.parentId) || compareDates(a.startDate, b.startDate)
  );

  const result: Block[] = [];
  let i = 0;
  while (i < working.length) {
    const current = { ...working[i] };
    let j = i + 1;
    while (j < working.length) {
      const next = working[j];
      if (current.parentId !== next.parentId) break;
      const dayAfter = addDays(current.endDate, 1);
      const sameSettings =
        current.daysPerWeek === next.daysPerWeek &&
        (current.lowestDaysPerWeek ?? 0) === (next.lowestDaysPerWeek ?? 0) &&
        !!current.isOverlap === !!next.isOverlap;
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
  return result;
}
