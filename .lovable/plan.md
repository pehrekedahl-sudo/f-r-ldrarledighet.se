

## Plan: Fixa e-postdelning av plan

### Problem
`mailto:`-länken fungerar inte pålitligt av två anledningar:
1. Plan-URL:en är extremt lång (1000+ tecken Base64-data) vilket överskrider `mailto:`-gränsen i många webbläsare och e-postklienter
2. `window.open("mailto:...", "_self")` beter sig oförutsägbart i olika miljöer

### Lösning
Byt från `window.open` till `window.location.href = mailto:...` (mer pålitligt). Dessutom korta ned URL:en genom att använda `encodeURIComponent` korrekt och se till att hela `mailto:`-strängen inte bryter.

Som en extra robusthetslösning: om URL:en är för lång (>1500 tecken), kopiera länken till urklipp automatiskt och informera användaren att klistra in den i ett e-postmeddelande istället, alternativt visa ett inputfält med länken i e-postdialogen.

### Teknisk ändring

**`src/pages/PlanBuilder.tsx`**:
- Ändra `emailShareUrl` från `window.open(\`mailto:...\`, "_self")` till `window.location.href = \`mailto:...\``
- Lägg till fallback: om `shareUrl` är längre än ~1800 tecken, använd en kortare brödtext som säger "Jag har delat en föräldraledighetsplan med dig. Öppna länken nedan:" utan att bädda in hela URL:en i mailto-bodyn. Kopiera istället URL:en till urklipp och visa en toast som säger "Länken har kopierats – klistra in den i mailet!"
- Behåll nuvarande kopiera-knapp och dialog som backup

