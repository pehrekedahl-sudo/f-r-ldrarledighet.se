

## Color update in PlanTimeline.tsx

Four places to change in `src/components/PlanTimeline.tsx`:

### 1. `getIntensityClass` function (lines 84-93)
Replace the intensity-based color tiers with flat jade colors, white text for all:

```typescript
function getIntensityClass(parentId: string, daysPerWeek: number): string {
  if (parentId === "p1") {
    return "bg-[#4A9B8E] border-[#3d8a7d] text-white hover:bg-[#3d8a7d]";
  }
  return "bg-[#5BAD9F] border-[#4e9c8e] text-white hover:bg-[#4e9c8e]";
}
```
The `daysPerWeek` intensity tiers are removed — all blocks get their parent's flat color.

### 2. Parent dot indicators (line 263)
Change `bg-blue-400` → `bg-[#4A9B8E]` and `bg-emerald-400` → `bg-[#5BAD9F]`.

### 3. Parent label text color (line 264)
Change `text-blue-700` → `text-[#4A9B8E]` and `text-emerald-700` → `text-[#5BAD9F]`.

### 4. Overlap (dubbeldagar) block styling (~line 275+)
Change the overlap block classes from `border-purple-300 bg-purple-100 text-purple-700` to `border-[#E8735A] bg-[#E8735A] text-white`. Also update the overlap row dot indicator from `bg-purple-400` → `bg-[#E8735A]` and label text from `text-purple-700` → `text-[#E8735A]`.

No logic changes — purely class/color swaps in one file.

