

## Drag-to-resize med dubbeldagshantering

### Svar på frågan

Bra fråga. Lösningen är att `onBlockResize`-callbacken i PlanBuilder alltid kontrollerar om det resizade blocket nu överlappar med ett dubbeldagsblock. Om det gör det, splittas det automatiskt i två delar — en före och en efter dubbeldagsblocket. Dubbeldagsblocket är alltid "överordnat" och rör sig inte.

### Logik i `onBlockResize`

```text
Före resize:
  [Block A: jan-mar]  [DD: apr]  [Block B: maj-jul]

Användaren drar Block A:s högerkant till juni:
  [Block A: jan-mar] → drag → [jan-jun]

Resultat efter resize-callback:
  [Block A: jan-mar]  [DD: apr]  [Block A-2: maj-jun]  [Block B: jul]
```

Steg i callbacken:
1. Uppdatera blockets nya start/end
2. Hitta alla DD-block (`isOverlap`) för samma förälder som överlappar med det nya intervallet
3. Om överlapp finns: splitta blocket runt varje DD-block med `addDays(dd.startDate, -1)` och `addDays(dd.endDate, 1)` som klippunkter
4. Behåll DD-blocken orörda
5. Kör normalisering + simulering

### Implementation

| Fil | Åtgärd |
|-----|--------|
| `src/components/PlanTimeline.tsx` | Drag-handtag (grip zones), pointer-events, datum-beräkning från pixelposition, ny prop `onBlockResize(blockId, newStart, newEnd)` |
| `src/pages/PlanBuilder.tsx` | `onBlockResize`-callback: uppdatera block, splitta runt DD-block, normalisera |

### Detaljer PlanTimeline.tsx

- Varje icke-överlappblock får 6px breda osynliga handtag på vänster/höger kant med `cursor: col-resize`
- `onPointerDown` → sparar `dragState: { blockId, edge: "start"|"end", startX, originalDate }`
- `onPointerMove` (window-lyssnare) → beräknar `deltaPercent → deltaDays`, visar tooltip med nytt datum
- `onPointerUp` → snäpper till närmaste måndag, anropar `onBlockResize`
- Överlappblock (DD) har inga drag-handtag

### Detaljer PlanBuilder.tsx — splitta runt DD

```text
function applyResizeWithDDSplit(blockId, newStart, newEnd, allBlocks):
  1. Hitta DD-block som överlappar [newStart, newEnd] och har samma parentId
  2. Sortera DD-block kronologiskt
  3. Bygg segment genom att "klippa" runt varje DD:
     - Segment före DD: { start: segStart, end: dd.start - 1 }
     - Hoppa över DD-perioden
     - Segment efter DD: { start: dd.end + 1, end: segEnd }
  4. Varje segment blir ett eget block med samma dpw/parent
  5. Ersätt originalblocket med segmenten
  6. Normalisera + simulera
```

Denna klipplogik liknar redan `clipBlocksForOverlaps` som finns i PlanTimeline (rad ~200) för visuell rendering — skillnaden är att den här gången appliceras den på faktiska block-state istället för bara visning.

