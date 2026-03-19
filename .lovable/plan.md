

## Analys: 5 scenarion avslöjar inkonsekvenser i beräkningslogiken

Jag har granskat hela flödet — wizard, simuleringsmotor, UI-visning — och kört igenom 5 mentala testscenarier. Resultatet: **det finns tre allvarliga inkonsekvenser** i hur verktyget räknar.

---

### Scenario 1: Förälder med 45 000 kr/mån, 5 d/v
- **Simuleringsmotorn** (calcDailyRates): Använder `SGI_CAP_ANNUAL = 592 000` (från PlanBuilder CONSTANTS) → cap = 592 000
- **UI-visningen** (computeBlockMonthlyBenefit): Använder `FK.sgiTakArslon = 573 000` (från fkConstants.ts) → cap = 573 000
- **parentSummary** (inne i simulatePlan): Hardkodar `573 000`

**Resultat**: Alla tre ger samma svar här, eftersom 45 000 × 12 = 540 000, som är under båda taken. **Ingen synlig bugg i detta scenario.**

### Scenario 2: Förälder med 50 000 kr/mån, 5 d/v
- Årsinkomst = 600 000 → **över båda taken**
- Simuleringsmotorn capar vid 592 000, beräknar dagersättning = (592 000 × 0.8 × 0.97) / 365 = **1 258 kr/dag**
- UI-visningen capar vid 573 000, beräknar dagersättning = (573 000 / 365) × 0.776 = **1 218 kr/dag**
- **Differens: ~40 kr/dag → ~870 kr/mån**

**BUG: Bannerns "Snitt/mån" (computedAvg) och "Ersättning per förälder"-sektionen visar lägre belopp än vad simuleringsmotorn faktiskt räknar med internt.**

### Scenario 3: Förälder med 48 000 kr/mån (576 000/år — mellan de två taken)
- Simuleringsmotorn: capar INTE (576 000 < 592 000) → full ersättning baserad på 576 000
- UI-visningen: capar vid 573 000 → ersättning baserad på 573 000
- parentSummary: säger `isAboveSgiTak = true` (576 000 > 573 000)
- **BUG: UI visar "du är över taket" men räknar med ett annat tak än motorn.**

### Scenario 4: Test-filen använder ett tredje tak
- `simulatePlan.test.ts` definierar `SGI_CAP_ANNUAL: 600 000` — ett tredje unikt värde
- **Inte en appbugg, men testerna verifierar inte samma verklighet som appen.**

### Scenario 5: Wizard vs PlanBuilder constants
- Wizard.tsx: `SGI_CAP_ANNUAL: 592 000` ✓ (matchar PlanBuilder)
- Men `computeBlockMonthlyBenefit` körs med FK.sgiTakArslon = 573 000 oavsett
- **Samma bugg som scenario 2-3 — taket som skickas in via CONSTANTS ignoreras av UI-beräkningen.**

---

### Rotorsak

Det finns **två parallella "sanningar" om SGI-taket**:

| Plats | Tak | Källa |
|-------|-----|-------|
| `fkConstants.ts` → `FK.sgiTakArslon` | 573 000 | Prisbasbelopp × 10 (2024) |
| `PlanBuilder.tsx` / `Wizard.tsx` → `CONSTANTS.SGI_CAP_ANNUAL` | 592 000 | Oklart — kanske 2025-prognos? |
| `simulatePlan.ts` → parentSummary | 573 000 | Hardkodat |
| `simulatePlan.test.ts` | 600 000 | Testspecifikt |

`computeBlockMonthlyBenefit()` och `computeParentBenefit()` i fkConstants.ts använder alltid 573 000 — de tar inte emot taket som parameter. Men simuleringsmotorns `calcDailyRates()` använder det inskickade `constants.SGI_CAP_ANNUAL` (592 000).

---

### Plan: Åtgärda alla inkonsekvenser

**1. Bestäm ETT korrekt SGI-tak**
- 2025 års prisbasbelopp är 58 800 kr → SGI-tak = 588 000 kr
- Uppdatera `FK.prisbasbelopp` och `FK.sgiTakArslon` i `fkConstants.ts` till korrekta 2025-värden

**2. Gör `computeBlockMonthlyBenefit` och `computeParentBenefit` parametriska**
- Ta emot SGI-tak som parameter istället för att hardkoda `FK.sgiTakArslon`
- Alternativt: låt alla ställen läsa från `FK.sgiTakArslon` (enklare)

**3. Ta bort `SGI_CAP_ANNUAL` från CONSTANTS i PlanBuilder och Wizard**
- Låt simuleringsmotorn alltid läsa `FK.sgiTakArslon`
- Eller: säkerställ att CONSTANTS.SGI_CAP_ANNUAL = FK.sgiTakArslon

**4. Fixa hardkodade 573 000 i `simulatePlan.ts` parentSummary**
- Rad 397-398: Ersätt med `constants.SGI_CAP_ANNUAL` eller `FK.sgiTakArslon`

**5. Uppdatera testet**
- `simulatePlan.test.ts`: Ändra `SGI_CAP_ANNUAL` till det korrekta värdet

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/lib/fkConstants.ts` | Uppdatera prisbasbelopp till 2025-värde, gör funktioner parametriska eller konsistenta |
| `src/pages/PlanBuilder.tsx` | Synka CONSTANTS.SGI_CAP_ANNUAL med FK.sgiTakArslon |
| `src/pages/Wizard.tsx` | Samma synkning |
| `src/lib/simulatePlan.ts` | Ta bort hardkodade 573 000, använd constants-parametern |
| `src/test/simulatePlan.test.ts` | Använd korrekt tak-värde |

