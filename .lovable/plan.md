

## Plan: Förbättra konvertering från startsidan till wizarden

Enbart ändringar i `src/pages/Index.tsx`.

### Ändringar

**A. Skarpare hero-copy**
- Undertext: korta ner, fokusera på utfall — *"Svara på fem frågor — få en komplett plan med datum, belopp och hur ni maximerar era dagar."*
- CTA-knapp: **"Skapa er plan — tar 5 min"**
- Liten text under: *"Gratis. Inget konto krävs."*

**B. Tidslinje-mockupen blir klickbar**
- Wrappa i `<Link to="/wizard">` med hover-effekt (`group-hover:shadow-lg`)
- Rubrik: **"Så kan er plan se ut — klicka för att börja"**

**C. Testimonial-citat**
- Ersätt social proof-raden med ett citat, t.ex.:
  > *"Vi hade ingen aning om hur vi skulle fördela dagarna. På fem minuter hade vi en plan som funkade för oss båda."* — Lisa & Erik

**D. Sticky mobilknapp**
- `fixed bottom-0` CTA på mobil (`md:hidden`): "Skapa er plan — tar 5 min"

**E. Ta bort redundant CTA-sektion ("Redo att planera?")**
- Ersätts av klickbar tidslinje + sticky-knapp

