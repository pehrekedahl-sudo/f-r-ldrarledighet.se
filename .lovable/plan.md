
Plan: gör delningen kort, begriplig och stabil

Problemet nu:
- `mailto:`/`sms:` beter sig dåligt i preview/iframe, därför får du blockerad Gmail-flik.
- Nuvarande `?plan=<base64>` gör länken för lång och ful, så SMS-fallbacken tappar själva länken.
- “Dela via app…” är otydlig och ska bort.

Det jag vill bygga:
1. Byta från Base64-delning i URL till en kort delningslänk via backend, t.ex. `.../plan-builder?share=abc123xyz`.
2. Ta bort knappen “Dela via app…”.
3. Göra delningsdialogen copy-first:
   - `Kopiera länk` som primär knapp
   - `Kopiera för e-post`
   - `Kopiera för SMS`
   Dessa kopierar färdig text med den korta länken i stället för att försöka öppna Gmail/Messages direkt.
4. Låta `PlanBuilder` läsa `share`-parametern från backend, men behålla stöd för gamla `plan=`-länkar så tidigare delningar fortsätter fungera.
5. Visa en tydlig rad i dialogen om att alla med länken kan se den delade planen.

Tekniska detaljer:
- Ny separat tabell för delningar, inte i `saved_plans`, så privata sparade planer inte behöver öppnas publikt.
- Tabellen innehåller ungefär: `owner_user_id`, `share_slug`, `plan_data`, `is_active`, timestamps.
- Ägaren får skapa/uppdatera sin egen delningspost via RLS.
- Publik läsning sker via en liten säker backendfunktion som hämtar exakt en plan via slug, så vi inte öppnar upp listning av alla delade planer.
- `sharePlan()` i `src/pages/PlanBuilder.tsx` blir asynkron och skapar/uppdaterar en snapshot i backend i stället för att skriva Base64 till adressfältet.
- Nuvarande `setSearchParams({ plan: ... })` tas bort så URL:en inte blir förstörd bara för att man öppnar delningsdialogen.
- Delningslänken byggs mot den publika app-URL:en när appen körs i preview, så man inte råkar skicka en editor-/preview-länk.

Berörda delar:
- `src/pages/PlanBuilder.tsx` — ny share-flow, ny dialog-UI, laddning av `share`-param, bort med “Dela via app…”
- ny migration för delningstabell + policies + säker läsfunktion
- ev. liten helper för publik base URL

Förväntat resultat:
- inga blockerade Gmail-flikar
- inga SMS som bara säger att länken är kopierad
- kortare och begripligare länk
- enklare och tydligare delningsdialog
