

# SGI-varning per block i PlanBuilder

## Vad som byggs
En per-block varning som visas direkt under tidslinjen när ett block har `daysPerWeek < 5` och infaller (helt eller delvis) efter barnets 1-årsdag. Varningen inkluderar en länk till 101-sidans SGI-sektion.

## Förutsättningar
- `dueDate` finns redan i PlanBuilder state — barnets 1-årsdag = `addMonths(dueDate, 12)`
- Varningen visas bara om `dueDate` är satt
- Blockens `startDate` jämförs med 1-årsdagen; block som slutar före 1-årsdagen visas inte

## Ändringar

### 1. `src/pages/PlanBuilder.tsx` — SGI-varningsblock under tidslinjen

**Plats:** Direkt efter `<PlanTimeline ... />` och före "Lägg till block"-knapparna (rad ~1014), inuti result-vyn.

**Logik (useMemo):**
```
const childFirstBirthday = dueDate ? addMonths(dueDate, 12) : null;

const sgiWarningBlocks = useMemo(() => {
  if (!childFirstBirthday) return [];
  return validBlocks.filter(b =>
    b.daysPerWeek < 5 &&
    !b.isOverlap &&
    compareDates(b.endDate, childFirstBirthday) >= 0
  );
}, [validBlocks, childFirstBirthday]);
```

**Rendering:** En amber/warning-styled `div` per varningsblock, med förälderns namn och blockdatum:
```
{sgiWarningBlocks.map(b => (
  <div key={b.id} className="border border-amber-300 rounded-lg p-3 bg-amber-50 text-amber-900 text-sm flex items-start gap-2">
    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
    <p>
      <strong>{parentName}</strong>: Du tar ut färre än 5 dagar/vecka
      ({b.daysPerWeek} d/v) efter barnets 1-årsdag. Det kan påverka
      din SGI negativt om du inte arbetar de resterande dagarna.
      <Link to="/foraldraledighet-101?section=tradeoffs"
        className="underline font-medium ml-1">Läs mer →</Link>
    </p>
  </div>
))}
```

- Importera `AlertTriangle` från lucide-react och `Link` från react-router-dom (Link redan imported via navigate)

### 2. `src/pages/Foraldraledighet101.tsx` — Scroll till rätt sektion via query param

**Lägg till:** useEffect som läser `?section=tradeoffs` från URL:en, och om satt:
1. Sätter Accordion default-value till `tradeoffs`
2. Scrollar till sektionen med `document.getElementById` + `scrollIntoView`

Kräver:
- `useSearchParams` import
- Ge `AccordionItem value="tradeoffs"` ett `id="section-tradeoffs"` attribut
- Ändra Accordion från uncontrolled till kontrollerad (`value` state) som initieras från query param

### Sammanfattning
- **2 filer**: `PlanBuilder.tsx`, `Foraldraledighet101.tsx`
- Ingen ändring av layout, simuleringslogik eller befintliga varningar
- Använder befintlig amber/warning-styling som redan finns i projektet
