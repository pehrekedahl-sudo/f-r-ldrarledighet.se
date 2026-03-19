

## Lägg till valfri arbetsgivar-top-up i "Ersättning per förälder"

### Koncept

Per förälder läggs ett valfritt inputfält "Top-up från arbetsgivare (kr/mån före skatt)" i ersättningssektionen. Värdet adderas till FK-ersättningen per block-rad så att användaren ser total bruttoinkomst per månad. Värdet sparas i parent-objektet och persisteras med övrig plandata.

### Ändringar

**1. `src/pages/PlanBuilder.tsx`**

- Utöka parent-state med `topUpMonthly?: number` (default 0).
- I "Ersättning per förälder"-sektionen (rad ~1009), under förälderns namn, lägg till ett litet inputfält:
  - Label: "Arbetsgivar-top-up" (text-xs)
  - Input: type number, placeholder "0", suffix "kr/mån", compact stil (h-7, w-32)
  - Uppdaterar `parents` state on change
- I varje block-rad (rad ~1018-1021), addera top-up till det visade beloppet:
  - `totalMonthly = fkMonthly + (topUp * daysPerWeek / 5)` — skalas proportionellt mot uttagstakt precis som FK-ersättningen
  - Visa som: `≈ XX XXX kr/mån` (totalt) med en liten detalj-text under typ `(FK XX XXX + top-up XX XXX)`
- Persistera top-up i `savePlanInput` / `loadPlanInput`.

**2. `src/lib/persistence.ts`** — Säkerställ att `topUpMonthly` på parent-objekt serialiseras/deserialiseras.

### Beteende

- Top-up skalas linjärt med uttagstakt: 5 d/v → 100%, 3 d/v → 60%, etc.
- Rent UI — ingen ändring av simuleringsmotorn. Top-up adderas bara i visningen.
- Inputfältet är valfritt — tomt/0 innebär ingen top-up visas.

### Filer

| Fil | Ändring |
|-----|---------|
| `src/pages/PlanBuilder.tsx` | Lägg till top-up input + summera i block-rader |
| `src/lib/persistence.ts` | Inkludera topUpMonthly i serialisering |

