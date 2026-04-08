

# Fix: Cross-parent overlap detection in BlockEditDrawer

## Root cause
The drag-to-resize handler (`handleBlockResize`) detects cross-parent overlap and shows a dialog with 3 options (create DD, truncate, cancel). But when editing dates via the **BlockEditDrawer**, the `checkOverlap` function only checks same-parent overlaps (line 60: `if (other.parentId !== block.parentId) continue`), and `handleDrawerSave` has no cross-parent check either. So cross-parent overlaps are silently saved.

## Fix

### 1. `src/components/BlockEditDrawer.tsx` — detect cross-parent overlap
- Extend `checkOverlap` (or add a second check) to also detect cross-parent overlap with non-DD blocks.
- When cross-parent overlap is detected, **don't block save** — instead, set a flag like `crossParentOverlap: { otherBlock, overlapStart, overlapEnd, overlapDays }`.
- Show an inline warning in the drawer: "Denna period överlappar med [otherParent]s ledighet."
- Change the save button to show the overlap options inline (or trigger a callback).

### 2. `src/pages/PlanBuilder.tsx` — handle cross-parent overlap from drawer
- Modify `handleDrawerSave` to check for cross-parent overlap before applying.
- If overlap detected, reuse the same `overlapDialog` state and flow already built for drag-resize:
  - "Skapa dubbeldagar för överlappet"
  - "Korta ner [other parent]s block"
  - "Avbryt"
- Add a DD day limit check: if overlap exceeds 60 working days, show a warning and disable the "Skapa dubbeldagar" option (or cap the DD block at 60 days).

### 3. DD day limit (60 days max)
- Before creating DD blocks (both in `handleOverlapCreateDD` and the new drawer flow), count total existing DD days + proposed new DD days.
- If total > 60, either:
  - Disable the DD option with explanation: "Dubbeldagar kan vara max 60 dagar totalt. Ni har redan X."
  - Or allow it but show a warning.

## Changes

| File | Change |
|---|---|
| `src/components/BlockEditDrawer.tsx` | Add cross-parent overlap detection; pass overlap info to parent via new `onSaveWithOverlap` callback or return overlap data |
| `src/pages/PlanBuilder.tsx` | Modify `handleDrawerSave` to detect cross-parent overlap, show existing overlap dialog, add 60-day DD cap logic |

## Approach detail
The simplest approach: in `handleDrawerSave`, after constructing the updated block, run the same cross-parent overlap check that `handleBlockResize` already does. If overlap found, close the drawer and open the overlap dialog with the relevant data. The drawer's own `checkOverlap` stays same-parent only (to prevent save of same-parent overlaps), while the parent component handles cross-parent overlaps via the dialog.

