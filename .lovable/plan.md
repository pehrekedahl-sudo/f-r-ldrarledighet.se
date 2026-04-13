

## Plan: Endast inloggade användare kan se sin plan

### Nuvarande beteende
`loadFromAnySource()` laddar plan från DB **eller** localStorage. En ej inloggad användare med en gammal plan i localStorage hamnar direkt i PlanBuilder utan att logga in.

### Nytt beteende

| Situation | Resultat |
|---|---|
| Ej inloggad, trycker "Min Plan" | Gate-vy: "Logga in" eller "Skapa ny plan" |
| Inloggad + DB-plan finns | Ladda plan |
| Inloggad + ingen DB-plan | Redirect till /wizard |

localStorage används **bara** som temporär cache under wizard-flödet och som mellanlagring innan inloggning sker — men PlanBuilder ska **inte** ladda en plan från localStorage om användaren inte är inloggad.

### Ändringar

**`src/pages/PlanBuilder.tsx`** — Load-effekten (rad 331–405):

1. Om `!user` efter att auth laddat klart: sätt `noSavedPlan = true` och visa gate-vy (logga in / skapa ny plan). Ingen redirect till wizard, ingen laddning från localStorage.
2. Om `user` finns: kör `loadFromAnySource()` som idag (DB först, localStorage som fallback). Redirect till `/wizard` bara om ingen plan hittas.
3. Gate-vyn: rubrik + två knappar ("Logga in" → AuthModal, "Skapa ny plan" → navigate("/wizard")).
4. Efter lyckad inloggning via gate: kör om load-logiken automatiskt.

**`src/pages/PlanBuilder.tsx`** — `loadFromAnySource` (rad 295):

Ändra så att localStorage-fallbacken (`loadPlanInput()`) bara används om `user` finns — dvs localStorage fungerar som cache åt DB-sparningen, inte som en fristående källa för ej inloggade.

### Vad som inte ändras
- Wizard-flödet (sparar till localStorage som vanligt under skapandet)
- Delad plan via URL-param (fungerar oavsett auth)
- Auth-hash-hantering (email-verifiering)

