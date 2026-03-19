

## Korrigera dubbeldagar-gräns baserat på barnets födelsedatum

### Budgetanalys — redan korrekt ✓

Nuvarande kod i `simulatePlan.ts` rad 255:
```
{ sicknessTransferable: 105, sicknessReserved: 90, lowest: 45 }
```
Per förälder: 105 + 90 + 45 = 240. Totalt: 480. Med 90 reserverade per förälder (180 totalt) och 210 fria SGI-dagar totalt (105 per förälder). **Detta stämmer redan med FK:s regler. Ingen ändring behövs.**

### Enda korrigeringen: Dubbeldagar 30 vs 60

Idag är max dubbeldagar hårdkodat till 30. Regeln är:
- Barn födda **före 1 juli 2024** → max 30
- Barn födda **efter 1 juli 2024** → max 60

`dueDate` finns redan i wizard-datan och sparas i planen.

### Ändringar

**1. `DoubleDaysDrawer.tsx`** — Acceptera `maxDoubleDays` som prop

Byt ut hårdkodade `30` på tre ställen (max-validering, input max-attribut, hjälptext) mot propvärdet.

**2. `PlanBuilder.tsx`** — Beräkna och skicka `maxDoubleDays`

Läs `dueDate` från wizard-datan. Om `dueDate >= "2024-07-01"` → 60, annars 30. Skicka som prop till `DoubleDaysDrawer`.

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/DoubleDaysDrawer.tsx` | Nytt prop `maxDoubleDays`, ersätt hårdkodade 30 |
| `src/pages/PlanBuilder.tsx` | Beräkna `maxDoubleDays` från `dueDate`, skicka till drawer |

