

# Fix: Hög inkomst-kortet och live-feedback

## Problem

1. **"Hög inkomst"-kortet är motsägelsefullt**: Beskrivningen säger "7 d/v — 48 veckor behöver vara 5 d/v" men föreslår sedan 6 d/v. Användaren förstår inte vad som gäller.
2. **Live-feedbacken visar fortfarande "överskrider med 26 dagar"** — det beror på att income-förslaget sätter en dpw som ändå spräcker 390-budgeten.

## Lösning

Förenkla income-logiken: istället för att prata om "7 d/v med vissa veckor på 5 d/v", beräkna helt enkelt **högsta möjliga dpw som ryms inom 390 dagar**:

```
maxDpw = min(7, floor(390 / totalWeeks))
```

Kortet visar sedan t.ex. "Maximalt uttag — 5 dagar/vecka" med en enkel beskrivning. Inga motstridiga meddelanden.

## Tekniska ändringar i `src/components/OnboardingWizard.tsx`

1. **`computeSuggestion` — income-fallet (rad 95)**: Byt från `Math.ceil(baseDpw + 1)` till `Math.min(7, Math.floor(390 / totalWeeks))`. Behöver m1/m2 även för income, precis som save.

2. **`sug()` (rad 473-478)**: Skicka m1/m2 till computeSuggestion även för income/balanced.

3. **`applyPreference` (rad 105-118)**: Skicka m1/m2 till alla anrop.

4. **Income-kortets beskrivning (rad 490-496)**: Ta bort "weeksAt5"-logiken. Visa istället en enkel beskrivning: `"Maximalt uttag — ta ut så mycket som möjligt"`.

5. **Kortets dpw-display (rad 537-539)**: Visa det faktiska föreslagna värdet (inte "7 d/v" separat).

~15 rader ändrade.

