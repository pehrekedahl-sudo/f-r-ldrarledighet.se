

## Fix: Ny användare fastnar i gate-vy efter wizard

### Problem
I `PlanBuilder.tsx` rad 429-436 visas gate-vyn ("Logga in / Skapa ny plan") för **alla** ej inloggade användare, utan att först kontrollera om det finns en plan i localStorage. En användare som precis fyllt i wizarden har sin plan sparad i localStorage men möts ändå av gaten.

### Lösning
Ändra logiken (rad 429-447) så att `loadFromAnySource()` körs **före** gate-beslutet för ej inloggade användare:

```
// Inte inloggad — försök ladda från localStorage först
if (!user) {
  const restored = loadFromAnySource();
  if (!restored) {
    // Ingen plan i localStorage → visa gate
    setNoSavedPlan(true);
  }
  return;
}
```

Om planen finns i localStorage laddas den direkt. Gate-vyn visas bara om det verkligen saknas en plan — d.v.s. användaren navigerat direkt till `/plan-builder` utan att gå via wizarden.

### Fil att ändra
`src/pages/PlanBuilder.tsx` — ca 10 rader i redirect-effekten.

