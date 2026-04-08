

# Add optional child name to wizard step 1 and plan title

## What changes

1. **Wizard step 1** — Add an optional "Barnets namn / arbetsnamn" input field below the two parent name fields, with a helper text like "Valfritt – används för att namnge planen". No validation required (field can be empty).

2. **State & persistence** — Add `childName` state to `OnboardingWizard`, persist it in the draft (`WizardDraft` type in `persistence.ts`), include it in `WizardResult`, and pass through from `Wizard.tsx` into the saved plan data.

3. **Plan title in PlanBuilder** — When `childName` is present in the saved plan, change the title from `"Anna & Erik – Planerad ledighet 2025–2026"` to `"Plan för föräldraledighet med Saga"`. When empty, keep the current format.

## Files to edit

- **`src/components/OnboardingWizard.tsx`** — Add `childName` state, input field in step 1, include in draft save and `onComplete` result. Add `childName` to `WizardResult` type.
- **`src/lib/persistence.ts`** — Add `childName: string` to `WizardDraft` type.
- **`src/pages/Wizard.tsx`** — Pass `wr.childName` into the `finalPlan` object (e.g. as a top-level `childName` field).
- **`src/pages/PlanBuilder.tsx`** — Read `childName` from loaded plan data; if present, use `"Plan för föräldraledighet med {childName}"` as `planTitle`.

