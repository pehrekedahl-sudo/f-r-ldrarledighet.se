

## Lägg till publik navigeringsbar

Skapa en ny komponent `TopNav` som visas på alla sidor (utom wizard-flödet) med tre länkar:

| Label | Route |
|-------|-------|
| Start | `/` |
| Föräldradagar 101 | `/foraldraledighet-101` |
| Min Plan | `/plan-builder` |

### Ändringar

**1. Ny fil `src/components/TopNav.tsx`**

Horisontell navbar i toppen med:
- Vänster: logotyp/namn "föräldraledighet.se" som länk till `/`
- Höger: tre NavLinks med aktiv-markering (underline eller font-medium)
- Stil: `sticky top-0 z-50 bg-white/80 backdrop-blur border-b`, max-width centrerad
- Jade-accent på aktiv länk (`text-[#4A9B8E]`)

**2. `src/App.tsx`**

Rendera `<TopNav />` ovanför `<Routes>` på alla sidor utom `/wizard` (wizard är ett fullskärmsflöde). Villkora med en enkel check på `useLocation().pathname !== "/wizard"`.

Behöver wrappa i en inner-komponent (`AppContent`) eftersom `useLocation` kräver att vara inuti `<BrowserRouter>`.

### Filer

| Fil | Ändring |
|-----|---------|
| `src/components/TopNav.tsx` | Ny — navbar-komponent |
| `src/App.tsx` | Importera TopNav, rendera villkorligt |

