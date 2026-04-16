

## Feedback-funktion: smidig men inte störig

### Mål
Låta användare dela feedback när de själva vill, utan popups, modaler vid uppstart eller störande element.

### Lösning: Diskret "Feedback"-knapp + enkel drawer

**Placering**
- Liten "Feedback"-länk i footer på `Index` och i `TopNav` (desktop: textlänk i navraden, mobil: i hamburgermenyn). Inga sticky-knappar i hörnet, ingen automatisk popup.
- Frivillig "Hur gick det?"-länk efter att användaren slutfört wizarden (en mjuk uppmaning vid en naturlig brytpunkt — inget tvång).

**Interaktion**
- Klick öppnar en `Drawer` (samma mönster som övriga drawers i appen, t.ex. `BlockEditDrawer`) med ett kort formulär:
  - **Typ** (radio): Förslag / Bugg / Beröm / Annat
  - **Meddelande** (textarea, max 1000 tecken, validerat med zod)
  - **E-post** (valfritt, för uppföljning) — förifylls om användaren är inloggad
  - "Skicka"-knapp + diskret tack-bekräftelse via toast

**Lagring**
- Ny tabell `feedback` i Lovable Cloud:
  - `id`, `created_at`, `user_id` (nullable), `email` (nullable), `type`, `message`, `route` (varifrån feedbacken skickades), `user_agent`
- RLS:
  - INSERT: tillåtet för alla (även anonyma) — feedback ska vara enkelt att lämna
  - SELECT/UPDATE/DELETE: endast admin-roll (förbereder för framtida adminvy; ingen byggs nu)

**Validering**
- Klientvalidering med zod (`type` enum, `message` 1–1000 tecken trim, `email` valfri men måste vara giltig om ifylld).

### Filer som skapas/ändras
- **Ny**: `src/components/FeedbackDrawer.tsx` — drawer + formulär + zod-schema + insert till Supabase
- **Ny**: migration som skapar `feedback`-tabellen + RLS + (förbered) `has_role`-funktion om den inte redan finns
- **Ändrad**: `src/components/TopNav.tsx` — lägg till "Feedback"-länk (desktop + mobil) som öppnar drawern
- **Ändrad**: `src/pages/Index.tsx` — lägg till "Feedback"-länk i footern
- **Ändrad**: `src/pages/PlanBuilder.tsx` — diskret "Lämna feedback"-länk längst ner (efter att planen är klar)

### Designprinciper som följs
- Inga popups, modals vid sidladdning eller "intercept"-rutor
- Samma drawer-mönster, typografi och knappstilar som resten av appen
- Anonym feedback tillåten — sänker tröskeln

### Vad jag INTE bygger nu
- Adminvy för att läsa feedback (kan göras direkt via Lovable Cloud-databasen tills vidare)
- E-postnotis vid ny feedback (kan läggas till senare med edge function + Resend)

