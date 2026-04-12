import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "./useUser";

export function useHasPurchased() {
  const { user, loading: userLoading } = useUser();
  const [hasPurchased, setHasPurchased] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setHasPurchased(false);
      setLoading(false);
      return;
    }

    const check = async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);

      if (!error && data && data.length > 0) {
        setHasPurchased(true);
      } else {
        setHasPurchased(false);
      }
      setLoading(false);
    };

    check();
  }, [user, userLoading]);

  return { hasPurchased, loading };
}
