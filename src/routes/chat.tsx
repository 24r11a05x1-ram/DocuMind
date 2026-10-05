import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CloudUpload, FileText, Loader2, LogOut, MessageSquarePlus, Trash2, X, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { ingestFile } from "@/lib/ingest";
import { useI18n, LanguageSelect } from "@/lib/i18n";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/chat")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Chat — DocuMind" },
      { name: "description", content: "Ask questions about your uploaded documents." },
      { property: "og:title", content: "Chat — DocuMind" },
      { property: "og:description", content: "Ask questions about your uploaded documents." },
    ],
  }),
  component: ChatLayout,
});

function fmtSize(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function ChatLayout() {
  const { session, loading } = useSession();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !session) nav({ to: "/auth", replace: true });
  }, [loading, session, nav]);
  if (!session) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const params = useParams({ strict: false }) as { threadId?: string };
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [justDone, setJustDone] = useState(false);

  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("threads").select("*").order("updated_at", { ascending: false });
      if (error) {
        console.error("Failed to load threads:", error);
        return [];
      }
      return data ?? [];
    },
  });
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
      if (error) {
        console.error("Failed to load documents:", error);
        return [];
      }
      return data ?? [];
    },
  });

  async function newThread() {
    const { data, error } = await supabase.from("threads").insert({}).select().single();
    if (error) { toast.error(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["threads"] });
    nav({ to: "/chat/$threadId", params: { threadId: data.id } });
  }

  async function deleteThread(id: string) {
    await supabase.from("threads").delete().eq("id", id);
    await qc.invalidateQueries({ queryKey: ["threads"] });
    if (params.threadId === id) nav({ to: "/chat" });
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setJustDone(false);
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try {
        await ingestFile(f);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not process ${f.name}`);
      }
    }
    setUploading(null);
    setJustDone(true);
    qc.invalidateQueries({ queryKey: ["documents"] });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removeDoc(id: string) {
    await supabase.from("documents").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["documents"] });
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-2">
          <img src={logo} alt="DocuMind logo" width={32} height={32} className="size-8" />
          <span className="font-display text-lg font-bold">Docu<span className="text-primary">Mind</span></span>
        </Link>
        <button onClick={signOut} title={t("signOut")} className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent">
          <LogOut className="size-4" />
        </button>
      </div>
      <div className="px-5 pb-3">
        <LanguageSelect className="w-full border-sidebar-border bg-sidebar-accent text-sidebar-foreground" />
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
        <section>
          <button onClick={newThread} className="bg-brand-gradient flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-primary-foreground">
            <MessageSquarePlus className="size-4" /> {t("newChat")}
          </button>
          <ul className="mt-3 space-y-1">
            {threads.data?.map((th) => (
              <li key={th.id} className={`group flex items-center rounded-lg ${params.threadId === th.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"}`}>
                <Link to="/chat/$threadId" params={{ threadId: th.id }} className="min-w-0 flex-1 truncate px-3 py-2 text-sm">
                  {th.title}
                </Link>
                <button onClick={() => deleteThread(th.id)} className="mr-1 rounded p-1.5 text-sidebar-foreground/60 opacity-0 hover:text-destructive group-hover:opacity-100" title="Delete chat">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold">{t("yourDocs")}</h2>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            className="rounded-xl border-2 border-dashed border-sidebar-border bg-sidebar-accent/50 p-4 text-center"
          >
            <CloudUpload className="mx-auto size-7 text-primary" />
            <p className="mt-1 text-sm font-semibold">{t("upload")}</p>
            <p className="text-xs text-sidebar-foreground/60">PDF, DOCX, TXT, MD</p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!!uploading}
              className="mt-3 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {t("choose")}
            </button>
            <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
          {uploading && (
            <p className="mt-2 flex items-center gap-2 text-xs text-sidebar-foreground/60">
              <Loader2 className="size-3 animate-spin" /> {t("processing")} {uploading}…
            </p>
          )}
          {justDone && !uploading && (
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-success-foreground px-3 py-2 text-xs font-medium text-success">
              <CheckCircle2 className="size-4" /> {t("processed")}
            </p>
          )}
          <ul className="mt-3 divide-y divide-sidebar-border">
            {docs.data?.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <FileText className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-sidebar-foreground/60">{fmtSize(d.size)} · {d.chunk_count} chunks</p>
                </div>
                <button onClick={() => removeDoc(d.id)} className="rounded p-1 text-sidebar-foreground/60 hover:text-destructive" title="Remove">
                  <X className="size-4" />
                </button>
              </li>
            ))}
            {docs.data?.length === 0 && <li className="py-2 text-xs text-sidebar-foreground/60">{t("noDocs")}</li>}
          </ul>
        </section>
      </div>
    </aside>
  );
}
