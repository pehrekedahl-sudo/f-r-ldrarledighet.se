

## Plan: PDF som speglar guiden visuellt

### Problem
Nuvarande PDF-export bygger en helt separat HTML-sträng med egna stilar som inte matchar guiden. Resultatet ser annorlunda ut.

### Lösning
Istället för att bygga egen HTML, klona det faktiska innehållet i `printRef` och öppna det i ett nytt fönster med Tailwind-liknande stilar. Dessutom:
- Dölja interaktiva element (checkboxar, knappar, "Nästa"-badges) via `no-print`-klassen
- Visa print-checkrutor (den dolda `checkbox-print`-diven) istället
- Behålla samma färger, avstånd, border-left-styling och badge-design

### Teknisk ändring

**`src/components/FKGuideDrawer.tsx`** — omskriven `handlePrint`:

1. Klona `printRef.current.innerHTML` som bas-HTML
2. Injicera en `<style>`-block som:
   - Döljer `.no-print` (checkboxar, knappar, "Nästa"-badges)
   - Visar `.checkbox-print` som synliga rutor
   - Kopierar de viktigaste Tailwind-klasserna som används i guiden (rounded-lg, font-bold, bg-färger, border-left, flex, gap, badges med bakgrundsfärger)
   - Lägger till sammanfattningstabellen överst (som idag)
   - Sätter typsnitt till DM Sans / system-ui
3. Behålla befintlig `window.open` + `print()`-mekanism

Ingen ny fil, inga nya beroenden. Enbart en omskrivning av `handlePrint` (rad 250–292) samt utökning av print-specifika CSS-klasser i den injicerade style-taggen.

