

# Pop-up-tutorial för PlanBuilder

## Översikt
En stegvis "spotlight"-tutorial som highlightar nyckelområden i planeringsvyn med förklaringar om vad användaren kan göra och vilken effekt det har. Visas automatiskt vid första besöket, kan stängas och återkallas via en subtil knapp.

## Arkitektur

### Ny komponent: `src/components/PlanTutorial.tsx`
En modal-liknande overlay med spotlight-effekt. Varje steg pekar på ett element via `id`-attribut och visar en tooltip-liknande ruta intill det.

**Stegen (5 st):**

1. **Hero-bannern** (`id="plan-hero"`) — "Här ser du en sammanfattning av er plan: hur länge pengarna räcker, snittinkomst per månad, och hur många dagar varje förälder har kvar. Du kan dela planen eller börja om."

2. **Tidslinjen** (`id="plan-timeline"`) — "Tidslinjen visar era ledighetsblocki kronologisk ordning. Dra i kanterna för att ändra längd, eller klicka på ett block för att redigera dagar per vecka. Det påverkar direkt hur länge dagarna räcker och vad ni får i ersättning."

3. **Justera planen** (`id="adjust-panel"`) — "Här finjusterar ni planen: ändra växlingsdatum mellan föräldrar, spara dagar som reserv, överföra dagar sinsemellan eller lägga till dubbeldagar. Varje ändring uppdaterar tidslinjen och ersättningen direkt."

4. **Ersättning per förälder** (`id="benefit-panel"`) — "Här ser ni vad varje förälder får utbetalt per månad i snitt och hur mycket av lönen det täcker. Ni kan även lägga till arbetsgivarens tillägg (löneuppfyllnad) för att se den riktiga nettoskillnaden."

5. **Klart!** (centrerad, ingen spotlight) — "Nu är ni redo att planera! Ni kan alltid ta fram den här guiden igen via ❓-knappen."

**Teknik:**
- Varje steg identifierar sitt mål-element via `document.getElementById(targetId)`
- `getBoundingClientRect()` + scroll till elementet → rita en halvtransparent overlay med ett "hål" (CSS clip-path eller box-shadow `0 0 0 9999px rgba(0,0,0,0.5)`) runt mål-elementet
- Tooltip-ruta positioneras under/bredvid elementet med pil
- Navigering: "Nästa" / "Hoppa över" / steg-indikator (1/5 prickar)
- Vid sista steget: "Klar!"-knapp

**State:**
- `localStorage` key `planTutorialSeenV1` — sätts till `true` efter avslut/skip
- PlanBuilder kontrollerar detta vid mount: om ej sett → öppna tutorial
- Exponerar `open`/`onClose` props

### Ändringar i `src/pages/PlanBuilder.tsx`
- Lägg till `id`-attribut på 4 sektioner:
  - `id="plan-hero"` på hero-bannern (rad ~907)
  - `id="plan-timeline"` på tidslinje-sektionen (rad ~997)
  - `id="adjust-panel"` finns redan (rad ~1059)
  - `id="benefit-panel"` på ersättnings-sektionen (rad ~1209)
- Importera och rendera `<PlanTutorial>` med state (`showTutorial` / `setShowTutorial`)
- Lägg till en ❓-knapp i hero-bannern (bredvid "Dela plan" / "Rensa") som sätter `setShowTutorial(true)`

### Filer
| Fil | Ändring |
|---|---|
| `src/components/PlanTutorial.tsx` | Ny — spotlight-tutorial-komponent |
| `src/pages/PlanBuilder.tsx` | Lägg till id-attribut, importera tutorial, ❓-knapp |

### Design
- Overlay: `bg-black/60` med clip-path-hål runt aktuellt element
- Tooltip-ruta: `bg-card rounded-xl shadow-lg border p-4 max-w-sm`
- Steg-prickar: små cirklar, aktiv = `bg-primary`, inaktiv = `bg-muted`
- ❓-knapp: `variant="ghost" size="sm"` med `HelpCircle`-ikon, placerad i hero-bannerns actions-rad
- Smooth scroll till element vid stegbyte via `scrollIntoView({ behavior: "smooth", block: "center" })`

