
Mål
- När ett DD-block tas bort ska perioden återgå till en giltig plan utan att båda vanliga blocken “växer in” i samma datumintervall.

Rotorsak
- `onDeleteOverlap` i `src/pages/PlanBuilder.tsx` tar idag bara bort DD-paret och kör sedan generell `normalizeBlocks`.
- Det räcker inte, eftersom de vanliga blocken under DD-perioden fortfarande finns kvar i datat; de är bara visuellt klippta i `PlanTimeline`.
- När DD försvinner blir därför båda föräldrarnas underliggande block synliga igen, och normaliseringen kan dessutom slå ihop/absorbera segment på ett sätt som bryter mot den logik du vill ha.

Plan
1. Ersätt den nuvarande delete-logiken med en dedikerad helper för DD-borttagning, t.ex. `resolveDeletedDoubleDays(...)`.
2. I hjälpen:
   - hitta hela DD-paret via `overlapGroupId`
   - läs DD-fönstret (`startDate`–`endDate`)
   - ta bort båda DD-blocken
   - materialisera vanliga block runt DD-fönstret till vänster/höger-segment för berörda föräldrar, så vi jobbar med samma “synliga” segment som användaren ser
   - tillämpa din regel:
     - om samma förälder har block på båda sidor och de har samma uttagstakt: slå ihop dem över DD-perioden
     - om samma förälder har block på båda sidor men olika uttagstakt: förläng det kortaste segmentet
     - annars: förläng den förälders angränsande segment som är kortast och låt den andra förälderns segment vara kvar som det är
   - om inga vanliga block angränsar DD-perioden: ta bara bort DD-paret utan extra återfyllnad
3. Kör efter detta bara en smal cleanup:
   - ta bort ogiltiga segment
   - slå ihop endast intilliggande identiska block
   - undvik att direkt köra den breda “smart”-normaliseringen för just detta flöde, så att vi inte återintroducerar oönskad förlängning
4. Koppla in hjälpen i `onDeleteOverlap` i `src/pages/PlanBuilder.tsx` och behåll befintlig save/persist-logik.

Tekniska detaljer
- Viktigt: `PlanBuilder` använder `normalizeBlocks` från `src/lib/adjustmentPolicy.ts`, inte `src/lib/normalizeBlocks.ts`. Fixen måste utgå från den faktiska körvägen.
- “Kortast” bör jämföras på de materialiserade segmenten runt DD-gapet, inte på dolda originalblock som sträcker sig genom DD-perioden.
- Vi ska inte förlita oss på `simulatePlan` för detta; den fångar inte affärsregeln “ingen vanlig cross-parent-overlap när DD tas bort”.

Regressioner att täcka
- DD i skarven mellan P1 och P2: bara kortaste sidan tar över perioden.
- Samma förälder på båda sidor med samma uttagstakt: blocken slås ihop över tidigare DD.
- Samma förälder på båda sidor med olika uttagstakt: bara kortaste segmentet förlängs.
- DD skapad manuellt utan angränsande vanliga block: båda DD-blocken försvinner rent.
- Ett klick på krysset tar bort hela DD-paret och lämnar ingen vanlig överlappning kvar i det borttagna intervallet.
