

# Fix: Empty schedule when baseRate hits cap (7)

## Root cause

In `computeOptimalSchedule` (line 121-148), when the budget is large relative to total weeks (e.g. 480 days over ~26 weeks), `baseRate` is clamped to 7. Then `highRate = min(7, baseRate + 1) = 7`, which equals `baseRate`.

This causes two failures:
1. High-rate segments skipped: `if (extraWeeks > 0 && highRate !== baseRate)` → false
2. Low-rate segments have 0 weeks: `remainWeeks = weeks - extraWeeks = 0` (all weeks allocated as "extra")

Result: no segments pushed → 0 days consumed.

The same issue affects "balanced" — it gets `baseRate = 7` but the budget is only 182, so the schedule shows 182 days but the card description is misleading (all weeks at 7 dpw but only 26 weeks total).

## Fix in `src/components/OnboardingWizard.tsx`

**Lines 124-127**: When `highRate === baseRate`, reset `extraWeeksTotal` to 0 so all weeks fall into the "remain" buckets at `baseRate`:

```typescript
const extraDays = budget - baseRate * totalWeeks;
let extraWeeksTotal = Math.min(totalWeeks, Math.max(0, extraDays));

// If baseRate is already at cap, no differentiation needed
if (highRate === baseRate) extraWeeksTotal = 0;

const extraWeeks1 = Math.min(weeks1, Math.ceil(extraWeeksTotal / 2));
const extraWeeks2 = Math.min(weeks2, extraWeeksTotal - extraWeeks1);
```

This ensures that when the budget can't be fully filled (because 7 dpw × totalWeeks < budget), every week still gets a segment at the max rate (7), and the remaining unused days are transparently shown in the live feedback.

One change, ~2 lines added, same file.

