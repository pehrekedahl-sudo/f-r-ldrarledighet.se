

# Gör Dela-knappen mer synlig med delnings-dialog

## Vad ändras

Dela-knappen i action-raden (rad 884) ersätts med en mer synlig knapp med Share2-ikon som öppnar en Dialog. Dialogen visar:
- Rubrik: "Dela din plan"
- Beskrivning: "Skicka länken till din partner eller spara den som bokmärke."
- Fält med den genererade URL:en (readonly input)
- Knapp: "Kopiera länk" (kopierar till clipboard, visar bekräftelse)
- Knapp: "Skicka via e-post" (mailto:-länk med subject + body)
- Knapp: "Stäng" (sekundär)

## Tekniska detaljer

**Fil: `src/pages/PlanBuilder.tsx`**

1. Lägg till state `shareDialogOpen` och `shareUrl`.
2. Ändra `sharePlan` till att generera URL:en, sätta `shareUrl`, och öppna dialogen istället för att direkt kopiera.
3. Ersätt den lilla ghost-knappen (rad 884) med en tydligare knapp: `variant="outline"`, Share2-ikon, text "Dela plan".
4. Lägg till en `<Dialog>` med:
   - Readonly input som visar URL:en
   - "Kopiera länk"-knapp (Copy-ikon, kopierar till clipboard, toastar "Länk kopierad")
   - "Skicka via e-post"-knapp (Mail-ikon, öppnar `mailto:?subject=Min föräldraledighetsplan&body=...`)

**Importer som behövs:** `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription` från ui/dialog, `Share2, Copy, Mail, Check` från lucide-react.

Inga andra filer ändras.

