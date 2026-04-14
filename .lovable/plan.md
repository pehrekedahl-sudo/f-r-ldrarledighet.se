

## Lägg till subtil färg på beta-badge i TopNav

Ändra beta-badgens styling i `src/components/TopNav.tsx` så att den får en svag jade-grön bakgrund och border som knyter an till varumärkets färgpalett, vilket skiljer den visuellt från logotyp-texten.

### Ändring

I `src/components/TopNav.tsx`, uppdatera beta-spanens klasser:

Från:
```
font-mono uppercase text-muted-foreground/50 border border-muted-foreground/20 rounded-full px-1.5 py-px
```

Till:
```
font-mono uppercase rounded-full px-1.5 py-px border
```
med inline style-färger som matchar jade-tonen: `color: #4A9B8E` (ca 50% opacity), `borderColor: rgba(74,155,142,0.25)`, `backgroundColor: rgba(74,155,142,0.08)`.

**Fil:** `src/components/TopNav.tsx` — en rad.

