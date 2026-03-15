
Mest sannolik rotorsak (från loggar + kod):
- `computeRescueProposal` räknar först med aktiv överföring (`shortageBefore = 8`), men byter sedan till `transferList = []` när ingen ny överföring kan föreslås.
- Därför hoppar den till `shortageAfterTransfer = 48` trots `transferDays = 0`.
- Solvern försöker då kompensera en konstgjort större brist, slår i kapacitet (`46 veckor`) och lämnar `2 dagar` olösta → alla lägen blir utgråade.

Det här förklarar varför buggen känns kopplad till dubbeldagar men inte alltid är det: dubbeldagar ökar belastningen, men huvudfelet är att befintlig överföring tappas i Auto-justera-beräkningen.

Plan för fix (enkel och robust):

1) Fixa transfer-kedjan i solvern (huvudfix)
- Fil: `src/lib/rescue/computeRescueProposal.ts`
- Behåll alltid `existingTransfer` som baseline i alla `engineShortage(...)`-anrop.
- Bygg en “effective transfer”:
  - Om ingen tidigare överföring finns: använd ny föreslagen.
  - Om tidigare finns i samma riktning: öka beloppet (addera).
  - Om tidigare finns i annan riktning: behåll befintlig (ingen implicit reset).
- Använd denna effektiva transfer konsekvent i steg C, E, E2, E3, E4.
- Uppdatera metadata/logg så det framgår:
  - aktiv överföring före
  - extra föreslagen överföring
  - slutlig överföring som faktiskt simuleras

2) Förtydliga “verkligt omöjligt” läge i UI
- Fil: `src/components/FitPlanDrawer.tsx`
- När alla lägen är icke-viabla och `proposal.success === false`, visa tydlig orsakstext:
  - “Planen kan inte gå ihop med nuvarande dagar. Kvar att lösa: X.”
  - “Minska dubbeldagar/korta period/justera överföring.”
- Detta skiljer verklig dagbrist från upplevd UI-bugg.

3) Lägg regressionstest för just detta fel
- Ny testfil: `src/test/computeRescueProposal.test.ts`
- Testfall:
  - Med befintlig överföring ska `shortageAfterTransfer` aldrig bli sämre enbart för att `transferDays=0`.
  - Auto-justera ska inte nolla befintlig transfer implicit.
  - Scenario med verklig restbrist ska returnera `success=false` och korrekt `unfulfilledAfterFull`.

4) Verifiering efter implementation (E2E)
- Repro med tre dubbeldagars-block + aktiv transfer:
  - Öppna Auto-justera och kontrollera att bristen inte hoppar upp artificiellt.
  - Minst ett läge ska bli klickbart när planen faktiskt är lösbar.
- Separat scenario där dagar verkligen tar slut:
  - UI ska ge tydlig “verkligt omöjligt”-förklaring (inte bara utgråat utan kontext).

Teknisk notering:
- Console-varningen om `DialogContent` saknar `Description` är separat tillgänglighetsissue och påverkar inte själva solver-felet; kan tas i en snabb uppföljning.
