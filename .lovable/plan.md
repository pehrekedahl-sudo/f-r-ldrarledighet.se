

# Pre-launch checklista – vad bör städas

Jag har gått igenom hela kodbasen. Här är det jag hittat:

---

## 1. Rensa console.log (4 filer, ~20 rader)

Debug-loggar som inte ska synas i produktion:

- **PlanBuilder.tsx** — `console.group('[PLAN]')` + flera `console.log`
- **computeRescueProposal.ts** — `console.group('[RESCUE]')` + ~8 st `console.log`
- **HandoverDrawer.tsx** — 2 st `console.log`
- **TestEngine.tsx** — 3 st `console.log`

**Fix:** Ta bort alla console.log/console.group/console.groupEnd i dessa filer.

---

## 2. Dölj /test-engine för riktiga användare

`/test-engine` är en intern debug-sida som är fullt tillgänglig för alla. Den visas inte i navigationen (bra), men går att nå via URL.

**Fix:** Villkora routen med `isDev`-flaggan, eller ta bort den helt från produktions-routern.

---

## 3. OG/meta-taggar i index.html har Lovable-defaults

- `og:description` = "Lovable Generated Project"
- `og:image` = Lovable-logotyp
- `twitter:site` = "@Lovable"
- `twitter:image` = Lovable-logotyp
- `meta name="author"` = "Lovable"
- Kvar-kommentarer: `<!-- TODO: Set the document title -->` och `<!-- TODO: Update og:title -->`

**Fix:** Sätt korrekta värden, ta bort TODO-kommentarer.

---

## 4. NotFound-sidan är på engelska

Texterna "Oops! Page not found" och "Return to Home" borde vara på svenska.

**Fix:** Byt till "Sidan kunde inte hittas" / "Tillbaka till startsidan".

---

## 5. `html lang="en"` borde vara `"sv"`

Sidan är helt på svenska.

**Fix:** Ändra `<html lang="en">` till `<html lang="sv">` i index.html.

---

## 6. DevNav importeras alltid

`DevNav`-komponenten importeras alltid i App.tsx även om den bara renderas med `?dev`. Den lägger till bundle-storlek i onödan.

**Fix:** Lazy-importera DevNav, eller ta bort importen och villkora med `React.lazy`.

---

## 7. Ingen error boundary

Om något kraschar ser användaren bara en vit sida.

**Fix:** Lägg till en React Error Boundary runt `<AppContent />` som visar ett vänligt felmeddelande med en "Börja om"-knapp.

---

## 8. Mobilnavigation saknas

TopNav har bara horisontella länkar — på smal skärm riskerar de att brytas eller klippas.

**Fix:** Dölj länkarna bakom en hamburger-meny på mobil (`md:flex hidden`), eller verifiera att det ser OK ut.

---

## 9. Ingen favicon

Sidan använder default-favicon. Bör ha en egen.

---

## Sammanfattning – prioriteringsordning

| Prio | Åtgärd | Risk om den missas |
|------|--------|--------------------|
| 1 | Rensa console.log | Ser oproffsigt ut i DevTools |
| 2 | Fixa OG-taggar + ta bort TODO-kommentarer | Delningar visar "Lovable Generated Project" |
| 3 | `lang="sv"` | Tillgänglighet + SEO |
| 4 | Dölj /test-engine | Intern debug-sida synlig |
| 5 | Översätt NotFound till svenska | Inkonsekvent språk |
| 6 | Error boundary | Vit sida vid krasch |
| 7 | Mobilnav | Klippt nav på smal skärm |
| 8 | Lazy-load DevNav | Marginell bundle-optimering |
| 9 | Favicon | Proffsig framtoning |

Vill du att jag fixar allt, eller vill du välja vilka punkter jag ska ta?

