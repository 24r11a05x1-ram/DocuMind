import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    try {
      const res = supabase.auth.onAuthStateChange((_e, s) => {
        setSession(s as Session | null);
        setLoading(false);
      });
      sub = res.data.subscription;
    } catch (e) {
      console.warn("Failed to subscribe to auth state changes:", e);
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data?.session) {
          setSession(data.session as Session);
        }
      })
      .catch((err) => {
        console.warn("getSession error:", err);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      if (sub?.unsubscribe) sub.unsubscribe();
    };
  }, []);

  return { session, loading };
}
