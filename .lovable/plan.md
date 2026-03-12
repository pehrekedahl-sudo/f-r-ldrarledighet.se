

## Problem: Auto-justera förstör planen

### Grundorsaker

**Bugg 1: Rescue-algoritmen saknar `isOverlap` i sin Block-typ**
Rescue-modulens `Block`-typ (rad 29-37) saknar `isOverlap`-fältet. Det betyder att DD-block behandlas som vanliga block i alla beräkningar:
- `getReductionRangesForParent` (rad 246-247) filtrerar inte bort DD-block → algoritmen försöker sänka dpw i dubbeldagar
- `calcAvgDpw` och `parentCapacity` räknar DD-block i kapaciteten → allokeringen blir felaktig
- `applyDeterministicReductions` splittrar DD-block som om de vore vanliga block

**Bugg 2: Shrink-passet saknar constraint för sparade dagar**
Shrink-passet (rad 535-566) tar bara bort veckor tills `shortage <= 0`. Det har ingen kunskap om att antalet sparade dagar ska bevaras. Det tar bort reduktionsveckor som redan var inbakade från SaveDays-verktyget, vilket gör att sparade dagar ökar okontrollerat.

**Bugg 3: Överjustering pga felaktig kapacitetsberäkning**
Eftersom DD-block räknas in i `parentCapacity`, tror algoritmen att en förälder har fler veckor att reducera än vad som faktiskt finns. Resultatet: för aggressiv initial allokering som sedan inte krymps tillräckligt.

### Enkel förklaring

1. **Dubbeldagar**: Auto-justera ser inte att vissa block är "heliga" dubbeldagar. Den ändrar dem precis som vanliga block — som att klippa i en bild som inte ska röras.

2. **Sparade dagar**: Auto-justera vet inte hur många dagar du sparat. När den tar bort för många reduktionsveckor i sitt "krympningspass", ökar sparade dagar utan att den märker det.

### Plan

#### Fil: `src/lib/rescue/computeRescueProposal.ts`

**Ändring 1: Lägg till `isOverlap` i Block-typen**
Rad 29-37: Lägg till `isOverlap?: boolean` i Block-typen.

**Ändring 2: Filtrera bort DD-block i alla beräkningsfunktioner**
- `getReductionRangesForParent` (rad 247): Lägg till `&& !(b as any).isOverlap` i filtret
- `calcAvgDpw` (rad 199): Filtrera bort isOverlap-block
- `parentCapacity` (rad 332): Filtrera bort isOverlap-block
- `calcParentLoad` (rad 192): Filtrera bort isOverlap-block
- `applyDeterministicReductions` (rad 281): Skippa block med isOverlap

**Ändring 3: Bevara sparade dagar i shrink-passet**
I shrink-passet (rad 535-566), beräkna "baseline remaining days" innan shrink startar genom att köra `simulatePlan` på det nuvarande förslaget. Vid varje shrink-iteration, verifiera att `remaining days` inte ökar (dvs. sparade dagar bevaras). Om en borttagning av en reduktionsvecka skulle öka sparade dagar, skippa den.

### Konsekvenser
- DD-block lämnas helt orörda av Auto-justera
- Sparade dagar förblir oförändrade efter Auto-justera
- Justeringen blir mer träffsäker eftersom kapacitetsberäkningen utgår från rätt block

