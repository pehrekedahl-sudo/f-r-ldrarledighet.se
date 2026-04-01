

# Smart förslag för uttagstakt i steg 5

## Idé

En "Hjälp mig välja"-knapp under slidersen i steg 5. Vid klick expanderas tre valkort. Valet sätter slidern automatiskt — men med **adaptiv logik** baserat på hur länge varje förälder vill vara ledig (steg 4).

## Beräkningslogik

Varje förälder har ~195 SGI-dagar. Önskad längd i månader ger önskat antal veckor. Formeln:

```text
baseDpw = 195 / (months × 4.33)   // "perfekt passning"

Inkomst-fokus:  min(7, ceil(baseDpw + 1))   → fler dagar/vecka, dagarna tar slut snabbare
Spara dagar:    max(2, floor(baseDpw - 1))   → färre dagar/vecka, dagar finns kvar efteråt  
Balanserat:     clamp(round(baseDpw), 2, 7)  → ungefär jämnt
```

**Exempel:**
- 6 mån → base ≈ 7.5 → inkomst: 7, balans: 7, spara: 5
- 12 mån → base ≈ 3.75 → inkomst: 5, balans: 4, spara: 3
- 18 mån → base ≈ 2.5 → inkomst: 4, balans: 3, spara: 2

Varje förälder beräknas separat (de kan ha olika `months`).

## UI

Under slidersen, före `<details>`:

```text
┌──────────────────────────────────────────┐
│  💡 Hjälp mig välja                      │
└──────────────────────────────────────────┘

  ↓ expanderar ↓

┌──────────┐  ┌──────────┐  ┌──────────┐
│ 💰 Hög   │  │ ⚖️ Balans│  │ 🏖️ Spara │
│ inkomst  │  │          │  │ dagar    │
│          │  │          │  │          │
│ P1: 7d/v │  │ P1: 4d/v │  │ P1: 3d/v │
│ P2: 5d/v │  │ P2: 4d/v │  │ P2: 3d/v │
└──────────┘  └──────────┘  └──────────┘

  "Baserat på era önskade perioder föreslår vi…"
```

Korten visar de beräknade värdena per förälder. Vid klick sätts slidersen och en kort förklaring visas.

## Teknisk ändring

**Enda fil: `src/components/OnboardingWizard.tsx`**

1. Ny state: `showHelper: boolean`, `selectedPreference: string | null`
2. Ny funktion `computeSuggestion(months, preference)` → returnerar dpw (integer 2–7)
3. Tre klickbara kort under slidersen med `variant="outline"`, highlight vid valt
4. Vid klick: anropar `setDpw1` / `setDpw2` med beräknade värden
5. Användaren kan fortfarande justera manuellt efteråt

~80 rader tillagda, ingen ny fil.

