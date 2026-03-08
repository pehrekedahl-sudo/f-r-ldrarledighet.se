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

import { addDays } from "@/utils/dateOnly";

function addDaysISO(iso: string, days: number): string {
  return addDays(iso, days);
}

/**
 * Merge adjacent blocks with identical settings for the same parent.
 * Two blocks A, B are merged when:
 *   - same parentId
 *   - same daysPerWeek
 *   - same lowestDaysPerWeek (treating undefined as 0)
 *   - A.endDate is exactly the day before B.startDate
 * The merged block keeps A.id.
 */
export function mergeAdjacentBlocks(blocks: Block[]): Block[] {
  // Group by parentId
  const byParent = new Map<string, Block[]>();
  const parentOrder: string[] = [];
  for (const b of blocks) {
    if (!byParent.has(b.parentId)) {
      byParent.set(b.parentId, []);
      parentOrder.push(b.parentId);
    }
    byParent.get(b.parentId)!.push({ ...b });
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
        const dayAfterCurrent = addDaysISO(current.endDate, 1);
        const sameOverlap = (!!current.isOverlap) === (!!next.isOverlap);
        const sameSettings =
          current.daysPerWeek === next.daysPerWeek &&
          (current.lowestDaysPerWeek ?? 0) === (next.lowestDaysPerWeek ?? 0);
        if (dayAfterCurrent === next.startDate && sameSettings && sameOverlap) {
          // Merge: extend current to cover next
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
