

## Analys: Varför säger Auto-justera 46 veckor?

### Vad jag kan se och inte kan se

Jag kan inte se din exakta plandata (block, datum, dpw) utan att lägga till loggning i koden. Därför kan jag inte räkna manuellt just nu. Men jag kan resonera kring koden och identifiera **troliga buggar som blåser upp bristen**.

### Matematiken i korthet

Varje förälder har en budget på **240 dagar** (105 överförbara + 90 reserverade + 45 lägstanivå) = **480 dagar totalt**.

Simuleringsmotorn (`simulatePlan`) räknar varje veckodag som konsumeras av ett block. T.ex. ett block med dpw 5 i 30 veckor = 150 dagar.

**Bristen** = antal dagar planen försöker förbruka minus 480.

Rescue-algoritmens antagande: **1 veckas reduktion (-1 dpw) = 1 sparad dag**. Det stämmer matematiskt — om du går från 5→4 dagar/vecka i en vecka sparar du exakt 1 dag.

### Varför du troligen har rätt

Det finns **en trolig bugg** som kan blåsa upp bristen:

**`MAX_EXTEND = 5` är ett tak, inte en beräkning.** Algoritmen börjar med `ceil(shortageAfterTransfer)` veckor, applicerar dem, och kontrollerar om `unfulfilledDaysTotal === 0`. Om det fortfarande finns brist pga. avrundning/blockgränser, lägger den till max 5 veckor till. Om den ALDRIG når 0, returnerar den `success: false` — **oavsett hur många veckor den provat**.

Det som visas i UI:t ("46 veckor") kan alltså vara antalet veckor den PRÖVADE, inte det antal som faktiskt behövs. Det kan vara att bristen egentligen är t.ex. 8 dagar, men algoritmens reduktioner inte sparar exakt 1 dag/vecka pga. blockgränser, så den testar 8+5=13 veckor, aldrig löser det, och visar ändå 46 i UI:t (eller vad den nu visar).

### Plan: Lägg till transparensloggning

Jag lägger till `console.log`-satser som skriver ut exakt:

**Fil: `src/lib/rescue/computeRescueProposal.ts`**
- Rad ~353: Logga `shortageBefore` (total brist innan någon åtgärd)
- Rad ~388: Logga `shortageAfterTransfer` och `transferDays`
- Rad ~460: Logga per förälder: `perParentWeeks`, `parentCapacity`, `calcAvgDpw`
- Rad ~493: Logga `unfulfilledAfterFull` och `extendIters` efter extend-loopen
- Rad ~580: Logga slutresultat: `weeksTotalApplied`, `success`

**Fil: `src/pages/PlanBuilder.tsx`**
- Rad ~295: Logga `result.unfulfilledDaysTotal`, per förälder: `taken.sickness`, `taken.lowest`, `remaining.*`
- Logga totalt förbrukade dagar per förälder

**Dessutom: Höj `MAX_EXTEND` från 5 till 20** — 5 iterationer är för konservativt.

### Filer som ändras
- `src/lib/rescue/computeRescueProposal.ts` — debug-loggning + MAX_EXTEND 5→20
- `src/pages/PlanBuilder.tsx` — loggning av simuleringsresultat

Med dessa loggar kan vi öppna konsolen och se exakt: "Planen förbrukar X dagar av 480, bristen är Y dagar, transfer löser Z av dem, reduktion behövs för Y-Z dagar." Då kan vi bevisa om 46 veckor är korrekt eller om algoritmen räknar fel.

