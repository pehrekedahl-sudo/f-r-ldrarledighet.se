

## Plan: Fixa e-post- och SMS-delning

### Problem
1. **E-post**: `window.location.href = "mailto:..."` navigerar bort från appen i preview-miljön, och Gmail avvisar anslutningen (skärmbilden visar "mail.google.com avvisade anslutningen").
2. **SMS**: URL:en är alltid för lång, så fallback-texten visas utan den faktiska länken — användaren får bara "Länken har kopierats till urklipp" men urklipp fungerar inte alltid pålitligt.

### Lösning

Byt strategi helt — använd **Web Share API** som primär delningsmetod (fungerar nativt på mobil med e-post, SMS, WhatsApp etc.), med `window.open(mailto, "_blank")` som fallback på desktop.

### Tekniska ändringar

**`src/pages/PlanBuilder.tsx`**:

1. **Lägg till en primär "Dela"-knapp** som använder `navigator.share()` om tillgängligt (mobil). Delar `shareUrl` som URL + titel.

2. **E-post-fallback**: Byt `window.location.href` → `window.open(mailtoUrl, "_blank")` så appen inte navigeras bort. Behåll clipboard-fallback för långa URL:er.

3. **SMS-fallback**: Samma fix — `window.open(smsUrl, "_blank")`. Hantera plattformsskillnader i SMS-URI (`sms:?body=` för Android, `sms:&body=` för iOS).

4. **UI**: Visa "Dela" (native share) som primärknapp om `navigator.share` finns. Visa E-post/SMS som sekundära alternativ.

