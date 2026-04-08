

# Ny sektion: "Det här stöder vi inte än"

## Vad
En enkel, ärlig sektion på startsidan som listar begränsningar. Placeras mellan tidslinjeförhandsgranskningen (rad 156) och CTA:n (rad 158).

## Innehåll
Rubrik: **"Det här stöder vi inte än"**

Inledande text: *"Verktyget är byggt för två föräldrar med fast anställning och ett barn. Vi jobbar på att utöka stödet – följande scenarion hanteras inte korrekt idag:"*

Punktlista:
- Ensamstående föräldrar
- Familjer med sparade dagar från ett äldre barn
- Egenföretagare och föräldrar med oregelbunden inkomst

## Design
Samma stil som övriga sektioner: `max-w-3xl mx-auto`, `rounded-xl border-2 border-border bg-card shadow-sm p-6`. Enkel lista med muted bullet points, ingen kolumnlayout.

## Ändring
Enbart `src/pages/Index.tsx` – ny `<section>` mellan rad 156 och 158.

