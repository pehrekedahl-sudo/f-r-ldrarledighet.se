

## Plan: Ändringsmedveten FK-guide

### Koncept

Guiden får ett nytt lager: en **"registrerad plan"** (baseline) som representerar vad som faktiskt är anmält hos FK. När planen ändras jämförs nuvarande steg mot baseline och guiden visar bara det som behöver uppdateras — men med ett klick kan användaren expandera till hela listan.

### Användarflöde

```text
┌─────────────────────────────────────────────┐
│  Anmäl till Försäkringskassan               │
│                                             │
│  ℹ️ Planen har ändrats sedan senaste        │
│     registreringen. 2 ändringar nedan.      │
│                                             │
│  [Visa bara ändringar ✓]  [Visa alla]       │
│                                             │
│  ── Ändringar att anmäla ──                 │
│  🔴 AVBOKA: Anna 2026-03-01 – 2026-04-30   │
│  🟢 NY:     Anna 2026-03-01 – 2026-05-31   │
│                                             │
│  ── Redan registrerat (dolt) ──             │
│                                             │
│  [Markera som registrerat hos FK]           │
│  [Ladda ner PDF]  [Stäng]                   │
└─────────────────────────────────────────────┘
```

### Mekanik

1. **Spara baseline**: När användaren bockat av alla steg (eller trycker "Markera som registrerat") sparas en kopia av nuvarande `fkSteps` i `localStorage` under nyckeln `fk_baseline_{planHash}`. Denna baseline representerar "det som FK vet om".

2. **Diffberäkning**: Vid öppning jämförs nuvarande `fkSteps` mot baseline. Varje steg klassificeras som:
   - **Oförändrad** — finns i båda med samma datum/dagar/nivå
   - **Ändrad** — finns i båda men med ändrad egenskap (datum, dagar, nivå)
   - **Ny** — finns bara i nuvarande plan
   - **Borttagen** — finns bara i baseline (behöver avbokas hos FK)

3. **Standardvy = bara ändringar**: Om en baseline finns och det finns diff-steg visas dessa som default. En toggle ("Visa alla" / "Visa bara ändringar") byter vy. Utan baseline eller utan ändringar visas den vanliga fullständiga listan.

4. **Visuell differentiering**:
   - Oförändrade steg: grå/dämpad stil med ✓-ikon
   - Nya steg: grön vänsterram + "NY"-badge
   - Ändrade steg: orange vänsterram + "ÄNDRAD"-badge + kort diff-text ("5→3 d/v")
   - Borttagna steg: röd vänsterram + "AVBOKA"-badge + genomstruken text

5. **"Markera som registrerat"**: Knapp i footern som sparar nuvarande steg som ny baseline och nollställer checklistan. Visas bara när alla steg är avbockade eller när användaren aktivt vill bekräfta.

### Tekniska ändringar

| Fil | Ändring |
|-----|---------|
| `src/components/FKGuideDrawer.tsx` | Lägg till baseline-hantering (spara/ladda från localStorage), diff-logik mellan baseline och nuvarande steg, toggle-vy (ändringar/alla), visuell diff-styling, "Markera som registrerat"-knapp. |

Ingen ny fil, inga DB-ändringar, inga nya beroenden. All persistens via `localStorage` (samma mönster som befintlig checklist-persistens).

