

# Komprimera ersättningssektionen

## Problem
Ersättning per förälder-kortet är mycket större än Justera planen-blocket. De ska matcha i storlek i tvåkolumnslayouten.

## Ändringar i `src/pages/PlanBuilder.tsx`

### 1. Komprimera visuella element
- **Header**: Minska padding från `px-5 py-4` till `px-4 py-2.5`, gör rubrik `text-sm`
- **Per-förälder header**: `px-5 py-3` → `px-4 py-2`
- **Content area**: `px-5 py-4 space-y-4` → `px-4 py-3 space-y-2.5`
- **Big number**: `text-2xl` → `text-lg`, ta bort onödig whitespace
- **Coverage bar**: `h-2.5` → `h-2`
- **Block breakdown**: Göm om fler än 3 block, visa bara summary-rad. Minska spacing `space-y-2` → `space-y-1`
- **Top-up section**: Minska padding `p-3 space-y-3` → `p-2.5 space-y-2`
- **Budget collapsible**: Behåll som den är (redan kompakt)
- **Footer**: `px-5 py-3` → `px-4 py-2`

### 2. Gör block-breakdown collapsible
Visa bara genomsnittlig ersättning, gör "Visa perioder" som en liten expanderbar länk så block-listan inte tar plats by default.

Alla ändringar i en fil: `src/pages/PlanBuilder.tsx`

