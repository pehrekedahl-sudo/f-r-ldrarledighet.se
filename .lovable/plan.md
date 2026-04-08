

# Tutorial: Pulsande ram utan overlay

## Vad ändras
Hela spotlight-logiken (clip-path overlay + getBoundingClientRect-positionering) ersätts med en enklare approach: en animerad ring/glow runt aktuellt element via CSS-klasser, plus en förankrad tooltip. Ingen mörk overlay alls.

## Teknik

### `src/components/PlanTutorial.tsx` — omskriven

**Bort:** clip-path-overlay, spotlight-ring-div, all `getBoundingClientRect`-logik, manuell tooltip-positionering.

**Nytt:**
1. **Transparent click-blocker** — en `fixed inset-0 z-40` div utan bakgrundsfärg (eller max `bg-black/10` för subtil dimning) som fångar klick utanför tooltip:en.
2. **Ring på målelementet** — vid varje steg, lägg till en CSS-klass direkt på target-elementet:
   ```ts
   el.classList.add("tutorial-highlight");
   // cleanup: el.classList.remove("tutorial-highlight");
   ```
3. **CSS-klass** (läggs i `index.css`):
   ```css
   .tutorial-highlight {
     position: relative;
     z-index: 45;
     box-shadow: 0 0 0 3px hsl(var(--primary) / 0.5), 0 0 16px hsl(var(--primary) / 0.2);
     border-radius: 0.75rem;
     transition: box-shadow 0.3s ease;
     animation: tutorial-pulse 2s ease-in-out infinite;
   }
   @keyframes tutorial-pulse {
     0%, 100% { box-shadow: 0 0 0 3px hsl(var(--primary) / 0.5), 0 0 16px hsl(var(--primary) / 0.2); }
     50% { box-shadow: 0 0 0 5px hsl(var(--primary) / 0.3), 0 0 24px hsl(var(--primary) / 0.15); }
   }
   ```
4. **Tooltip-positionering** — fortfarande `fixed`, men enklare: scrolla till elementet, mät rect en gång efter scroll, placera tooltip under. Eftersom det inte finns ett overlay-hål att matcha pixelperfekt är off-by-a-few-px inte synligt.
5. **scrollIntoView + requestAnimationFrame** istället för `setTimeout(350)` för mer robust timing.

### `src/index.css` — ny klass
Lägg till `.tutorial-highlight` och `@keyframes tutorial-pulse`.

### `src/pages/PlanBuilder.tsx` — inga ändringar
Id-attributen och ❓-knappen behålls som de är.

## Steg och texter
Samma 5 steg, samma texter, samma navigering (Nästa / Hoppa över / prickar / Klar). Samma localStorage-logik.

## Filer
| Fil | Ändring |
|---|---|
| `src/components/PlanTutorial.tsx` | Omskriven — ta bort clip-path, lägga till classList-approach |
| `src/index.css` | Ny CSS-klass + keyframes |

