

## Plan: E-post och SMS-delning med mottagarinmatning

### Problem
Knapparna "Kopiera för e-post" och "Kopiera för SMS" kopierar bara text till urklipp — ingen skillnad mot "Kopiera länk". Användaren förväntar sig att kunna mata in en e-postadress eller ett telefonnummer och att det sedan skickas/öppnas med färdig text.

### Lösning

Ersätt de tre knapparna med ett flöde i två steg inne i samma dialog:

**Steg 1 (nuvarande vy):** Visa kort delningslänk + tre knappar:
- **Kopiera länk** — som idag
- **Skicka via e-post** — tar användaren till steg 2a
- **Skicka via SMS** — tar användaren till steg 2b

**Steg 2a (E-post):**
- Visa ett inputfält för mottagarens e-postadress
- En "Skicka"-knapp som öppnar `mailto:<inmatad-email>?subject=...&body=...` via `window.open` (alternativt `window.location.href`)
- Brödtexten är kort och innehåller den korta delningslänken (som nu ryms i mailto)
- Tillbaka-knapp för att gå tillbaka till steg 1

**Steg 2b (SMS):**
- Visa ett inputfält för telefonnummer
- En "Skicka"-knapp som öppnar `sms:<nummer>?body=...` (med iOS-detection för `&body=`)
- Brödtexten är kort: "Kolla in vår föräldraledighetsplan: [kort länk]"
- Tillbaka-knapp

Eftersom den nya slug-baserade delningslänken är kort (~60 tecken) ryms den fint i både mailto och sms-URI:er utan att bryta.

### Tekniska ändringar

**`src/pages/PlanBuilder.tsx`:**
1. Lägg till state `shareStep: 'main' | 'email' | 'sms'` och `shareRecipient: string`
2. Byt ut dialogen till att visa olika innehåll baserat på `shareStep`
3. E-post: `window.open(\`mailto:${email}?subject=...&body=...\`, "_blank")`
4. SMS: `window.open(\`sms:${number}?body=...\`, "_blank")` med iOS-anpassning
5. Återställ `shareStep` till `'main'` när dialogen stängs
6. Ta bort `copyForEmail` och `copyForSms` callbacks

