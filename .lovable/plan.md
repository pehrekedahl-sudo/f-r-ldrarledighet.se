

## Plan: Fixa Stripe-webhook + lägg in testpost

### Problem
1. **Webhook kraschar**: `constructEvent()` är synkron och fungerar inte i Deno/Edge Functions. Felmeddelande: *"SubtleCryptoProvider cannot be used in a synchronous context"*.
2. **Ingen testdata**: `purchases`-tabellen är tom, så det inloggade betalläget kan inte verifieras.

### Åtgärder

**1. Lägg in testpost i `purchases`** (direkt via insert-verktyg)

Skapar en rad för `user_id = 74b003e2-5a3c-4ecd-8527-4b32b9b03fb3` (pehr.ekedahl@gmail.com) så att du omedelbart ser det betalda UI:t.

**2. Fixa `supabase/functions/stripe-webhook/index.ts`**

Ändra:
```typescript
// Nuvarande (kraschar)
event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
```
Till:
```typescript
// Fixat (async, fungerar i Deno)
event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
```

Det är den enda kodändringen som behövs. Resten av webhook-logiken (insert i purchases etc.) är korrekt.

### Resultat
- Du ser omedelbart det betalda läget (verktygslåda, FK-guide-genväg, e-post i nav)
- Framtida Stripe-köp registreras korrekt i databasen

