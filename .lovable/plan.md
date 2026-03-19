

## Buggfix: Block-resize skapar överlapp med syskonblock

### Rotorsak

`handleBlockResize` i PlanBuilder hanterar bara överlapp med **DD-block** (dubbeldagar). Den ignorerar helt **syskonblock** — andra vanliga block för samma förälder som redan upptar delar av det nya datumintervallet.

**Exempel:** Förälder P2 har Block A (mar–apr) och Block B (maj–jul). Användaren drar Block A:s slutkant till juni. Nu upptar Block A mar–jun och Block B maj–jul, med maj–jun dubblerad. Simuleringsmotorn konsumerar dagar från **båda** blocken under överlappet, vilket tömmer budgeten och driver sparade dagar till 0.

Det finns även ett sekundärt problem i PlanTimeline: för visuellt klippta block (runt DD) hittar wrappern **första** matchande segment istället för det som faktiskt dras, vilket ger fel datum för den icke-dragna kanten.

### Lösning

**1. `handleBlockResize` i PlanBuilder.tsx — trunkera syskonblock**

Efter att ha byggt de nya segmenten (redan splittade runt DD), gå igenom alla *andra* reguljära block för samma förälder. Om ett syskonblock överlappar med det resizade intervallet:
- Om syskonblocket är helt inuti det nya intervallet → ta bort det
- Om delvis överlapp → trunkera (flytta start/slutdatum så det slutar/börjar precis utanför)

```text
Före:  [Block A: mar–apr]  [Block B: maj–jul]
Drag A:s slut till jun:
  → Block A: mar–jun (nytt)
  → Block B: jul–jul (trunkerat, eller borttaget om det blir < 1 dag)
```

**2. PlanTimeline.tsx — hitta rätt segment vid klippning**

I `onBlockResize`-wrappern: när det finns flera visuella segment med samma `_originalId`, välj det segment som faktiskt dras baserat på `dragState.edge`:
- Om `edge === "end"` → välj segmentet med senast `endDate`
- Om `edge === "start"` → välj segmentet med tidigast `startDate`

### Filer som ändras

| Fil | Åtgärd |
|-----|--------|
| `src/pages/PlanBuilder.tsx` | Lägg till syskonblock-trunkeringslogik i `handleBlockResize` |
| `src/components/PlanTimeline.tsx` | Välj korrekt klippt segment i `onBlockResize`-wrappern |

