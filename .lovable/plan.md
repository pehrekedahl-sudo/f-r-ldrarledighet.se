

## Ändra rabattstrategi: BETA-kupong

### Bakgrund
Stripe stöder inte en enda kupong som automatiskt byter rabattnivå efter N inlösen. Lösningen är att skapa en kupong med `max_redemptions = 200` för 100 %-rabatten. När den är slut skapar vi en ny 50 %-kupong kopplad till samma kod.

### Steg

1. **Skapa 100 %-kupong** — "BETA – 200 första gratis", 100 % rabatt, max 200 inlösen. Koppla till kampanjkoden `BETA`.

2. **Förbered 50 %-kupong** — "BETA – 50 % rabatt", 50 % rabatt, ingen gräns. Denna aktiveras manuellt (eller av dig via Lovable) när de 200 första är förbrukade — då skapas en ny kampanjkod `BETA` kopplad till denna kupong.

3. **Avaktivera LANSERING50** *(valfritt)* — Om du vill stänga den gamla koden.

### Begränsning
Stripe tillåter inte två aktiva kampanjkoder med samma namn samtidigt. Så 50 %-kupongen skapas nu men kopplas till koden `BETA` först när 100 %-kupongen nått 200 inlösen. Jag kan skapa båda kupongerna nu och koppla den första till koden direkt.

### Uppdatera minne
Uppdaterar projektets dokumentation om rabattkoder så att `BETA` ersätter `LANSERING50`.

