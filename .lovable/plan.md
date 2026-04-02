

# Fix: Redesign budget logic for "Maximalt uttag" and "Balanserat"

## Problem
- **Maximalt uttag** shows 0 days consumed (cap bug may still be active or budget calc wrong)
- **Balanserat** uses a confusing SGI_DAYS formula that produces nonsensical results

## New strategy definitions

### 1. Maximalt uttag (income)
**Budget = 480, always.** Zero days saved. The algorithm distributes all 480 days across the total weeks. If total weeks are short (e.g. 26 weeks), rate will be 7 d/v and some days simply can't be used (480 > 7×26=182) — that's fine, show "298 dagar sparas (ej nog lång ledighet för att använda alla)".

### 2. Spara dagar (save) — unchanged
Budget = 304 (saves 176 days). Already works.

### 3. Balanserat (balanced) — new formula
Interpolate between income (480) and save (304) based on duration:
- Calculate a `durationRatio` from total months (clamped between ~6 and ~24 months → 0.0–1.0)
- Longer duration → closer to "maximalt" (fewer saved days)
- Shorter duration → closer to "spara dagar" (more saved days)
- `saveFraction = 0.5 - 0.2 × durationRatio` → ranges 0.3–0.5 of the 176 saved days
- `balancedSaved = Math.round(176 × saveFraction)` → ~53–88 days saved
- `budget = 480 - balancedSaved` → ~392–427

Example: 8+8 months (16 total, ratio≈0.56) → saveFraction≈0.39 → saves ~68 days → budget≈412

## Changes in `src/components/OnboardingWizard.tsx`

**`computeOptimalSchedule` switch block (lines 107-119):**

```typescript
case "income": budget = 480; break;
case "save": budget = 304; break;
case "balanced": {
  const totalMonths = m1Val + m2Val;
  // Clamp duration ratio: 6 months = 0, 24 months = 1
  const durationRatio = Math.min(1, Math.max(0, (totalMonths - 6) / 18));
  // Longer leave → save fewer days (0.3 of 176), shorter → save more (0.5 of 176)
  const saveFraction = 0.5 - 0.2 * durationRatio;
  const balancedSaved = Math.round(176 * saveFraction);
  budget = 480 - balancedSaved;
  break;
}
```

**Also fix "income" display**: When budget exceeds capacity (7 × totalWeeks), cap the effective consumed days and show a note that the leave period is too short to use all 480 days.

One file, ~10 lines changed.

