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

    const hasOAuthParams =
      typeof window !== "undefined" &&
      (window.location.hash.includes("access_token") ||
        window.location.search.includes("code=") ||
        window.location.hash.includes("refresh_token"));

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data?.session) {
          setSession(data.session as Session);
          setLoading(false);
        } else if (!hasOAuthParams) {
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn("getSession error:", err);
        if (!hasOAuthParams) setLoading(false);
      });

    // If OAuth params exist, allow up to 4 seconds for onAuthStateChange to exchange tokens
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (hasOAuthParams) {
      timeoutId = setTimeout(() => {
        setLoading(false);
      }, 4000);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (sub?.unsubscribe) sub.unsubscribe();
    };
  }, []);

  return { session, loading };
}
