

## Problem

När kupongkoden **GRATIS100** (100 % rabatt) används blir checkout-summan 0 kr. Stripe skapar då inget `payment_intent`, så `session.payment_intent` är `null`. Webhookens insert misslyckas eftersom kolumnen `stripe_payment_id` har `NOT NULL`-constraint. Användaren får aldrig en rad i `purchases` och låses därför ute.

**LANSERING50** fungerar redan — användaren betalar ett reducerat belopp, `payment_intent` finns, och raden skapas korrekt.

## Lösning

En ändring i **`supabase/functions/stripe-webhook/index.ts`** (rad 42):

Byt:
```typescript
stripe_payment_id: session.payment_intent as string,
```
till:
```typescript
stripe_payment_id: (session.payment_intent as string) || session.id,
```

`session.id` (t.ex. `cs_live_...`) är alltid tillgängligt och unikt — det fungerar som fallback-identifierare när ingen betalning sker.

### Fil att ändra
`supabase/functions/stripe-webhook/index.ts` — en rad.

