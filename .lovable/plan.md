

## Problem

Planer lagras bara i `localStorage`. När användaren går genom Stripe Checkout och kommer tillbaka (eller besöker sidan senare) kan localStorage vara tomt — och då redirectas man till wizarden. Det finns ingen serverlagring av planer alls.

## Lösning: Spara planer i databasen för inloggade användare

### Steg 1 — Skapa tabell `saved_plans`

```sql
CREATE TABLE public.saved_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_data jsonb NOT NULL,
  name text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id) -- en plan per användare tills vidare
);

ALTER TABLE public.saved_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own plans"
  ON public.saved_plans FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plans"
  ON public.saved_plans FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own plans"
  ON public.saved_plans FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own plans"
  ON public.saved_plans FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
```

### Steg 2 — Skapa hook `useSavedPlan`

En ny hook som:
- Vid inloggning hämtar användarens plan från `saved_plans`
- Exponerar `savePlan(data)` som gör upsert till databasen
- Faller tillbaka på localStorage för utloggade användare

### Steg 3 — Uppdatera PlanBuilder

1. **Vid laddning**: Om användaren är inloggad, försök ladda från databasen först, sedan localStorage som fallback.
2. **Vid sparning** (CTA "Spara"): Skriv till databasen (upsert) utöver localStorage.
3. **Före checkout**: Spara planen till databasen (inte bara localStorage) så att den överlever Stripe-redirecten.
4. **Efter Stripe-retur** (`success=true`): Polla `purchases`-tabellen (max 10 försök, 2s intervall) innan man visar "Betalning genomförd". Ladda planen från databasen.

### Steg 4 — Uppdatera `savePlanInput` / `loadPlanInput`

Behåll localStorage som cache, men lägg till parallell databaslagring via den nya hooken för inloggade användare.

### Tekniska ändringar

| Fil | Ändring |
|-----|---------|
| Migration (ny) | Skapa `saved_plans` med RLS |
| `src/hooks/useSavedPlan.ts` (ny) | Hook för databas-read/write av plan |
| `src/pages/PlanBuilder.tsx` | Ladda från DB, spara till DB, polla efter betalning |
| `src/lib/persistence.ts` | Eventuellt liten refactor för att separera local/remote |

