import type { Block } from "./adjustmentPolicy";
import { generateBlockId } from "./blockIdUtils";
import { addDays, compareDates, diffDaysInclusive } from "../utils/dateOnly";

/**
 * When a DD (double-day) pair is deleted, resolve the gap left behind.
 *
 * Key insight: raw regular blocks may still span through the DD window
 * (the timeline only clips them visually). We must split those blocks
 * at the DD boundaries to produce "materialized" left/right fragments,
 * then decide which fragment fills the gap, and trim the losing parent's
 * blocks to avoid cross-parent overlap.
 *
 * Rules:
 * 1. Same parent on both sides, same DPW → merge across gap
 * 2. Same parent on both sides, different DPW → extend shorter fragment
 * 3. Cross-parent → extend only the shortest adjacent fragment; trim the
 *    losing parent's block so it no longer covers the gap or overlaps
 * 4. No adjacent blocks → just remove the DD pair
 */
export function resolveDeletedDoubleDays(
  blocks: Block[],
  blockId: string
): Block[] {
  const target = blocks.find((b) => b.id === blockId);
  if (!target) return blocks;

  const groupId = target.overlapGroupId;
  if (!groupId) {
    return blocks.filter((b) => b.id !== blockId);
  }

  // Deep clone everything so we never mutate React state
  const working = blocks.map((b) => ({ ...b }));

  // Find DD pair and compute the DD window
  const ddBlocks = working.filter((b) => b.overlapGroupId === groupId);
  if (ddBlocks.length === 0) return working;

  const ddStart = ddBlocks
    .map((b) => b.startDate)
    .sort((a, b) => compareDates(a, b))[0];
  const ddEnd = ddBlocks
    .map((b) => b.endDate)
    .sort((a, b) => compareDates(b, a))[0];

  // Remove the DD blocks
  let result = working.filter((b) => b.overlapGroupId !== groupId);

  // Parents involved in this DD pair
  const ddParentIds = [...new Set(ddBlocks.map((b) => b.parentId))];

  // Step 1: Materialize — split any regular block that spans into/through the DD window
  result = materializeAroundWindow(result, ddStart, ddEnd, ddParentIds);

  const dayBeforeDd = addDays(ddStart, -1);
  const dayAfterDd = addDays(ddEnd, 1);

  // Track which parent "won" the gap (extended into or merged across it)
  let winnerParentId: string | null = null;

  // Step 2: Find left/right candidates per parent
  type Candidate = {
    parentId: string;
    block: Block;
    side: "left" | "right";
    days: number;
  };

  const allCandidates: Candidate[] = [];

  for (const pid of ddParentIds) {
    const parentBlocks = result
      .filter((b) => b.parentId === pid && !b.isOverlap)
      .sort((a, b) => compareDates(a.startDate, b.startDate));

    const left = parentBlocks.find((b) => b.endDate === dayBeforeDd) ?? null;
    const right = parentBlocks.find((b) => b.startDate === dayAfterDd) ?? null;

    // Same-parent resolution
    if (left && right) {
      const sameSettings =
        left.daysPerWeek === right.daysPerWeek &&
        (left.lowestDaysPerWeek ?? 0) === (right.lowestDaysPerWeek ?? 0);
      if (sameSettings) {
        // Merge across gap
        const leftBlock = result.find((b) => b.id === left.id)!;
        leftBlock.endDate = right.endDate;
        result = result.filter((b) => b.id !== right.id);
        winnerParentId = pid;
        continue;
      } else {
        // Extend shortest
        const leftDays = diffDaysInclusive(left.startDate, left.endDate);
        const rightDays = diffDaysInclusive(right.startDate, right.endDate);
        if (leftDays <= rightDays) {
          result.find((b) => b.id === left.id)!.endDate = ddEnd;
        } else {
          result.find((b) => b.id === right.id)!.startDate = ddStart;
        }
        winnerParentId = pid;
        continue;
      }
    }

    // Single-side or no adjacent — collect as cross-parent candidate
    if (left) {
      allCandidates.push({
        parentId: pid,
        block: left,
        side: "left",
        days: diffDaysInclusive(left.startDate, left.endDate),
      });
    }
    if (right) {
      allCandidates.push({
        parentId: pid,
        block: right,
        side: "right",
        days: diffDaysInclusive(right.startDate, right.endDate),
      });
    }
  }

  // Step 3: Cross-parent resolution — pick the single shortest candidate
  if (allCandidates.length > 0 && !winnerParentId) {
    // Sort by days ascending, then parentId for deterministic tie-break
    allCandidates.sort(
      (a, b) => a.days - b.days || a.parentId.localeCompare(b.parentId)
    );
    const winner = allCandidates[0];
    const winnerBlock = result.find((b) => b.id === winner.block.id);
    if (winnerBlock) {
      if (winner.side === "left") {
        winnerBlock.endDate = ddEnd;
      } else {
        winnerBlock.startDate = ddStart;
      }
    }
    winnerParentId = winner.parentId;
  }

  // Step 4: Trim cross-parent overlaps between involved parents
  if (winnerParentId && ddParentIds.length >= 2) {
    result = trimCrossParentOverlaps(result, ddParentIds, winnerParentId);
  }

  return lightMerge(result);
}

