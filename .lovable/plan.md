

## Plan: Fixa blockerad e-post (mailto i iframe)

### Problem
`window.open("mailto:...", "_blank")` blockeras av webbläsaren i iframe/preview-miljön (skärmbilden visar "mail.google.com har blockerats / ERR_BLOCKED_BY_RESPONSE"). SMS fungerar redan.

### Lösning
Byt till `window.top?.location.href` för att bryta ut ur iframe-kontexten. Detta är samma teknik som redan används för Stripe Checkout i projektet. Om `window.top` inte är tillgängligt (cross-origin), falla tillbaka på att kopiera den färdiga e-posttexten till urklipp med en toast.

### Teknisk ändring

**`src/pages/PlanBuilder.tsx` — `sendViaEmail`-funktionen (rad 536-543):**

```typescript
const sendViaEmail = useCallback(() => {
  const subject = encodeURIComponent("Vår föräldraledighetsplan");
  const body = encodeURIComponent(`Hej!\n\nKolla in vår föräldraledighetsplan:\n${shareUrl}\n\nMvh`);
  const mailtoUrl = `mailto:${shareRecipient}?subject=${subject}&body=${body}`;
  try {
    if (window.top) {
      window.top.location.href = mailtoUrl;
    } else {
      window.location.href = mailtoUrl;
    }
  } catch {
    // Cross-origin — kan inte nå window.top, kopiera istället
    const text = `Hej!\n\nKolla in vår föräldraledighetsplan:\n${shareUrl}\n\nMvh`;
    navigator.clipboard.writeText(text).catch(() => {});
    toast({ description: "Kunde inte öppna e-postklienten. Texten har kopierats — klistra in den i ett mail!" });
  }
  setShareDialogOpen(false);
  setShareStep('main');
  setShareRecipient('');
}, [shareUrl, shareRecipient, toast]);
```

En enda ändring i en funktion — resten av dialogen och SMS-flödet behålls som det är.

