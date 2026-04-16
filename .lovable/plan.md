

## Bug: Top-up scope ignored in "Ersättning per förälder"

### Problem
När arbetsgivartillägget bara täcker en del av förälderns ledighet (t.ex. 3 mån av 12) visas tillägget ändå på **alla** perioder och i snittet. Det överskattar månadsersättningen och förvirrar användaren.

**Var i koden** (`src/pages/PlanBuilder.tsx`, ca rad 1715–1805):
- Snittberäkning `avgMonthly` lägger till `topUpScaled` på varje block utan att kolla om blocket ligger inom top-up-fönstret.
- Per-period-listan ("Visa N perioder") visar `fkMonthly + topUpScaled` på varje rad — även för perioder efter `topUpEndDate`.

### Lösning

**1. Beräkna top-up-fönster per block (proportionellt)**

Top-up gäller från `periodStart` (förälderns första block) i `tuMonths` månader → `topUpEndDate = addMonths(periodStart, tuMonths)`.

För varje block, räkna ut hur många dagar av blocket som faktiskt ligger inom `[periodStart, topUpEndDate)`:
- Helt inom fönstret → full top-up
- Helt utanför → 0 top-up  
- Delvis (top-up tar slut mitt i blocket) → top-up viktas med (täckta dagar / blockets dagar)

**2. Uppdatera snittberäkningen**

Använd det viktade top-up-beloppet per block i `totalWeightedBenefit`-summan istället för att alltid lägga på fullt `effectiveTopUp`.

**3. Förtydliga per-period-listan**

I varje rad visas `fkMonthly + (block-anpassat tillägg)`. Lägg till en liten visuell markör per rad:
- Period helt täckt av tillägg → liten dämpad text "+ tillägg" efter beloppet
- Period delvis täckt → "+ tillägg (delvis)"
- Period utan tillägg → ingen markör (bara FK-beloppet)

Detta gör det tydligt vilka månader som faktiskt får påslaget.

**4. Befintlig "✓ Hela perioden" / "X/Y mån"-indikator**

Den finns redan (rad 1927–1931) i top-up-konfigurationen och behöver inte ändras — men nu kommer beräkningarna ovanför också vara konsekventa med den indikatorn.

### Filer som ändras
- `src/pages/PlanBuilder.tsx` — beräkningsblocket runt rad 1715–1805 (snitt + per-period-render).

### Vad jag INTE ändrar
- Top-up-konfigurations-UI (switch, kr/%, månader) — fungerar redan.
- Simuleringsmotorn (`simulatePlan.ts`) — top-up är ett presentationslager, inte del av FK-beräkningen.

