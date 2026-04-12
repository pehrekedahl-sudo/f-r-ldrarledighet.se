

## Plan: Rabattkoder för Stripe Checkout

### Steg 1 — Skapa kuponger i Stripe
Jag skapar två kuponger direkt via Stripe:

1. **Lansering 50%** — 50% rabatt, engångs
2. **100% gratis** — 100% rabatt, engångs (för test och vänner)

### Steg 2 — Skapa kampanjkoder (promotion codes)
Kupongerna i sig syns inte för kunden — man behöver koppla *promotion codes* (rabattkoder) till dem. Jag skapar koder som t.ex.:
- `LANSERING50` → 50% rabatt
- `GRATIS100` → 100% rabatt

### Steg 3 — Aktivera rabattkodsfältet i checkout
Uppdatera edge-funktionen `create-checkout-session` så att Stripe Checkout visar ett fält där kunden kan skriva in rabattkod. Det görs genom att lägga till:

```typescript
allow_promotion_codes: true
```

i `stripe.checkout.sessions.create()`.

### Tekniska ändringar

| Vad | Hur |
|-----|-----|
| Stripe-kuponger | Skapas via Stripe-verktyg (2 st) |
| Promotion codes | Skapas via Stripe API (2 st) |
| `supabase/functions/create-checkout-session/index.ts` | Lägg till `allow_promotion_codes: true` |

Inga ändringar i frontend — rabattkodsfältet visas automatiskt av Stripe i checkout-vyn.

