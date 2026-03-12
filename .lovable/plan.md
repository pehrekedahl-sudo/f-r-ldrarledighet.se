

## Analysis: Why the algorithm gets stuck at 63

You're right — bidirectional propagation would violate the design principle (save from end, spend from start) and isn't the real problem.

### The actual bottleneck: the 8-block limit

The code on line 221 says:
```
if (blockDays < 28 || countNonOverlapBlocks(working) >= 8) {
    // reduce the WHOLE block's dpw
} else {
    // split into two parts, only reduce the tail
}
```

Once there are 8 non-overlap blocks total (across both parents, so ~4 per parent), the algorithm **cannot split blocks anymore**. It must reduce the entire block at once.

If a block covers 8 weeks at dpw 5, reducing to dpw 4 saves ~8 days in one shot. The algorithm tracks the "closest result" — so if at iteration N you're at 55 saved (need 71) and the next reduction jumps to 63, and the one after that would jump to ~75 (overshooting), the best-so-far stays at 63.

The forward propagation (lines 207-214) is actually correct in direction — it just rarely gets used because the real constraint isn't adjacency, it's the inability to make small adjustments due to the block limit.

### Fix: raise block limit + per-parent counting

Two changes in `src/components/SaveDaysDrawer.tsx`:

1. **Raise the limit from 8 to 12** on lines 221 and 267. This allows more splits, so the algorithm can reduce just the last 2 weeks of a block instead of the whole thing — enabling finer steps toward the target.

2. **Count per parent, not globally**. Change `countNonOverlapBlocks(working)` to count blocks only for the current parent being adjusted. A parent with 3 blocks shouldn't be blocked from splitting just because the other parent has 5. This doubles the effective capacity.

### Files changed
- `src/components/SaveDaysDrawer.tsx` — raise block limit to 12, count per-parent instead of globally

