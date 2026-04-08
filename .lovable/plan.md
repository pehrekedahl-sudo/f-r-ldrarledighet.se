

# Balansera tvåkolumnslayouten: Justera planen ↔ Ersättning per förälder

## Problem
Ersättningssektionen (höger) tar ~300 rader och renderar avsevärt mer vertikal yta än Justera planen (vänster, ~130 rader). Kolumnerna ska matcha visuellt.

## Strategi
**Minska höger kolumn aggressivt** + **ge vänster kolumn samma visuella stil** (rounded-xl, shadow-sm, bg-card).

## Ändringar i `src/pages/PlanBuilder.tsx`

### 1. Visuellt synka vänster kolumn med höger
- Ändra vänster container från `rounded-lg border border-border bg-muted/30` till `rounded-xl border border-border bg-card shadow-sm overflow-hidden` — samma som höger
- Ge header-raden samma stil: liten ikon + rubriktext + `border-b`

### 2. Komprimera ersättnings-korten radikalt
- **Ta bort den stora siffra-raden** (`text-lg font-bold`) — visa istället en kompakt rad: `"32 615 kr/mån i snitt · Täcker 47%"` på en enda rad, text-sm
- **Coverage bar**: Ta bort helt — procent-talet i textraden ovan räcker
- **Block breakdown collapsible**: Behåll men minska trigger till inline-text utan extra whitespace
- **Top-up box**: Göm hela inputområdet bakom collapsible-triggern — visa bara `"Tillägg från arbetsgivare"` + Switch + sammanfattning (t.ex. "5 000 kr/mån, 6 mån") på en rad. Expanderar till inputs vid klick.
- **Budget collapsible**: Behåll som den är (redan kompakt)

### 3. Ta bort per-förälder header-padding
- Minska `py-2` → `py-1.5` på färgad header
- Minska `py-3 space-y-2.5` → `py-2 space-y-1.5` på content area

### 4. Footer
- Flytta FK-info-texten till en tooltip istället för en footer-rad, eller gör den till en single-line `text-[10px]` med minimal padding

### Resultat
Varje förälder-kort blir ~4-5 rader högt (namn+lön, siffra+coverage inline, perioder-trigger, top-up-trigger, budget-trigger) istället för ~12+ rader. Totala höjden halveras ungefär och matchar Justera planen.

Enda fil: **`src/pages/PlanBuilder.tsx`**

