

## Color replacement plan

All changes are in **two files**: `src/pages/PlanBuilder.tsx` and `src/components/PlanTimeline.tsx`.

### PlanBuilder.tsx — 8 edits

| Line | Current | Replacement |
|------|---------|-------------|
| 640 | `from-blue-50/60 to-emerald-50/60` | `from-[#edf7f5]/60 to-[#fdf0ec]/60` |
| 677 | `border-blue-200` / `border-emerald-200` | `border-[#4A9B8E]/30` / `border-[#E8735A]/30` |
| 678 | `bg-blue-400` / `bg-emerald-400` | `bg-[#4A9B8E]` / `bg-[#E8735A]` |
| 682 | `bg-blue-400` / `bg-emerald-400` | `bg-[#4A9B8E]` / `bg-[#E8735A]` |
| 711 | `text-emerald-700` | `text-[#b85240]` |
| 739 | `text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200/60` | `text-[#2d7a6f] hover:text-[#1f6059] hover:bg-[#edf7f5] border-[#4A9B8E]/30` |
| 906 | `border-l-blue-400` / `border-l-emerald-400` | `border-l-[#4A9B8E]` / `border-l-[#E8735A]` |

### PlanTimeline.tsx — overlap block color change

The overlap (dubbeldagar) blocks currently use `#E8735A`. Per the instructions, overlap blocks should instead use the darker jade:
- Line 266: dot `bg-[#E8735A]` → `bg-[#2D7A6F]`
- Line 267: text `text-[#E8735A]` → `text-[#2D7A6F]`
- Line 362: block `border-[#E8735A] bg-[#E8735A]` → `border-[#235f56] bg-[#2D7A6F]`
- Line 374: delete button hover color stays as-is (functional)

No logic, routing, or component structure changes. Pure class-name swaps.

