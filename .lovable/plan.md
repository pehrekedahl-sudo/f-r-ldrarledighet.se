

## Problem

When the user clicks a CTA button and creates an account, the flow is:

1. `pendingCtaAction` is saved to `localStorage`
2. AuthModal opens, user signs up
3. Modal closes with "check your email" message
4. **On this same page load**, the state initializer reads `pendingCtaAction` from `localStorage` AND immediately deletes it
5. But `user` is still `null` (email not verified), so the useEffect that triggers checkout never fires
6. User goes to email, clicks verify link, returns to `/plan-builder`
7. `pendingCtaAction` is gone from `localStorage` — nothing happens

The root cause: `localStorage.removeItem("pendingCtaAction")` happens too early (on component mount) instead of when the action is actually consumed.

## Fix

In `src/pages/PlanBuilder.tsx`:

1. **Stop clearing `pendingCtaAction` from localStorage in the state initializer** — just read it, don't remove it
2. **Clear it in the useEffect** only after checkout is actually started or the action is performed
3. Also clear it when checkout starts in `startCheckout` to prevent double-triggers

This is a ~5-line change in one file.

