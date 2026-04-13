

## Plan: Match top bar logo to reference image

The reference image shows "Planera" in bold dark text and "föräldraledighet" in a lighter weight gray — which differs from the current state where both words are bold.

### Change

**`src/components/TopNav.tsx`** — Change the "föräldraledighet" span from `fontWeight: 700` (bold) back to `fontWeight: 300` (light), keeping everything else (font size 16px, color `#9BA8A2`, letter-spacing) the same. The icon and "Planera" line stay as-is.

This is a one-line change matching the visual in the screenshot.

