

## Plan: Produktifiera FK-guiden

Guiden idag är en statisk lista med steg. Nedan fyra förbättringar som gör den mer interaktiv och användbar utan att ändra sidans arkitektur.

### 1. Checklistvy med progress

Varje steg blir avbockningsbart. En progressindikator ("3 av 7 klara") visas överst. Status sparas i `localStorage` (nyckel per plan-hash) så användaren kan komma tillbaka och se vad som återstår.

```text
┌─────────────────────────────────┐
│  Anmäl till FK    3 / 7 klara   │
│  ████████░░░░░░░░  43 %         │
├─────────────────────────────────┤
│ ☑ 1. Logga in på Mina sidor    │
│ ☑ 2. Anmäl pappadagar          │
│ ☐ 3. Anmäl Annas period (sjp)  │
│   ...                           │
└─────────────────────────────────┘
```

### 2. Tidsordnad checklista per förälder

Gruppera stegen per förälder istället för en lång flat lista. Varje förälder får en rubrik med sin färg, och stegen under den visas i kronologisk ordning. Det gör det tydligt vem som behöver göra vad.

```text
Anna (grön)
  ☐ 2025-08-01 – 2026-01-31  5 d/v  Sjukpenningnivå
  ☐ 2026-02-01 – 2026-06-30  3 d/v  Lägstanivå

Erik (röd)
  ☐ 2025-08-01 – 2025-08-14  5 d/v  Sjukpenningnivå (dubbeldag)
  ☐ 2026-02-01 – 2026-07-31  5 d/v  Sjukpenningnivå
```

### 3. "Nästa att göra"-highlight

Det översta ej avbockade steget får visuell tonvikt (starkare bakgrund, "Gör detta nu"-etikett) så användaren direkt ser vad som ska göras härnäst.

### 4. Bättre PDF med sammanfattning

PDF-exporten inkluderar en sammanfattningstabell överst (förälder, total ledighet, antal perioder) och tydliga checkrutor som kan fyllas i för hand.

---

### Tekniska ändringar

| Fil | Ändring |
|-----|---------|
| `src/components/FKGuideDrawer.tsx` | Refaktorera till checklistvy med `Checkbox`-komponent, progress-bar, localStorage-persistens, per-förälder-gruppering, "nästa"-highlight. Uppdatera print-HTML med sammanfattningstabell och checkrutor. |

Inga nya filer, inga DB-ändringar, inga nya beroenden.

