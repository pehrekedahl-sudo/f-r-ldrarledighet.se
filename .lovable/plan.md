
Mål
- När ett DD-par tas bort i skarven mellan föräldrarna ska exakt en sida fylla gapet; ingen vanlig cross-parent-overlap får bli kvar.

Rotorsak
- `src/lib/resolveDeletedDoubleDays.ts` jobbar fortfarande på råblocken i datat, inte på de segment som faktiskt syns i tidslinjen.
- Hjälpen letar bara efter block som exakt slutar på `ddStart-1` eller börjar på `ddEnd+1`. Om ett vanligt block fortfarande sträcker sig genom DD-fönstret upptäcks det inte som vänster/höger-segment.
- Hjälpen muterar dessutom blockobjekt direkt innan cross-parent-logiken försöker “reverta”, så återställningen blir inte tillförlitlig.

Plan
1. Gör om `resolveDeletedDoubleDays(...)` så att den alltid startar från en deep copy och aldrig muterar originalobjekten in-place.
2. Materialisera gapet runt det borttagna DD-fönstret för berörda föräldrar:
   - splitta alla vanliga block som korsar DD-intervallet vid `ddStart`/`ddEnd`
   - arbeta vidare på vänster/höger-fragmenten i stället för på dolda originalblock
   - om andra DD finns för samma förälder, mät längd på de segment som faktiskt är synliga runt gapet
3. Tillämpa reglerna på dessa materialiserade segment:
   - samma förälder + samma uttagstakt => slå ihop över gapet
   - samma förälder + olika uttagstakt => förläng kortaste segmentet
   - cross-parent => välj exakt ett vinnande segment (kortast) och låt den andra förälderns segment förbli klippt
   - vid lika längd: använd en deterministisk tie-breaker så utfallet alltid blir samma
4. Bygg tillbaka blocklistan för de berörda föräldrarna från de uppdaterade fragmenten och kör bara lätt cleanup:
   - ta bort ogiltiga intervall
   - slå ihop endast direkt angränsande identiska block
   - ingen bred `normalizeBlocks` i just detta delete-flöde
5. Behåll kopplingen i `PlanBuilder` som den är (`onDeleteOverlap -> resolveDeletedDoubleDays -> savePlanInput`), men lägg regressionstester för:
   - DD i skarven mellan P1/P2 där råblocken spänner över DD-fönstret
   - samma förälder på båda sidor med samma DPW
   - samma förälder på båda sidor med olika DPW
   - inga angränsande segment
   - cross-parent med lika långa segment och stabilt utfall

Tekniska detaljer
- Filer: främst `src/lib/resolveDeletedDoubleDays.ts`, eventuellt en liten delad helper för segmentisering i `src/lib/...`, samt nya tester i `src/test/...`.
- Den viktiga skillnaden mot nuvarande kod är att den förlorande förälderns block måste vara splittrat/klippt redan innan vinnaren förlängs; annars ligger ursprungsblocket kvar över DD-gapet och skapar vanlig overlap så fort DD försvinner.
