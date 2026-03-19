

## Polera verktyget — designpaket

Appen fungerar bra men har några saker som gör att den inte känns "färdig": DevNav syns i produktion, landningssidan saknar visuell identitet, wizarden och plan-buildern har inkonsekvent typografi, och det saknas små detaljer som loading states och micro-interactions.

### 1. Ta bort DevNav från produktion
Dölj `<DevNav />` helt — den ska inte synas för användare. Antingen ta bort den eller villkora den bakom en `?dev=true` query-parameter.

### 2. Uppgradera landningssidan (Index.tsx)
- Lägg till en subtil bakgrundsaccent (jade-to-terracotta gradient liknande bannern i plan-buildern)
- Använd `DM Serif Display` konsekvent på rubriker (redan på plats men `font-bold` borde vara `font-normal` för att matcha typografi-systemet)
- Lägg till en enkel footer med "Simulering — kontrollera alltid mot Försäkringskassan"
- Ge feature-korten ikoner (CalendarCheck, Coins, Share2) för visuell tyngd

### 3. Konsekvent typografi i PlanBuilder
- Byt hero-rubriken (`text-2xl font-bold`) i redigeringsläge till `DM Serif Display` med `font-normal`, som resten av appen
- Byt sektionsrubriker (`text-lg font-semibold`) till en enhetlig stil med `font-medium` och `tracking-tight`

### 4. Tom-tillstånd och loading
- Lägg till en skeleton/shimmer-effekt i laddningsvyn istället för bara "Laddar plan…"
- Ge FK-guiden en tom-ikon (ClipboardList) i den nya sektionen längst ner

### 5. Micro-interactions och finish
- Lägg till `transition-all duration-200` på alla interaktiva kort i "Justera planen"-panelen (redan `hover:bg-accent/50` men saknar smooth transition)
- Ge "Se resultat"-knappen i redigeringsläget en gradient som matchar branding (jade)
- Avrunda FK-sektionen längst ner med en ikon och svagare border (`border-dashed`)

### 6. Mobilanpassning
- Bannern i plan-buildern: stacka KPI:er vertikalt under `sm` breakpoint istf att wrappa konstigt
- Footer-knappar i drawers: se till att de inte svämmar över på smala skärmar

### Filer som ändras

| Fil | Åtgärd |
|-----|--------|
| `src/App.tsx` | Villkora DevNav bakom `?dev` |
| `src/pages/Index.tsx` | Ikoner, gradient-bakgrund, footer, typografi |
| `src/pages/PlanBuilder.tsx` | Typografi, loading skeleton, FK-sektion ikon, knapp-gradient, mobilfix |
| `src/index.css` | Ev. ny utility-klass för branded gradient |

