

# Lägg till pappadagar-info i FK-guiden och Föräldradagar 101

## Översikt
Två ändringar: (1) nytt informationssteg i FK-guiden om de 10 tillfälliga föräldrapenningdagarna, och (2) ny information om samma ämne på 101-sidan.

## Ändringar

### 1. `src/components/FKGuideDrawer.tsx`
- Lägg till ett nytt steg 2 (direkt efter login-steget) med rubrik **"Anmäl tillfällig föräldrapenning (10 dagar)"**
- Innehåll: P2 har rätt till 10 dagars tillfällig föräldrapenning vid barnets födelse, utanför 480-dagarsbudgeten, måste tas ut inom 60 dagar
- Extern länk till FK:s sida om tillfällig föräldrapenning
- Visa steget bara om `parents.length >= 2`
- Räkna om stegnumrering för alla efterföljande steg (+1)
- Inkludera i PDF-utskriften (steget har `step-card`-klassen)

### 2. `src/pages/Foraldraledighet101.tsx`
- Lägg till ett nytt stycke i **Section 1 ("Hur dagarna är uppdelade")** efter den befintliga texten om 480 dagar
- Rubrik: **"Tillfällig föräldrapenning vid födseln (10 dagar)"**
- Förklaring: Den andra föräldern har rätt till 10 dagars tillfällig föräldrapenning i samband med barnets födelse, utanför 480-dagarsbudgeten, inom 60 dagar, anmäls separat hos FK
- Använd befintlig `InfoBox`-komponent för att visuellt matcha resten av sidan

