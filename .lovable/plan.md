

# Fix: handleOverlapTruncate — atomic state update

## Root cause

`handleOverlapTruncate` makes **two separate `setBlocks` calls**:
1. `applyDrawerSave(pendingDrawerBlock)` — replaces the target block and runs `normalizeBlocks`, setting blocks to a new value
2. `setBlocks(prev => ...)` — truncates the other block using `prev`

The first call sets blocks via `setBlocks(merged)` (a direct value, not a function updater). Even though React batches these, `normalizeBlocks` in step 1 can merge/absorb blocks in unexpected ways. The truncation in step 2 then operates on an already-normalized result where block IDs or boundaries may have shifted, causing the truncation to silently fail or produce overlapping blocks.

The same issue exists for the `handleOverlapCreateDD` path — it also does two sequential `setBlocks` calls.

## Fix

Combine the target block change and the truncation (or DD creation) into **one atomic `setBlocks` call** with a single `normalizeBlocks` at the end.

### `src/pages/PlanBuilder.tsx`

**`handleOverlapTruncate`** — rewrite to:
1. Start from current `blocks`
2. Apply the target block change inline (replace block or add new block, depending on drawer mode)
3. Truncate the other block in the same array
4. Run `normalizeBlocks` once on the combined result
5. Call `setBlocks` once with the final result

**`handleOverlapCreateDD`** — same pattern: apply target change + create DD blocks in one `setBlocks` call with one `normalizeBlocks`.

**`applyDrawerSave`** — no changes needed (still used for non-overlap saves).

## Changes

| File | Change |
|---|---|
| `src/pages/PlanBuilder.tsx` | Rewrite `handleOverlapTruncate` and `handleOverlapCreateDD` to do all mutations in a single `setBlocks` + `normalizeBlocks` call |

