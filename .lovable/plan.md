
Ja — att checkout öppnas i en ny flik kan absolut vara det som triggar felet. Min genomgång av koden pekar på att problemet inte främst är Stripe i sig, utan att den nya fliken startar appen “kall”, och då hinner `PlanBuilder` skicka dig till onboarding innan inloggning och sparad plan har hunnit återställas.

1. Trolig rotorsak
- `PlanBuilder` väntar idag på `loadingPlan`, men inte på att auth ska bli färdigladdad.
- `useSavedPlan` sätter `loading=false` direkt när `user` är `null`.
- I en ny Stripe-flik är `user` tillfälligt `null` medan sessionen återläses.
- Då körs `loadFromAnySource()` för tidigt, ingen plan hittas direkt, och appen gör `navigate("/wizard")`.
- Det finns också en andra svaghet: sparningen före checkout är “fire-and-forget”, så DB-sparningen kan avbrytas när sidan lämnas.

2. Varför ny flik gör detta värre
```text
Nuvarande flöde:
ny Stripe-flik -> app bootar om -> user=null ett ögonblick
-> loadingPlan=false
-> ingen DB-plan hinner laddas
-> redirect till /wizard
```

I originalfliken finns ofta state redan i minnet, så buggen märks mindre där. I den nya fliken måste allt återställas från början.

3. Det jag skulle ändra
- Vänta på både auth-laddning och plan-laddning innan beslut om redirect.
- Göra checkout-sparningen awaitad så planen säkert skrivs till backend innan Stripe öppnas.
- Visa ett tydligt mellanläge som “Återställer din plan…” istället för att hoppa till onboarding direkt.
- Minska risken för race conditions genom att inte ha dubbla auth-laddningar i olika hooks.

4. Konkret implementationsplan
- `src/pages/PlanBuilder.tsx`
  - Byt till `const { user, loading: userLoading } = useUser();`
  - Stoppa initial load-effekt om `userLoading || loadingPlan`
  - Redirecta till `/wizard` först när båda är färdiga och ingen plan faktiskt finns
  - Lägg in enkel loader/placeholder under väntetiden
- `src/hooks/useSavedPlan.ts`
  - Gör hooken robust mot att auth fortfarande laddas
  - Lägg till en awaitbar save-funktion för kritiska navigationer
  - Uppdatera gärna lokalt `dbPlan` direkt efter lyckad upsert
- `src/hooks/useHasPurchased.ts`
  - Förenkla så den återanvänder redan laddad användare istället för att starta en separat auth-cykel
- Checkout-flödet i `src/pages/PlanBuilder.tsx`
  - `await` spara plan innan `window.location`/`window.open`
  - Behåll nuvarande `returnUrl`, men gör återkomsten robust även när Stripe kommer tillbaka i ny flik

5. Vad detta bör lösa
- Du ska inte längre kastas till nytt onboarding-flöde bara för att Stripe kommer tillbaka i en ny flik.
- Planen ska kunna återställas från backend även om lokal state saknas.
- Flödet blir stabilare både efter betalning och vid vanlig omladdning.

6. Tekniska detaljer
```text
Efter fix:
ny flik -> userLoading=true -> vänta
        -> session återställd
        -> saved_plans hämtas
        -> plan hittad
        -> stanna i /plan-builder
```
- Ingen ny tabell behövs; `saved_plans` finns redan.
- Det här är en riktig race condition i nuvarande kod och bör fixas oavsett om Stripe öppnas i samma eller ny flik.

7. Verifiering efter implementation
- Skapa en plan i wizarden
- Logga in via låst CTA
- Gå till checkout
- Kom tillbaka från Stripe i den nya fliken
- Bekräfta att:
  - du stannar på `/plan-builder`
  - planen laddas tillbaka
  - onboarding inte visas
  - en vanlig sid-omladdning fortfarande behåller planen
