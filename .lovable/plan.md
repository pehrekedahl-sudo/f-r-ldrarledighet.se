

## Problem Analysis

Two bugs when adding a dubbeldagsblock (DD):

### Bug 1: Summary resets to zero
**Root cause**: The overlap validation in `simulatePlan.ts` (line 223) only checks `overlapGroupId` to allow overlapping blocks — but the new `DoubleDaysDrawer` sets `isOverlap: true` without setting `overlapGroupId`. When the DD block overlaps a regular p1 block, the validator flags it as `overlapWithinSameParent`, the simulation returns early with empty results, and the summary shows zeros.

### Bug 2: Days potentially double-counted for one parent
**Root cause**: The drawer creates a single block with `parentId: parents[0].id` (always p1). If p1 already has a regular block covering that period, p1's day budget gets consumed twice. Meanwhile, p2 gets no block at all — defeating the purpose of "dubbeldagar" (both parents take leave simultaneously).

The old `addDoubleDays` function (line 201-206) correctly created TWO blocks (one per parent). The new drawer only creates one.

## Plan

### A. Fix validation in `simulatePlan.ts`
Line 223: Also check `isOverlap` (not just `overlapGroupId`):
```
if (sorted[i].overlapGroupId || sorted[i + 1].overlapGroupId || sorted[i].isOverlap || sorted[i + 1].isOverlap) continue;
```

### B. Fix `DoubleDaysDrawer` to create TWO blocks
Change `onApply` callback signature from `(newBlock: Block) => void` to `(newBlocks: Block[]) => void`. The drawer creates one block per parent, both with `isOverlap: true` and a shared `overlapGroupId`.

### C. Update PlanBuilder's `onApply` handler
Spread the array of new blocks instead of adding a single block:
```ts
const updated = canonicalizeBlocks([...blocks, ...newBlocks]);
```

### D. Timeline: visual "pause" in parent rows during DD overlap
In `PlanTimeline.tsx`, when rendering each parent's blocks, visually clip/split them where DD blocks overlap. This shows a gap in the parent row with the DD period visible in the dedicated purple row below — making it clear the parent's regular block is "paused" during dubbeldagar.

### Files changed
- `src/lib/simulatePlan.ts` — fix overlap validation check
- `src/components/DoubleDaysDrawer.tsx` — create two blocks (one per parent)
- `src/pages/PlanBuilder.tsx` — update onApply to handle block array
- `src/components/PlanTimeline.tsx` — visual gaps during DD overlap periods

