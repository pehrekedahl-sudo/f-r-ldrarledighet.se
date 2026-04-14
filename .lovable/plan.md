

## Beta-signalering på landningssidan och i plan-buildern

### Approach
Två subtila, tech-iga beta-badges:

1. **Landningssidan (Index.tsx)** — En liten `BETA`-badge i hero-sektionen, placerad direkt under rubriken eller bredvid undertexten. Stilmässigt: en pill/badge med monospace-font, tunn border, halvtransparent bakgrund — typ `font-mono text-[10px] uppercase tracking-widest border rounded-full px-2 py-0.5` i en dämpad accentfärg.

2. **Plan-buildern (PlanBuilder.tsx)** — Samma badge-stil, placerad i sidans header-area (t.ex. bredvid "Min Plan"-titeln eller i toolbar-raden). Eventuellt med en kort tooltip som förklarar att verktyget är i beta.

### Visuell stil
```text
┌──────────────────────┐
│  β  BETA             │  ← pill-badge, monospace
└──────────────────────┘
```
- Monospace-font, versaler, extra letter-spacing
- Halvtransparent primärfärg som bakgrund (`bg-primary/10 text-primary border-primary/20`)
- Liten storlek, icke-störande

### Filer att ändra
- **`src/pages/Index.tsx`** — Lägg till beta-badge i hero-sektionen, under `<h1>`
- **`src/pages/PlanBuilder.tsx`** — Lägg till beta-badge i header/toolbar-området

Totalt ca 5-10 rader per fil.

