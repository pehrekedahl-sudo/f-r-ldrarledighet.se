

## Problem

When `source === "both"`, the loop alternates parents each iteration (line 180-182). But if no valid candidate is found for the current parent's turn, `adjusted` stays `false` and the loop **breaks entirely** (line 294). This means if parent B happens to have no adjustable block on its turn (e.g. adjacency constraint, already at min/max dpw), the whole algorithm stops — even though parent A still has capacity.

This creates uneven distribution: whichever parent "gets stuck" first halts the entire process.

## Fix

In `src/components/SaveDaysDrawer.tsx`, when in "both" mode and the current parent yields no candidate, **try the other parent before giving up**:

```text
Current logic:
  pick parent[turnIndex % 2]
  try to find candidate for that parent
  if no candidate → break (BUG: other parent might still work)

Fixed logic:
  pick parent[turnIndex % 2]
  try to find candidate for that parent
  if no candidate AND source === "both":
    try the OTHER parent
    if still no candidate → break
```

This is a small change around lines 187-294: wrap the candidate search in a retry that flips to the other parent on failure before breaking.

### File changed
- `src/components/SaveDaysDrawer.tsx` — retry with alternate parent before breaking the loop

