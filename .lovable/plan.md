

# Fix: DD block deletion must remove both paired blocks

## Problem
When clicking the X on a DD block in the timeline, only the single clicked block is removed (`blocks.filter(b => b.id !== blockId)`). DD blocks are paired via `overlapGroupId` — both blocks in the pair must be removed together. The first click removes one DD block, causing the partner DD block to remain as an orphan, which triggers visual glitches and requires a second click.

## Root cause
In `PlanBuilder.tsx` line 1182-1189, the `onDeleteOverlap` handler filters by the single `blockId`:
```typescript
const updated = blocks.filter(b => b.id !== blockId);
```
It should filter out **all blocks sharing the same `overlapGroupId`**.

## Fix

### `src/pages/PlanBuilder.tsx` — `onDeleteOverlap` handler

Replace the single-ID filter with a group-based filter:
1. Find the clicked block's `overlapGroupId`
2. Remove all blocks with that `overlapGroupId`
3. Run `normalizeBlocks` on the result to clean up any gaps

| File | Change |
|---|---|
| `src/pages/PlanBuilder.tsx` | Update `onDeleteOverlap` to remove both DD blocks in the pair by filtering on `overlapGroupId` instead of single `id` |

