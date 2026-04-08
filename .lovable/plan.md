

# Fix: Enforce 60-day DD cap in overlap handlers

## Problem
When a user moves a block (e.g., Pelle's) earlier via the BlockEditDrawer, creating a large cross-parent overlap (224 days in this case), the "Skapa dubbeldagar" option should be disabled but somehow 224 DD days were created. The current `ddCapExceeded` check only disables the UI button — there is no enforcement inside `handleOverlapCreateDD` itself.

## Root cause candidates
1. **No hard enforcement in handler**: `handleOverlapCreateDD` has no guard — if the button is somehow clicked (race condition, stale memo, or UI glitch), the full overlap becomes DD with no cap.
2. **Possible stale memo**: `ddCapExceeded` depends on `overlapDialog.overlapDays` via `useMemo`. If the dialog state updates but the memo hasn't re-evaluated before the user clicks, the button could briefly be enabled.

## Fix

### `src/pages/PlanBuilder.tsx`

1. **Add hard guard in `handleOverlapCreateDD`**: At the top of the function, re-compute the cap check inline (not relying on the memo). If `existingDDDays + overlapDays > 60`, return early with a toast warning. This is the defense-in-depth fix.

2. **Cap DD creation to remaining days**: Instead of creating DD for the entire overlap when it exceeds 60 days, truncate the DD block's `endDate` so that only up to `60 - existingDDDays` weekdays are covered. Update the dialog text to explain: "Dubbeldagar begränsas till 60 dagar — överlappet kortas automatiskt."

3. **Re-enable button with cap behavior**: Instead of fully disabling the DD button when cap is exceeded, keep it enabled but change the label to "Skapa dubbeldagar (max 60)" and have the handler automatically cap the DD period. Only disable when `existingDDDays >= 60` (no room left at all).

## Changes

| File | Change |
|---|---|
| `src/pages/PlanBuilder.tsx` | Add hard guard + auto-cap logic in `handleOverlapCreateDD`; update dialog UI to show capped DD option instead of disabling |

