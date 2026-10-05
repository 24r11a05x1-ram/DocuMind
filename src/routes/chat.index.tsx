import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";

export const Route = createFileRoute("/chat/")({
  ssr: false,
  component: PickThread,
});

function PickThread() {
  const nav = useNavigate();
  const { session, loading } = useSession();
  const started = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      nav({ to: "/auth", replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("threads")
          .select("id")
          .order("updated_at", { ascending: false })
          .limit(1);

        if (error) {
          console.error("Error fetching threads:", error);
        }

        let id = data?.[0]?.id;
        if (!id) {
          const { data: t, error: createError } = await supabase
            .from("threads")
            .insert({ title: "New chat" })
            .select("id")
            .single();

          if (createError) {
            console.error("Error creating thread:", createError);
          }
          id = t?.id;
        }

        if (id) {
          nav({ to: "/chat/$threadId", params: { threadId: id }, replace: true });
        }
      } catch (e) {
        console.error("PickThread error:", e);
      }
    })();
  }, [nav, session, loading]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="animate-spin text-primary" />
    </div>
  );
}
