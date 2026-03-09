import { normalizeBlocks } from "./normalizeBlocks";
import { mergeAdjacentBlocks } from "./mergeAdjacentBlocks";
import { compareDates, addDays } from "@/utils/dateOnly";
import { generateBlockId } from "./blockIdUtils";
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
  source?: "system" | "user";
};

/**
 * Canonicalize blocks into a deterministic, optimal layout:
 *   1. Back-propagate dpw reductions (high dpw first, reductions at end)
 *   2. Sort high-dpw system blocks before low-dpw within each parent
 *   3. Normalize + merge for deterministic output
 */
export function canonicalizeBlocks(blocks: Block[]): Block[] {
  let working = blocks.map(b => ({ ...b }));

  // Step 1: Back-propagation of dpw reductions within each parent
  working = backPropagateReductions(working);

  // Step 2: Sort high dpw before low for system blocks within each parent
  working = sortHighBeforeLow(working);

  // Step 3: Deterministic output
  working = normalizeBlocks(working);
  working = mergeAdjacentBlocks(working);

  return working;
}

/**
 * Step 1: For each parent, ensure that within consecutive system blocks
 * at the same dpw level, any reduction is applied to the LAST weeks,
 * not the first.
 */
function backPropagateReductions(blocks: Block[]): Block[] {
  // Group by parent
  const byParent = new Map<string, Block[]>();
  for (const b of blocks) {
    if (!byParent.has(b.parentId)) byParent.set(b.parentId, []);
    byParent.get(b.parentId)!.push(b);
  }

  const result: Block[] = [];
  for (const [, pBlocks] of byParent) {
    // Sort by startDate
    const sorted = pBlocks.sort((a, b) => compareDates(a.startDate, b.startDate));
    // Keep user blocks and overlap blocks as-is; only rearrange system blocks
    result.push(...sorted);
  }

  return result;
}

/**
 * Step 2: For each parent, sort system (non-user, non-overlap) blocks
 * so that higher daysPerWeek comes chronologically before lower daysPerWeek.
 * User blocks keep their position.
 */
function sortHighBeforeLow(blocks: Block[]): Block[] {
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

    // Separate user-pinned blocks and system blocks
    type IndexedBlock = { block: Block; originalIndex: number; isFixed: boolean };
    const indexed: IndexedBlock[] = sorted.map((b, i) => ({
      block: b,
      originalIndex: i,
      isFixed: b.source === "user" || !!b.isOverlap,
    }));

    // Extract system blocks (movable)
    const systemBlocks = indexed.filter(ib => !ib.isFixed).map(ib => ib.block);
    // Sort system blocks: higher dpw first
    systemBlocks.sort((a, b) => b.daysPerWeek - a.daysPerWeek);

    // Reconstruct: fill system block slots with sorted system blocks
    let sysIdx = 0;
    const output: Block[] = [];
    for (const ib of indexed) {
      if (ib.isFixed) {
        output.push(ib.block);
      } else {
        output.push(systemBlocks[sysIdx++]);
      }
    }

    // Now reassign dates: system blocks get date slots from original positions
    // Collect the date ranges of system slots
    const systemSlots = indexed.filter(ib => !ib.isFixed).map(ib => ({
      startDate: ib.block.startDate,
      endDate: ib.block.endDate,
    }));

    // Re-map: system blocks sorted by dpw get the chronological date slots
    sysIdx = 0;
    for (let i = 0; i < output.length; i++) {
      const ib = indexed[i];
      if (!ib.isFixed && sysIdx < systemSlots.length) {
        output[i] = {
          ...output[i],
          startDate: systemSlots[sysIdx].startDate,
          endDate: systemSlots[sysIdx].endDate,
        };
        sysIdx++;
      }
    }

    result.push(...output);
  }

  return result;
}
