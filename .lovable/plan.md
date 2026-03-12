

## Problem
Verktygen "Sparade dagar" och "Auto-justera" krockar: Auto-justera skapar ojämn uttagstakt och ändrar sparade dagar-siffror.

## Åtgärder

### 1. Auto-justera: respektera fördelningsläge med fallback
**Fil:** `src/lib/rescue/computeRescueProposal.ts`

Istället för att helt ta bort override (riskabelt) — ändra logiken till:
1. **Börja** med användarens valda läge (proportionellt/dela lika/specifik förälder)
2. **Verifiera** med simulatePlan
3. **Om det inte löser bristen**: falla tillbaka till deficit-parent-läget (nuvarande beteende)

Konkret: rad 432 ändras från att alltid overridea till att först prova `mode`, och om säkerhetsnätet (loop E) inte löser det efter MAX_EXTEND iterationer, köra om med `deficitParentId`.

### 2. Synka baslinjen efter Auto-justera
**Fil:** `src/pages/PlanBuilder.tsx`

Lägg till `setOriginalBlocks(normalized)` på rad 1084 (efter `setBlocks(normalized)`) i FitPlanDrawer onApply. Detta gör att Sparade dagar-verktyget ser rätt utgångsläge nästa gång det öppnas.

### Filer som ändras
- `src/lib/rescue/computeRescueProposal.ts` — try-user-mode-first med fallback
- `src/pages/PlanBuilder.tsx` — synka originalBlocks efter rescue apply

