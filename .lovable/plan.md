

## Redesign av landningssidan — reviderad

### Struktur

**1. Hero** — Kompakt rubrik + undertext. Två knappar: "Skapa vår plan" (primär) + "Läs snabbguiden →" (länk till /foraldraledighet-101).

**2. Tre visuella snapshot-kort** (ersätter de gamla value props):
- **480 dagar** att dela på — delad cirkel-ikon
- **90 dagar** låsta per förälder — lås-ikon
- **12 år** att använda dem — kalender-ikon

Alla tre är konkreta, korrekta och relevanta för besökaren.

**3. Mockup-preview** — Stiliserad CSS-illustration av appens tidslinje med två färgkodade block (teal/korall) och månadsnamn. Visar vad verktyget gör utan att man behöver klicka.

**4. CTA-block** — "Redo att planera?" + knapp. Under: "Ny på föräldradagar? Läs vår guide →" till /foraldraledighet-101.

**5. Footer** — Behåll disclaimern.

### Fil som ändras

| Fil | Ändring |
|-----|---------|
| `src/pages/Index.tsx` | Bygg om med de tre nya korten, mockup-preview, nytt CTA-block |

