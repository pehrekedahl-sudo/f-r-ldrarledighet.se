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
    console.log("[useSavedPlan] load effect", {
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      userLoading,
    });

    // While auth is still loading, keep our loading=true so consumers wait
    if (userLoading) {
      console.log("[useSavedPlan] waiting for auth hydration before loading saved plan");
      return;
    }

    if (!user) {
      console.log("[useSavedPlan] no authenticated user, clearing dbPlan and using local fallback only");
      setDbPlan(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    console.log("[useSavedPlan] fetching saved plan from database", {
      userId: user.id,
    });

    (async () => {
      const { data, error } = await supabase
        .from("saved_plans")
        .select("plan_data")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) {
        console.log("[useSavedPlan] fetch completed after cancellation", {
          userId: user.id,
        });
        return;
      }

      console.log("[useSavedPlan] fetch result", {
        userId: user.id,
        hasPlan: Boolean(data?.plan_data),
        error: error?.message ?? null,
        planData: data?.plan_data ?? null,
      });

      if (!error && data?.plan_data) {
        setDbPlan(data.plan_data);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      console.log("[useSavedPlan] cancelling in-flight saved plan load", {
        userId: user.id,
      });
    };
  }, [user?.id, userLoading]);

  /**
   * Save plan to both localStorage and database (upsert).
   * Returns a Promise so callers can await critical saves (e.g. before checkout).
   */
  const savePlan = useCallback(
    async (planData: unknown) => {
      console.log("[useSavedPlan] save requested", {
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        hasUser: Boolean(user),
        savingInFlight: savingRef.current,
        planData,
      });

      // Always save to localStorage
      saveToLocal(planData);
      console.log("[useSavedPlan] local cache updated");

      if (!user) {
        console.log("[useSavedPlan] skipping database save because no authenticated user is available");
        return;
      }

      // Debounced DB save — skip if already saving
      if (savingRef.current) {
        console.log("[useSavedPlan] skipping database save because another save is already in progress", {
          userId: user.id,
        });
        return;
      }
      savingRef.current = true;

      try {
        const { error } = await supabase.from("saved_plans").upsert(
          {
            user_id: user.id,
            plan_data: planData as any,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) {
          console.log("[useSavedPlan] database save returned error", {
            userId: user.id,
            error: error.message,
          });
          return;
        }

        // Update local state so loadPlan returns fresh data immediately
        setDbPlan(planData);
        console.log("[useSavedPlan] database save completed", {
          userId: user.id,
        });
      } catch (error) {
        console.log("[useSavedPlan] database save threw", {
          userId: user.id,
          error,
        });
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
