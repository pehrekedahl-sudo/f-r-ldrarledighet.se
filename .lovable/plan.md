

# Fyra fixar: faktafel, iOS-input, FK-guide bredd, wizard-hopp

## 1. Faktafel på infosidan
**Fil:** `src/pages/Foraldraledighet101.tsx` rad 262
Ändra "minst 5 hela föräldradagar" → "minst 7 hela föräldradagar".

## 2. iOS-bugg: sifferinmatning fastnar
**Problem:** `type="number"` på iOS ger oförutsägbart beteende vid radering. Lösningen: byt till `type="text" inputMode="numeric" pattern="[0-9]*"` och hantera tomma mellanvärden.

**Berörda filer och fält:**
- `src/components/OnboardingWizard.tsx` — inkomstfält (rad 309, 322), månadsfält (rad 350–354, 362–366), slider-relaterade inputs
- `src/components/BlockEditDrawer.tsx` — veckor-input (rad 286)
- `src/components/DoubleDaysDrawer.tsx` — antal dagar och dagar/vecka (rad 99–103, 114–117)
- `src/components/SaveDaysDrawer.tsx` — target days input (rad 505–509)
- `src/components/TransferDaysDrawer.tsx` — transfer inputs (rad 228–232, 245–249)
- `src/pages/PlanBuilder.tsx` — dagar/vecka, lägstanivå, månader, top-up fält (rad 716, 728, 787, 791, 1277, 1297)

Alla `type="number"` byts till `type="text" inputMode="numeric" pattern="[0-9]*"`. `onChange`-hanterare uppdateras för att tillåta tom sträng som mellanvärde, med fallback till min-värde vid blur eller vid commit.

## 3. Max-width på FK-guidemodalen
**Fil:** `src/components/FKGuideDrawer.tsx` rad 140
Lägg till `max-w-2xl mx-auto` på `DrawerContent`:
```
<DrawerContent className="max-h-[92vh] max-w-2xl mx-auto">
```

## 4. Wizard-formuläret hoppar uppåt
**Fil:** `src/components/OnboardingWizard.tsx` rad 524
Ändra `justify-center` till `justify-start pt-4`:
```
<div className="flex-1 flex flex-col justify-start pt-4">
```

## Tekniska detaljer

För iOS-input-fixen skapas ett mönster där:
- Värdet lagras som `string` i state (tillåter `""`)
- `onChange` sätter råvärdet (filtrerat till siffror + tom sträng)
- `onBlur` clampar till giltigt intervall om fältet lämnas tomt eller utanför min/max
- Befintliga numeriska states som redan är `string` (income1/income2) behöver bara `type`/`inputMode`-ändring
- States som är `number` (months1, daysPerWeek1 etc.) behöver en wrapper eller temporärt string-state

