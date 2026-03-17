

## FK-guide: Exportera plan till Försäkringskassan

### Vad vi bygger

En ny komponent `FKGuideDrawer` som visar en steg-för-steg-guide anpassad efter hur Försäkringskassans anmälningsformulär fungerar. Varje "steg" motsvarar en separat anmälan som användaren behöver göra på FK:s hemsida. Guiden kan laddas ner som PDF.

### FK:s anmälningsprocess

På FK anmäler man föräldrapenning per period. Varje anmälan kräver:
1. **Vilken förälder** som tar ut
2. **Period** (startdatum - slutdatum)
3. **Omfattning** (antal dagar/vecka, uttryckt som hela dagar: 7, 6, 5... eller del av dag)
4. **Nivå** — sjukpenningnivå eller lägstanivå

Om ett block har mixed nivåer (t.ex. 5 d/v sjukpenning + 2 d/v lägstanivå) behöver det delas upp i **två separata anmälningar** för samma period. Detta är den viktigaste anpassningen.

### Implementation

**Ny fil: `src/components/FKGuideDrawer.tsx`**

- Drawer som öppnas via en ny knapp "FK-guide" bredvid "Kopiera" i toolbaren (rad ~660 i PlanBuilder.tsx)
- Tar emot `blocks`, `parents` och `result` som props
- Logik:
  1. Sortera block kronologiskt, grupperade per förälder
  2. Splitta block med `lowestDaysPerWeek` i två separata FK-anmälningar (en för sjukpenningnivå, en för lägstanivå)
  3. Rendera varje anmälan som ett numrerat steg-kort med de exakta fälten FK:s formulär kräver
- Varje steg-kort visar:
  - Stegnummer + förälderns namn
  - "Startdatum: YYYY-MM-DD" 
  - "Slutdatum: YYYY-MM-DD"
  - "Antal dagar per vecka: X"
  - "Nivå: Sjukpenningnivå / Lägstanivå"
  - Kort instruktion ("Fyll i dessa uppgifter i formuläret 'Anmäl föräldrapenning' på forsakringskassan.se")
- Nedladdning: en "Ladda ner som PDF"-knapp som använder `window.print()` med en print-optimerad CSS-vy (enklast, kräver inga externa bibliotek) 
- Alternativt kan vi använda `html2canvas` + `jspdf` om du föredrar riktig PDF, men `window.print()` ger en bra PDF direkt i alla webbläsare

**Ändring i `src/pages/PlanBuilder.tsx`**

- Importera `FKGuideDrawer`
- Lägg till state `fkGuideOpen`
- Ny knapp "FK-guide" i toolbaren (rad ~660)
- Rendera `<FKGuideDrawer>` med relevanta props

### Steg-kort-design

```text
┌─────────────────────────────────────┐
│  Steg 1 av 5                       │
│  ● Clara                           │
│                                     │
│  Startdatum     2025-09-01         │
│  Slutdatum      2026-02-28         │
│  Dagar/vecka    7                  │
│  Nivå           Sjukpenningnivå    │
│                                     │
│  💡 Logga in på forsakringskassan.se│
│     → Anmäl föräldrapenning        │
│     → Fyll i uppgifterna ovan      │
└─────────────────────────────────────┘
```

### Filer som ändras/skapas

| Fil | Åtgärd |
|-----|--------|
| `src/components/FKGuideDrawer.tsx` | Ny |
| `src/pages/PlanBuilder.tsx` | Lägg till knapp + import + state |

