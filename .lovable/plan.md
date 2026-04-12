

## Plan: Inloggat läge — tydlig upplevelse för betalande användare

### Nuläge
CTA-blocket längst ner visar alltid samma tre knappar med Lock-ikoner och säljtext, oavsett om användaren har betalat eller inte. Det finns ingen visuell feedback i navbaren eller på sidan som visar att man är inloggad.

### Designförslag

**1. TopNav — inloggningsindikator**
- Lägg till en användarsektion till höger i navbaren (desktop + mobil)
- Betalande användare: visa e-post/namn + "Logga ut"-knapp
- Ej inloggade: inget extra (eller en diskret "Logga in"-länk om önskat)

**2. CTA-blocket — två helt olika vyer**

*Ej betalat (nuvarande):* Behåll som det är med Lock-ikoner och säljtext.

*Betalat:* Ersätt hela blocket med en "verktygslåda" som känns som att man äger produkten:
- **FK-guiden** — prominent knapp/kort, alltid synlig, t.ex. med ClipboardList-ikon och text som "Öppna steg-för-steg-guiden"
- **Spara plan** — CTA-knapp (utan Lock), sparar planen till databasen
- **Dela med partner** — CTA-knapp (utan Lock), öppnar delnings-dialogen
- Ingen säljtext, istället en kort bekräftelse som "Ditt konto är aktivt"

**3. FK-guiden lättillgänglig**
- Lägg även till en liten "FK-guide"-knapp i hero-bannern eller vid tidslinjens verktygsfält, så betalande användare snabbt kan nå den utan att scrolla ner.

### Tekniska ändringar

| Fil | Ändring |
|-----|---------|
| `src/components/TopNav.tsx` | Importera `useUser`, `useHasPurchased`. Visa användarinfo + logga ut-knapp för betalande användare. |
| `src/pages/PlanBuilder.tsx` | Villkora CTA-blocket: `hasPurchased` → verktygslåda utan Lock, annars nuvarande säljblock. Lägg till FK-guide-genväg högre upp på sidan. |

