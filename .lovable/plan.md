

# Mobilanpassning av PlanBuilder

## Problem
På mobilskärmar (≤640px) blir layouten ihoptryckt på flera ställen:
1. **Tidslinjen**: Fast labelkolumn på 140px lämnar bara ~200px för blocken — omöjligt att dra/trycka
2. **Hero-bannern**: Föräldrapillerna med detaljtext (reserv · sjukpenning · lägsta) svämmar över
3. **Padding/spacing**: `px-6 py-8 space-y-8` är generöst för desktop men slösar yta på mobil
4. **Blocktext**: `text-[10px]` "3d/v" i tidslinjen är knappt läsbar på liten skärm

## Ändringar (desktop opåverkat)

### 1. `src/components/PlanTimeline.tsx` — responsiv tidslinje
- **Labelkolumn**: Gör `LABEL_WIDTH` responsiv — `80px` på mobil, `140px` på desktop. Använd en hook eller media query. På mobil visa bara förnamn (redan `truncate`), krympta prickar.
- **Blockhöjd**: Öka `rowHeight` från 60→72px på mobil för större touch-targets.
- **Horisontell scroll**: Lägg till `overflow-x-auto` på timeline-containern så att blocken behåller minsta bredd istället för att tryckas ihop. En `min-width: 500px` på den inre timeline-div:en säkerställer att blocken alltid är interaktiva.

### 2. `src/pages/PlanBuilder.tsx` — responsiv spacing och layout
- **Outer wrapper**: `px-6 py-8 space-y-8` → `px-3 py-4 space-y-5 sm:px-6 sm:py-8 sm:space-y-8`
- **Hero banner section**: `px-5 py-4` → `px-3 py-3 sm:px-5 sm:py-4`
- **Föräldrapills (rad ~953)**: Dölj detaljtext `(reserv · sjukpenning · lägsta)` på mobil med `hidden sm:inline`. Visa bara "X kvar".
- **KPI-rad**: Redan `flex-col sm:flex-row`, men minska gap på mobil: `gap-2 sm:gap-3`

### 3. `src/components/PlanTimeline.tsx` — touch-vänligare drag-handles
- Öka grip-handles bredd från `w-2` till `w-3 sm:w-2` på mobil för enklare drag-interaktion.

### Filer
| Fil | Ändring |
|---|---|
| `src/components/PlanTimeline.tsx` | Responsiv labelkolumn, min-width + scroll, större touch-targets |
| `src/pages/PlanBuilder.tsx` | Responsiv padding/spacing, dölj detaljtext på mobil |

Inga ändringar påverkar desktop (alla justeringar gated bakom `sm:` breakpoints).

