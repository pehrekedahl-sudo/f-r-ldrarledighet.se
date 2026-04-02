

# Fix: Ändra totalbudget från 390 till 480 dagar

## Problem
All budgetlogik i steg 5 använder 390 som tak, men parets totala budget är **480 dagar** (390 SGI + 90 lägstanivå). Alla tre förslag och live-feedbacken ska utgå från 480.

## Ändringar i `src/components/OnboardingWizard.tsx`

1. **Konstant**: Byt alla hårdkodade `390` till `480` (eller en `TOTAL_BUDGET = 480`-konstant).

2. **`computeSuggestion`**:
   - `income`: Greedy-algoritmen optimerar mot 480 istället för 390
   - `save`: `SAVE_BUDGET = 480 - 176 = 304` (istället för 214)
   - `balanced`: Beräknas mot 480

3. **Live-feedback (rad 492-596)**:
   - `daysRemaining = 480 - daysConsumed`
   - Texten: "X dagar kvar av 480"

4. **Kortbeskrivning (rad 502)**: "inom 480-dagarsbudgeten"

~8 ställen att ändra, alla i samma fil.

