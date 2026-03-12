

## Analys — Två separata buggar

### Bugg 1: Ojämn uttagstakt mellan föräldrar
Rescue-algoritmen fördelar reduktionsveckor "proportionellt" baserat på total load (dpw × veckor). Om P1 är på 5 d/v i 40 veckor och P2 är på 6 d/v i 40 veckor, får P2 fler veckor — men båda sänks med 1 d/v → P1 hamnar på 4, P2 på 5. Gapet **bevaras** istället för att jämnas ut.

**Rätt beteende**: Sänk den förälder som har högre uttagstakt FÖRST tills båda är på samma nivå, sedan fördela resterande reduktioner lika.

### Bugg 2: Överjustering (fler sparade dagar än avsett)
Algoritmen uppskattar att X veckors reduktion behövs, bygger förslaget, och verifierar med `simulatePlan`. Om bristen redan är löst (shortage = 0) — bra. Men om den initiala uppskattningen redan är FÖR STOR (shortage = 0 redan med färre veckor), finns ingen mekanism att **minska** antalet reduktionsveckor. Säkerhetsnätet (loop E) kan bara lägga till fler veckor, aldrig ta bort.

Resultat: planen reducerar dpw mycket mer än nödvändigt → sparade dagar ökar kraftigt.

---

## Enkel förklaring

Tänk dig att två personer ska bära en tung väska uppför en trappa:

**Bugg 1**: Istället för att den starkare personen tar mer tills båda bär lika tungt, delar algoritmen bördan utifrån hur tungt de redan bär — så den som bär lite fortsätter bära lite.

**Bugg 2**: Algoritmen bestämmer sig för att ta bort 40 steg ur trappan, men det hade räckt med 15. Den kollar om det räcker, ser att det gör det, men tar aldrig tillbaka de 25 onödiga stegen.

---

## Plan

### Fix 1: Utjämnande allokering (`allocateReductionWeeks`)
I `src/lib/rescue/computeRescueProposal.ts`, ändra "proportional"-logiken:

1. Beräkna viktad genomsnittlig dpw per förälder (inte total load)
2. Om en förälder har högre dpw, tilldela reduktionsveckor till den föräldern FÖRST, tills dpw-nivåerna utjämnats
3. Fördela kvarvarande veckor jämnt (50/50)

Denna ändring påverkar bara `allocateReductionWeeks` funktionen (rad 105-164) och bara för `mode === "proportional"`.

### Fix 2: Krympningspass mot överjustering
I `computeRescueProposal`, efter loop E (rad 477), lägg till en "shrink pass": om `unfulfilledAfterFull <= 0` (redan löst), försök minska `perParentWeeks` med 1 vecka åt gången och verifiera att planen fortfarande går ihop. Stoppa när ytterligare minskning skulle återskapa brist.

Detta gör att förslaget använder **minimum antal reduktionsveckor** för att lösa bristen, inte fler.

### Filer som ändras
- `src/lib/rescue/computeRescueProposal.ts`
  - `allocateReductionWeeks`: utjämnande dpw-logik för proportionellt läge
  - `computeRescueProposal`: krympningspass efter loop E

