

# Uppdatera logotypen i TopNav

## Ändring

**Fil:** `src/components/TopNav.tsx` rad 18–19

Byt från en enda `<span>` med "Planera din föräldraledighet" till två separata `<span>`-element:

- **"Planera"** — `font-bold text-lg text-foreground` (tydlig, stark framtoning)
- **"föräldraledighet"** — `font-normal text-lg text-muted-foreground` (subtilare, lättare vikt)

Tar bort "din" helt.

```tsx
<Link to="/" className="flex items-center gap-1.5">
  <span className="font-bold text-lg tracking-tight text-foreground">Planera</span>
  <span className="font-normal text-lg tracking-tight text-muted-foreground">föräldraledighet</span>
</Link>
```

En fil, en ändring.

