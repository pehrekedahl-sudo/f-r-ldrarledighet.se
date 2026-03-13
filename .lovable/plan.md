

## Problem: "Block ej hittat" vid klick på tidslinjen

### Grundorsak

I `PlanTimeline.tsx` rad 215 skapar `clipBlocksForOverlaps` nya block-objekt med modifierade ID:n:
```
id: `${b.id}-clip-${seg.start}`
```

När du klickar på ett sådant block skickas detta klippta ID (t.ex. `b1-clip-2025-08-15`) till `onBlockClick`. I `PlanBuilder.tsx` rad 1044 görs sedan:
```typescript
blocks.find(b => b.id === editingBlockId)
```

Inget block i `blocks`-state har det klippta ID:t → `null` returneras → drawern visar "Block ej hittat".

Dessutom visas alltid Claras namn i titeln eftersom `parentId` från det klippta blocket aldrig laddas — drawern faller tillbaka på `parents[0]` (Clara).

### Fix

**Fil: `src/components/PlanTimeline.tsx`**

I `onClick`-hanteraren (rad 316-318), extrahera det ursprungliga block-ID:t innan det skickas till `onBlockClick`. Klippta block har formatet `{originalId}-clip-{date}`, så vi kan parsa ut original-ID:t.

Enklare lösning: Lagra `originalId` på varje klippt block i `clipBlocksForOverlaps` och skicka det vid klick istället.

Konkret:
1. Utöka Block-typen i PlanTimeline med ett valfritt `_originalId`-fält
2. I `clipBlocksForOverlaps` (rad 215), sätt `_originalId: b.id` på varje klippt block
3. I `onClick` (rad 317), skicka `b._originalId ?? b.id` istället för `b.id`

Detta innebär att PlanBuilder alltid får det verkliga block-ID:t som matchar state, oavsett om blocket klippts visuellt.

### Filer som ändras
- `src/components/PlanTimeline.tsx` — 3 små ändringar