/**
 * Split regular (non-overlap) blocks that intersect the DD window into
 * up to two fragments: one ending at ddStart-1 and one starting at ddEnd+1.
 * The portion inside the DD window is discarded.
 */
function materializeAroundWindow(
  blocks: Block[],
  ddStart: string,
  ddEnd: string,
  parentIds: string[]
): Block[] {
  const parentSet = new Set(parentIds);
  const result: Block[] = [];

  for (const b of blocks) {
    if (b.isOverlap || !parentSet.has(b.parentId)) {
      result.push(b);
      continue;
    }

    const startsBeforeDd = compareDates(b.startDate, ddStart) < 0;
    const endsAfterDd = compareDates(b.endDate, ddEnd) > 0;
    const intersects =
      compareDates(b.startDate, ddEnd) <= 0 &&
      compareDates(b.endDate, ddStart) >= 0;

    if (!intersects) {
      result.push(b);
      continue;
    }

    // Block intersects the DD window — split it
    if (startsBeforeDd) {
      result.push({
        ...b,
        endDate: addDays(ddStart, -1),
      });
    }
    if (endsAfterDd) {
      result.push({
        ...b,
        id: generateBlockId("split"),
        startDate: addDays(ddEnd, 1),
      });
    }
    // Entirely within DD window → discarded
  }

  return result;
}

/**
 * After gap resolution, the winning parent may have blocks that overlap with
 * the losing parent's blocks (because the raw data had cross-parent overlap
 * beyond the DD window). Trim the losers so no regular cross-parent overlap remains.
 */
function trimCrossParentOverlaps(
  blocks: Block[],
  involvedParentIds: string[],
  winnerParentId: string
): Block[] {
  const loserPids = involvedParentIds.filter((p) => p !== winnerParentId);
  const winnerBlocks = blocks.filter(
    (b) => b.parentId === winnerParentId && !b.isOverlap
  );

  const result: Block[] = [];

  for (const b of blocks) {
    if (b.isOverlap || !loserPids.includes(b.parentId)) {
      result.push(b);
      continue;
    }

    // Check if this loser block overlaps with any winner block
    let trimmed = { ...b };
    let discard = false;

    for (const w of winnerBlocks) {
      const overlaps =
        compareDates(trimmed.startDate, w.endDate) <= 0 &&
        compareDates(trimmed.endDate, w.startDate) >= 0;

      if (!overlaps) continue;

      // Trim the loser block to remove the overlapping portion
      const startsBeforeWinner = compareDates(trimmed.startDate, w.startDate) < 0;
      const endsAfterWinner = compareDates(trimmed.endDate, w.endDate) > 0;

      if (startsBeforeWinner && endsAfterWinner) {
        // Loser spans the winner — keep only the left part, add right part separately
        const rightPart: Block = {
          ...trimmed,
          id: generateBlockId("trim"),
          startDate: addDays(w.endDate, 1),
        };
        trimmed.endDate = addDays(w.startDate, -1);
        result.push(rightPart);
      } else if (startsBeforeWinner) {
        // Loser starts before winner — trim end
        trimmed.endDate = addDays(w.startDate, -1);
      } else if (endsAfterWinner) {
        // Loser ends after winner — trim start
        trimmed.startDate = addDays(w.endDate, 1);
      } else {
        // Loser is entirely within winner — discard
        discard = true;
        break;
      }
    }

    if (!discard && compareDates(trimmed.endDate, trimmed.startDate) >= 0) {
      result.push(trimmed);
    }
  }

  return result;
}

/** Merge only directly adjacent blocks with identical settings (same parent, dpw, lowest). */
function lightMerge(blocks: Block[]): Block[] {
  const working = blocks
    .filter(
      (b) =>
        b.startDate &&
        b.endDate &&
        compareDates(b.endDate, b.startDate) >= 0
    )
    .map((b) => ({ ...b }));

  working.sort(
    (a, b) =>
      a.parentId.localeCompare(b.parentId) ||
      compareDates(a.startDate, b.startDate)
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
