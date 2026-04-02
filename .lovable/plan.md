

# Smarta multi-block-förslag i wizard steg 5

## Problem
Förslagsmotorn ger varje förälder **en enda uttagstakt**, vilket lämnar oanvända dagar (t.ex. "Maximalt uttag" ger 6 d/v åt båda → 64 dagar kvar). Autojusteringsmotorn i plan-buildern kan splitta block med olika takt för att optimera — samma flexibilitet saknas i wizarden.

## Lösning
Byt ut `computeSuggestion` från att returnera `{ p1: number, p2: number }` till att returnera en **blocklista per förälder** med olika uttagstakter. Målet: fyll budgeten så jämnt och nära målet som möjligt, med block i vecko-granularitet.

### Algoritm (alla tre strategier)

```text
Input: m1, m2 (månader), budget (480 / ~350 / 304)
Output: [ { parentId, daysPerWeek, weeks }[] ]

1. Beräkna weeks1 = m1 * 4.33, weeks2 = m2 * 4.33
2. Hitta uniform basrate = floor(budget / totalWeeks)
3. Beräkna kvarvarande dagar = budget - basrate * totalWeeks
4. Fördela resterande dagar som +1 dpw-block, 
   alternerande mellan föräldrarna (jämnast möjligt)
5. Varje förälder får: [{ dpw: basrate+1, weeks: X }, { dpw: basrate, weeks: Y }]
   där X + Y = förälderns totala veckor
```

Exempel med 8+8 månader, budget 480:
- totalWeeks ≈ 69.3 → basrate = 6, kvar = 480 - 6×69 = 66 dagar
- 66 extra veckor med +1 dpw → 33 veckor per förälder vid 7 d/v
- P1: 33v @ 7dpw + 2v @ 6dpw, P2: 33v @ 7dpw + 2v @ 6dpw → ~478 dagar

### UI-ändringar i steg 5

1. **Korten** visar en sammanfattning: "7 d/v i 33v + 6 d/v i 2v" istället för ett enda tal
2. **Slidersen behålls** som en "override" — om användaren drar i en slider avaktiveras det smarta förslaget och planen faller tillbaka till enkel uniform takt (som idag)
3. **Live-feedback** räknar dagarna från den aktiva planen (multi-block om förslag valt, uniform om slider justerad)
4. **State**: Nytt `suggestedSchedule` som håller blocklistan. Nollställs vid slider-drag.

### Dataflöde till Wizard.tsx

Utöka `WizardResult` med ett valfritt fält:

```ts
schedule?: { parentId: string; daysPerWeek: number; weeks: number }[];
```

Om `schedule` finns i `Wizard.tsx`, generera ett block per segment istället för ett enda block per förälder. Om det saknas (slider-override) fungerar det som idag.

## Teknisk omfattning

**Filer:**
1. `src/components/OnboardingWizard.tsx` — Ny `computeOptimalSchedule()`, uppdaterad UI, nytt state, utökad `WizardResult`
2. `src/pages/Wizard.tsx` — `handleWizardComplete` genererar multi-block plan från `schedule`

~80 rader ändrade/tillagda totalt.

