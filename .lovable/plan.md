

# Redesign: Ersättning per förälder — visuell uppfräschning & integrerad top-up

## Nuläge
Sektionen (rad 1151–1332) är en enkel bordered box med tiny text, en checkbox för top-up längst ner, och separata input-fält. Ser teknisk och torftig ut.

## Ny design

### 1. Per-förälder kort med visuell hierarki
Varje förälder får ett eget kort med:
- **Färgad header-bar** (teal/coral) med namn och total månadsinkomst under ledigheten
- **Stor siffra** för total ersättning per månad (FK + top-up summerat)
- **Visuell inkomstjämförelse**: en enkel horisontell bar som visar "ersättning vs lön" — grönt för täckt del, grått för förlorad del, med procent-label (t.ex. "Täcker 72% av din lön")
- **Block-breakdown** under baren: varje period med datum, d/v, och belopp — men snyggare med liten dot + timeline-känsla

### 2. Integrerad top-up per förälder
Istället för en gemensam checkbox längst ner:
- Varje förälders kort har en diskret toggle/switch "Tillägg från arbetsgivare" inuti kortet
- När aktiverad visas inline: **inputfält med toggle mellan kr/mån och % av lön**
- "% av lön" beräknar beloppet automatiskt från `monthlyIncomeFixed` (t.ex. 10% av 45 000 = 4 500 kr/mån)
- Varaktighetsfält (månader) visas som en kompakt inline-rad
- Täckningsinfo visas som en liten progress-pill under

### 3. Budget-collapsible — behåll men snygga till
Behåll collapsible "Budget" men ge den en subtil ikon och bättre spacing.

## Tekniska ändringar

### `src/pages/PlanBuilder.tsx`
- **State**: Lägg till `topUpMode: Record<string, "amount" | "percent">` och `topUpPercent: Record<string, number>` state
- **Ersätt sektionen** (rad 1151–1332) med ny komponentstruktur:
  - Yttre container: `rounded-xl border bg-card shadow-sm`
  - Header: "💰 Ersättning per förälder" med "(före skatt)" badge
  - Per förälder: färgat kort med income bar, block breakdown, integrerad top-up
- **Top-up toggle**: `Switch` komponent per förälder istället för gemensam `Checkbox`
- **kr/% toggle**: Två knappar (ToggleGroup) som växlar inputMode
- **Beräkning**: När mode="percent", `topUpMonthly = Math.round(monthlyIncome * topUpPercent / 100)`
- Ta bort global `showTopUp` state, ersätt med per-parent `topUpEnabled: Record<string, boolean>`

### Filer
- **`src/pages/PlanBuilder.tsx`** — enda filen som ändras. Omstrukturering av rad ~1151–1332 plus nya state-variabler.

