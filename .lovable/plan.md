

## Plan: Komprimera layouten — minska vertikalt utrymme

Sidan har fem vertikala sektioner som stackas: Banner → Tidslinje → Justera planen → Ersättning per förälder → Action bar. Allt i en kolumn gör sidan onödigt lång. Här är förslaget:

### 1. Tvåkolumns-layout för "Justera planen" + "Ersättning per förälder"

Istället för att dessa två paneler stackas vertikalt, placera dem sida vid sida i en `grid grid-cols-1 lg:grid-cols-2 gap-4`. Detta halverar den vertikala ytan de tar och gör sidan mer balanserad.

```text
┌─────────────── Banner ───────────────┐
├─────────────── Tidslinje ────────────┤
│  [+ Lägg till block] [+ Dubbeldagar]│
├──────────────┬───────────────────────┤
│ Justera      │ Ersättning per       │
│ planen       │ förälder             │
│ (4 verktyg)  │ (per-parent cards)   │
│              │                      │
├──────────────┴───────────────────────┤
│  Kopiera · Dela · Rensa             │
└──────────────────────────────────────┘
```

### 2. Kompaktera "Justera planen"-raderna

Varje rad (Växlingsdatum, Sparade dagar, etc.) har en beskrivningstext + statustext + knapp. Minska padding från `py-4` till `py-3` och gör beskrivningstexterna kortare. Tar bort ~30px per rad.

### 3. Kompaktera "Ersättning per förälder"

Gör per-förälder-blocken mer kompakta: minska padding, visa block-perioderna inline istället för vertikalt stackade.

### 4. Action bar inline i bannern eller under grid

Flytta "Kopiera plan", "Dela med din partner", "Rensa plan" upp till bannerns högerrad eller gör dem till en kompakt footer-rad.

### Filer som ändras
- `src/pages/PlanBuilder.tsx` — grid-layout, padding-justeringar, action bar-flytt

