type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  overlapGroupId?: string;
};

let _blockIdCounter = 0;

/** Generate a unique block ID that won't collide */
export function generateBlockId(prefix = "blk"): string {
  _blockIdCounter++;
  return `${prefix}-${Date.now()}-${_blockIdCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Assert all block IDs are unique. Logs errors for duplicates (dev-safe). */
export function assertUniqueBlockIds(blocks: Block[], context: string): void {
  const counts = new Map<string, Block[]>();
  for (const b of blocks) {
    if (!counts.has(b.id)) counts.set(b.id, []);
    counts.get(b.id)!.push(b);
  }
  for (const [id, arr] of counts) {
    if (arr.length > 1) {
      console.error(
        `[assertUniqueBlockIds] DUPLICATE ID "${id}" (×${arr.length}) after "${context}":`,
        arr.map(b => ({ id: b.id, parentId: b.parentId, start: b.startDate, end: b.endDate, dpw: b.daysPerWeek }))
      );
    }
  }
}
