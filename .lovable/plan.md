

## Problem: Why SaveDaysDrawer is inconsistent

There are three compounding issues:

### Root causes

1. **Micro-block absorption destroys precision**: `adjustToTarget` creates 7-day split blocks, but `normalizeBlocks` (called on line 166 inside the loop AND again in `applySmartChange`) absorbs blocks shorter than 14 days back into their neighbors. This silently changes `daysPerWeek` on absorbed segments, making the simulation result differ from what was computed during the iteration.

2. **Triple normalization pipeline**: The blocks go through `normalizeBlocks` inside the loop → `normalizeBlocks` in `applySmartChange` → `canonicalizeBlocks` in PlanBuilder (which re-sorts high-dpw blocks first and re-normalizes). Each pass can merge, absorb, or reorder blocks, each time shifting the actual remaining-days count away from the target.

3. **Preview vs applied mismatch**: The drawer shows `proposal.newTotal` computed from `adjustToTarget`'s output, but `onApply` runs `canonicalizeBlocks` which reorders blocks, changing the simulation result. The user sees one number in the drawer, gets a different number in the plan.

### Fix plan

**A. Stop normalizing inside the iteration loop** (SaveDaysDrawer lines 166, 172)
- Remove `normalizeBlocks` calls from inside the `for` loop. Work on raw blocks throughout iteration. Only normalize once at the very end.
- This prevents micro-block absorption from undoing each iteration's work.

**B. Canonicalize the final output inside `adjustToTarget`** 
- At the end of `adjustToTarget`, run `canonicalizeBlocks` (not just `normalizeBlocks`) on the result blocks. This makes the output identical to what PlanBuilder will produce.
- The final verification simulation runs on canonicalized blocks, so `proposal.newTotal` matches reality.

**C. Make PlanBuilder's `onApply` idempotent**
- In PlanBuilder's `onApply` for SaveDaysDrawer (line 1060-1085): since the drawer already canonicalized, `canonicalizeBlocks` is now a no-op. Keep the call for safety but the result won't change.
- Remove the complex `savedDaysCount` delta calculation (lines 1064-1080) — it's unused legacy logic. Just set blocks directly.

**D. Ensure split blocks are ≥14 days**
- In `adjustToTarget`, when splitting a block, ensure both halves are ≥14 calendar days. If the block is too short to split cleanly, modify the whole block instead. This prevents micro-block absorption from ever triggering.

### Files changed
- `src/components/SaveDaysDrawer.tsx` — rewrite `adjustToTarget` loop and `computeProposal`
- `src/pages/PlanBuilder.tsx` — simplify `onApply` handler for SaveDaysDrawer

### Technical detail

The new `adjustToTarget` loop structure:

```text
adjustToTarget:
  working = deep copy of blocks
  for iter 0..59:
    sim = simulatePlan(working)          // NO normalizeBlocks
    remaining = calcRemaining(sim)
    if remaining == target → break
    pick candidate, adjust dpw (split only if both parts ≥14 days)
    track bestBlocks by diff
  
  final = canonicalizeBlocks(bestBlocks) // ONE normalization
  verify = simulatePlan(final)           // verify on canonical form
  return final
```

This guarantees: what the drawer previews = what gets applied = what the plan shows.

