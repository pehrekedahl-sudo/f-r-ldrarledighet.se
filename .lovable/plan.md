

## Kompensera dubbeldagar: val mellan sparade dagar eller uttagstakt

### Problemet

När dubbeldagar läggs till konsumerar de extra dagar från budgeten, vilket minskar sparade dagar automatiskt. Användaren bör kunna välja hur detta kompenseras.

### Lösning

Lägg till ett val i `DoubleDaysDrawer` med två alternativ (radio buttons):

1. **"Minska uttagstakten" (default)** — efter att DD-blocken lagts till, kör SaveDaysDrawer-logiken (DPW-reducering) för att återställa sparade dagar till nivån innan DD lades till.
2. **"Ta av sparade dagar"** — nuvarande beteende, DD läggs till utan kompensation.

### Implementation

**`src/components/DoubleDaysDrawer.tsx`**

- Lägg till ny prop: `blocks`, `constants`, `transfer` (behövs för att beräkna kompensation)
- Ny state: `compensationMode: "reduce-dpw" | "use-saved"` (default `"reduce-dpw"`)
- Radio group under befintliga fält
- Ny prop `onApplyWithCompensation`: callback som returnerar `{ newBlocks, compensationMode }` istället av bara `newBlocks`

**`src/pages/PlanBuilder.tsx`**

- Uppdatera `DoubleDaysDrawer` onApply-callbacken:
  - Om `compensationMode === "reduce-dpw"`: efter att DD-blocken lagts till, beräkna hur många extra dagar som konsumeras, kör sedan SaveDaysDrawer-motorns steg-logik för att sänka DPW på övriga block tills sparade dagar återställs
  - Om `compensationMode === "use-saved"`: nuvarande beteende (bara lägg till blocken)
- Återanvänd den befintliga `computeTargetBlocks`-liknande logiken från SaveDaysDrawer (extrahera till delad funktion eller duplicera inline)

### UI i drawern

Under befintligt "Startdatum"-fält:

```text
┌─────────────────────────────────────┐
│  Hur ska dubbeldagarna finansieras? │
│                                     │
│  ◉ Minska uttagstakten             │
│    Sänker dagar/vecka på övriga    │
│    block för att behålla sparade   │
│    dagar.                          │
│                                     │
│  ○ Ta av sparade dagar             │
│    Dubbeldagarna minskar dina      │
│    sparade dagar.                  │
└─────────────────────────────────────┘
```

### Filer som ändras

| Fil | Åtgärd |
|-----|--------|
| `src/components/DoubleDaysDrawer.tsx` | Lägg till radio group + skicka med valet |
| `src/pages/PlanBuilder.tsx` | Hantera kompensationslogik i onApply-callback |

