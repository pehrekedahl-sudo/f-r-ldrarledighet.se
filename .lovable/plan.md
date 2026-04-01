

# Uppdaterad plan: Spara dagar + live-feedback

## Korrigering av "Spara dagar"-logik

Målet är **176 dagar kvar TOTALT för paret** (inte per förälder). Paret har 390 SGI-dagar (195 × 2). Alltså får de spendera max **390 - 176 = 214 dagar** totalt.

Eftersom `computeSuggestion` returnerar samma dpw för båda föräldrar och `applyPreference` sätter samma värde:

```text
totalAvailable = 214 dagar att spendera (för båda tillsammans)
totalWeeks = weeks1 + weeks2  (varje förälders månader × 4.33)
saveDpw = max(3, floor(214 / totalWeeks))
```

Golv: 3 dagar/vecka — aldrig lägre förslag.

### Ändring i `computeSuggestion`

Funktionen behöver nu veta **båda föräldrarnas månader** för "save"-fallet. Uppdatera signaturen till att ta `months1` och `months2` separat, eller skicka in totalWeeks. "Income" och "balanced" fortsätter använda `totalMonths` som idag.

### Ändring i `applyPreference`

Skicka in m1 och m2 till `computeSuggestion` för "save"-beräkningen.

## Live-feedback under slidersen

En sammanfattningsrad efter båda slidersen:

```text
~56 800 kr/mån sammanlagt · 208 dagar förbrukas · 182 dagar kvar
```

- `daysConsumed = (dpw1 × m1 × 4.33) + (dpw2 × m2 × 4.33)` — avrundad till heltal
- `daysRemaining = 390 - daysConsumed`
- `monthlyBenefit = computeBlockMonthlyBenefit(income1, dpw1) + computeBlockMonthlyBenefit(income2, dpw2)` — visas bara om inkomst angetts
- Importera `computeBlockMonthlyBenefit` från `@/lib/fkConstants`

## Teknisk omfattning

**En fil:** `src/components/OnboardingWizard.tsx`

1. Uppdatera `computeSuggestion` — "save" använder `(m1 + m2)` veckor, 214 dagars budget, golv 3
2. Uppdatera `applyPreference` och `sug()` att skicka m1/m2
3. Importera `computeBlockMonthlyBenefit`
4. Lägg till live-feedback `<div>` efter slidersen (före `<details>`)

~35 rader ändrade/tillagda.

