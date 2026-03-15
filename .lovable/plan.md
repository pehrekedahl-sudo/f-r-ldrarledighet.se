

## Plan: Lyft fram dagar kvar per förälder + ta bort "Justeringar & detaljer"

### Vad som ändras

**1. Hero-sektionen: Visa dagar kvar per förälder istället för totalt**

Nuvarande grid har 3 KPI:er: "Planen räcker till", "Genomsnittlig ersättning", "Dagar kvar totalt". Ändringen:
- Ersätt "Dagar kvar totalt" med **två separata KPI-kort**, ett per förälder, med namn och antal dagar kvar (t.ex. "Anna: 42 dagar kvar", "Erik: 87 dagar kvar")
- Ge varje förälder-KPI en subtil färgaccent (blå för p1, grön för p2) för att matcha tidslinjen
- Grid ändras från `grid-cols-3` till `grid-cols-2` på rad 1, sedan `grid-cols-2` rad 2 med per-förälder-kort

**2. Ta bort "Justeringar & detaljer"-collapsible (rad 855–1028)**

Hela `<Collapsible>` med id "adjust-section" tas bort. Funktionaliteten som finns där flyttas:

| Funktion | Ny plats |
|---|---|
| **"Lägg till period"**-knapp | Flyttas till under tidslinjen (vid sidan av timeline-sektionen) |
| **Omfördela dagar** | Redan tillgänglig via "Dagöverföring" i Justera-panelen → TransferDaysDrawer |
| **Budgetdetaljer per förälder** | Flyttas in i "Ersättning per förälder"-sektionen som en collapsible per förälder (redan finns "Visa månad för månad" där — lägg till budget-breakdown bredvid) |
| **Strategisk översikt** (total ersättning, snitt/mån) | Redan i hero (genomsnittlig ersättning) — tas bort som separat sektion |
| **Avancerade inställningar** (block editor) | Tas bort från vyn — blockredigering sker via tidslinjeklick + drawer |

**3. Uppdatera "Justera manuellt"-knappen**

Knappen som idag scrollar till "Justeringar & detaljer" ändras till att scrolla till "Justera planen"-panelen istället.

### Filer som ändras
- `src/pages/PlanBuilder.tsx` — hero-KPI:er, ta bort collapsible, flytta "Lägg till period" och budgetdetaljer

