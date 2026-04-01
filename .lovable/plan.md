

# Ändringar i steg 5 — tre justeringar

## 1. Live-feedback: per förälder istället för sammanlagt

Bryt upp den nuvarande sammanlagda raden till att visa FK-ersättning **per förälder**, plus dagar sammanlagt:

```text
Anna: ~28 400 kr/mån från FK
Erik: ~24 200 kr/mån från FK
208 dagar förbrukas · 182 dagar kvar av 390
```

Dagarna visas fortfarande sammanlagt (som nu).

## 2. Hög inkomst-kortet: aldrig visa negativa dagar

Om "income"-förslaget (7 d/v) resulterar i fler än 390 dagar, beräkna hur många veckor som behöver vara 5 d/v istället:

```text
excess = totalDaysAt7 - 390
weeksAt5 = ceil(excess / 2)
```

Visa i kortets beskrivning: *"7 d/v — {X} veckor behöver vara 5 d/v för att dagarna ska räcka"* istället för att visa ett negativt dagar-kvar-värde. Sätt dpw till 7 som förslag men tillåt att live-feedbacken visar korrekt (negativa dagar visas aldrig — cappa till 0 med varningstext).

## 3. Tydlig CTA om nästa steg

Lägg till en rad under live-feedbacken (eller i den befintliga info-bannern):

```text
"I nästa steg kan du bryta ner detta i olika block och skräddarsy uttagstakten för bästa resultat."
```

## Teknisk omfattning

**En fil:** `src/components/OnboardingWizard.tsx`

1. **Rad 569-576**: Refaktorera live-feedback — visa `benefit1` och `benefit2` separat med föräldrarnas namn, behåll dagar som sammanlagt
2. **Rad 490-493**: Uppdatera `prefCards` — income-kortets `desc` blir dynamiskt baserat på om 7dpw överstiger 390
3. **Rad 529-531**: Uppdatera kortets detail-rad för income att visa "X veckor på 5 d/v"
4. **Rad 498-499**: Uppdatera info-bannern eller lägg till ny rad under live-feedback om att man kan finslipa i planen

~30 rader ändrade.

