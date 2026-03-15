

## Plan: Alla visuella förbättringar (exkl. panelrubrik-byte)

### 1. Namnbyten i `src/pages/PlanBuilder.tsx`
- "Lägg till period" → "Lägg till block" (rad 697)
- "Dagöverföring" → "Överförda dagar" (rad 760)

### 2. Lägg till DD-knapp under tidslinjen (`src/pages/PlanBuilder.tsx`, rad 696-698)
Ändra från en ensam knapp till `flex gap-2` med två knappar:
- "+ Lägg till block" (befintlig)
- "+ Dubbeldagar" som öppnar `setDoubleDaysOpen(true)`

### 3. Ta bort "Så fungerar beräkningen" (`src/pages/PlanBuilder.tsx`, rad 664-677)
Radera hela `<Collapsible>`-blocket.

### 4. Hero → kompakt banner (`src/pages/PlanBuilder.tsx`, rad 574-661)
Slå ihop till en horisontell banner:
- Subtil gradient-bakgrund (`bg-gradient-to-r from-blue-50 to-emerald-50`)
- En rad med planens titel, slutdatum, snitt-ersättning
- Per-förälder pills med dagar kvar + mini-progressbar, färgkodade
- Varning/OK-status integrerad under bannern (kompaktare)
- Total höjd ~100px istället för ~300px+

```text
┌──────────────────────────────────────────────────────────┐
│  Anna & Erik – 2025–2026        Till 31 mar 2026         │
│  ~32 400 kr/mån                                          │
│  [●── Anna: 42 kvar ──]  [●── Erik: 87 kvar ──]         │
└──────────────────────────────────────────────────────────┘
  ⚠ Planen kräver justering  [Auto-justera] [Manuellt]
```

### 5. Tidslinje-uppgradering (`src/components/PlanTimeline.tsx`)
- **Större rader**: `rowHeight` 48→60, `overlapRowHeight` 36→44
- **Färgade labels**: Byt grå text till färgade badges (blå prick + namn / grön prick + namn) i label-kolumnen
- **"Idag"-markör**: Ny prop `todayDate?: string`. Om datumet faller inom tidsspannet, rita en vertikal streckad linje i orange/amber
- **Bättre block-styling**: `rounded-xl`, `shadow-md`, öka kontrast
- **Snyggare container**: `rounded-xl`, `shadow-sm`, vit bakgrund, subtil inner shadow

### Filer som ändras
- `src/pages/PlanBuilder.tsx` — banner, knappar, namnbyten, ta bort "Så fungerar beräkningen", skicka `todayDate` till timeline
- `src/components/PlanTimeline.tsx` — radhöjd, färgade labels, idag-markör, block-styling, container-styling

