

## Problemet: Dubbeldagar dubbelräknas i budgeten

### Hur det fungerar idag (buggen)

Simuleringsmotorn (`simulatePlan.ts`, rad 284-340) behandlar **alla block** sekventiellt — inklusive DD-block. Den har ingen logik för att undvika att samma datum räknas två gånger för samma förälder.

**Konkret exempel:**
Säg att Förälder A har ett vanligt block mån–fre (dpw 5) som täcker vecka 10–20. Dessutom finns ett DD-block för samma förälder, dpw 5, vecka 12–13.

Under vecka 12–13 händer detta:
1. Det vanliga blocket allokerar 5 dagar/vecka → drar från budgeten
2. DD-blocket allokerar **ytterligare** 5 dagar/vecka → drar IGEN från budgeten

Resultatet: Förälder A förlorar **10 dagar/vecka** från sin budget under DD-perioden, istället för **5**. Dagarna dubbelräknas.

### Bevis från konsolloggarna

Utan rescue-justering:
- **p1**: taken = 233 sjuk + 45 lägsta = **278 dagar** (av 240 budget + eventuella transfers)
- **p2**: taken = 151 sjuk + 0 lägsta = **151 dagar**
- **Totalt**: 278 + 151 = **429 dagar**

Om vi har 10 DD-dagar dubbelräknade för p1 → den verkliga förbrukningen borde vara ~268, inte 278. Det förklarar också varför rescue-algoritmen tror att det behövs fler reduktionsveckor — bristen är uppblåst.

### Korrekt beteende

Under en DD-period ska varje förälder bara förbruka dagar **en gång** per datum. DD-blocket ska markera att "båda föräldrarna tar ut denna dag", men om en förälder redan har ett vanligt block som täcker samma datum ska det INTE dubbelräknas.

### Fix

**Fil: `src/lib/simulatePlan.ts`**

I simuleringsloopen (rad 289-340), håll koll på vilka datum som redan förbrukats per förälder med ett `Set<string>`. Före varje dagallokering, kontrollera om datumet redan är förbrukat:

```
// Före loopen
const consumedDates = new Map<string, Set<string>>(); // parentId → Set<date>

// I loopen, före allokering:
const parentConsumed = consumedDates.get(b.parentId) ?? new Set();
if (parentConsumed.has(day.date)) continue; // Redan räknad
parentConsumed.add(day.date);
consumedDates.set(b.parentId, parentConsumed);
```

Detta säkerställer att varje datum bara förbrukar en dag från budgeten, oavsett hur många block (vanliga + DD) som täcker det.

### Filer som ändras
- `src/lib/simulatePlan.ts` — lägg till datum-deduplicering i simuleringsloopen (~5 rader)

