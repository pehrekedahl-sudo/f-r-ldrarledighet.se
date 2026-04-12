import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadPlanInput, savePlanInput as saveToLocal } from "@/lib/persistence";
import type { User } from "@supabase/supabase-js";

/**
 * Hook that persists plan data to the database for authenticated users,
 * with localStorage as cache/fallback.
 *
 * IMPORTANT: `userLoading` controls whether we keep `loading=true` while
 * auth is still hydrating. This prevents the PlanBuilder from redirecting
 * to the wizard before we know if there's a logged-in user with a saved plan.
 */
export function useSavedPlan(user: User | null, userLoading = false) {
  const [dbPlan, setDbPlan] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const savingRef = useRef(false);

  // Load plan from DB on mount / user change
  useEffect(() => {
    // While auth is still loading, keep our loading=true so consumers wait
    if (userLoading) return;

    if (!user) {
      setDbPlan(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("saved_plans")
        .select("plan_data")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (!error && data?.plan_data) {
        setDbPlan(data.plan_data);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user?.id, userLoading]);

  /**
   * Save plan to both localStorage and database (upsert).
   * Returns a Promise so callers can await critical saves (e.g. before checkout).
   */
  const savePlan = useCallback(
    async (planData: unknown) => {
      // Always save to localStorage
      saveToLocal(planData);

      if (!user) return;

      // Debounced DB save — skip if already saving
      if (savingRef.current) return;
      savingRef.current = true;

      try {
        await supabase.from("saved_plans").upsert(
          {
            user_id: user.id,
            plan_data: planData as any,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        // Update local state so loadPlan returns fresh data immediately
        setDbPlan(planData);
      } catch {
        // silent — localStorage is the fallback
      } finally {
        savingRef.current = false;
      }
    },
    [user?.id]
  );

  /**
   * Load plan: DB first (for logged-in users), then localStorage fallback.
   */
  const loadPlan = useCallback((): unknown | null => {
    if (dbPlan) return dbPlan;
    return loadPlanInput();
  }, [dbPlan]);

  return { savePlan, loadPlan, loadingPlan: loading, dbPlan };
}
