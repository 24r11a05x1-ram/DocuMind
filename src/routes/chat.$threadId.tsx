import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileText, Layers, Loader2, Paperclip, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useI18n } from "@/lib/i18n";
import { VoiceButton } from "@/components/VoiceButton";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/chat/$threadId")({
  ssr: false,
  component: ThreadPage,
});

type Source = { n: number; document: string; page: number | null; snippet: string };
type Msg = UIMessage<{ sources?: Source[] }>;

function normalizeDbMessage(row: { id?: string; parts?: unknown; role?: string; ui_id?: string }): Msg {
  const p = row.parts;
  const id = row.ui_id || row.id || Math.random().toString(36).slice(2);
  const role = (row.role as "user" | "assistant") || "assistant";

  if (!p) {
    return { id, role, parts: [{ type: "text", text: "" }] } as Msg;
  }

  // If p is a full message object: { id, role, parts: [...] }
  if (typeof p === "object" && !Array.isArray(p)) {
    const obj = p as Record<string, unknown>;
    if (Array.isArray(obj["parts"])) {
      return {
        id: (obj["id"] as string) || id,
        role: (obj["role"] as "user" | "assistant") || role,
        parts: obj["parts"] as Msg["parts"],
        metadata: obj["metadata"] as Msg["metadata"],
      } as Msg;
    }
  }

  // If p is an array of parts: [{ type: "text", text: "..." }]
  if (Array.isArray(p)) {
    return {
      id,
      role,
      parts: p as Msg["parts"],
    } as Msg;
  }

  // If p is a plain string
  if (typeof p === "string") {
    return {
      id,
      role,
      parts: [{ type: "text", text: p }],
    } as Msg;
  }

  return {
    id,
    role,
    parts: [{ type: "text", text: String(p) }],
  } as Msg;
}

function ThreadPage() {
  const { threadId } = Route.useParams();
  const history = useQuery({
    queryKey: ["messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, ui_id, role, parts, created_at")
        .eq("thread_id", threadId)
        .order("created_at");

      if (error) {
        console.error("Error loading messages:", error);
        return [];
      }
      return (data ?? []).map(normalizeDbMessage);
    },
    staleTime: Infinity,
  });

  if (history.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  return <ChatWindow key={threadId} threadId={threadId} initial={history.data ?? []} />;
}

function ChatWindow({ threadId, initial }: { threadId: string; initial: Msg[] }) {
  const { t, langName } = useI18n();
  const qc = useQueryClient();
  const [input, setInput] = useState("");

  const docsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, size, chunk_count, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Failed to load documents:", error);
        return [];
      }
      return (data ?? []) as Array<{ id: string; name: string; size?: number; chunk_count?: number }>;
    },
  });
  const availableDocs = docsQuery.data ?? [];
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  // Sync selected documents: default to all available documents
  useEffect(() => {
    if (availableDocs.length > 0) {
      setSelectedDocIds((prev) => {
        if (prev.length === 0) return availableDocs.map((d) => d.id);
        const valid = prev.filter((id) => availableDocs.some((d) => d.id === id));
        return valid.length > 0 ? valid : availableDocs.map((d) => d.id);
      });
    }
  }, [availableDocs]);

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllDocs = () => setSelectedDocIds(availableDocs.map((d) => d.id));
  const clearDocs = () => setSelectedDocIds([]);

  const selectedDocIdsRef = useRef<string[]>([]);
  selectedDocIdsRef.current = selectedDocIds;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<Msg>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => {
          return {
            body: {
              threadId,
              language: langName,
              documentIds: selectedDocIdsRef.current.length > 0 ? selectedDocIdsRef.current : undefined,
              messages,
            },
          };
        },
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
        },
      }),
    [threadId, langName],
  );

  const { messages, sendMessage, status, stop } = useChat<Msg>({
    id: threadId,
    messages: initial,
    transport,
    onError: (e) => toast.error(e.message || "Something went wrong"),
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
    },
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [status]);

  const lastSources =
    [...messages].reverse().find((m) => m.role === "assistant" && m.metadata?.sources?.length)?.metadata?.sources ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const panelSources =
    (picked && messages.find((m) => m.id === picked)?.metadata?.sources) || lastSources;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-paper-grain">
        <header className="flex items-center justify-between border-b bg-background/80 px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold">{t("askTitle")}</h1>
            {selectedDocIds.length >= 2 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <Layers className="size-3" /> Multi-Doc Synthesis ({selectedDocIds.length} Attached)
              </span>
            ) : null}
          </div>
          <span className="flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            <span className="size-2 rounded-full bg-secondary" /> {t("features")}
          </span>
        </header>

        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-2xl">
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<img src={logo} alt="" width={64} height={64} className="size-16" />}
                title={t("askTitle")}
                description={t("askDesc")}
              />
            ) : (
              messages.map((m) => {
                const parts = Array.isArray(m?.parts) ? m.parts : [];
                const distinctDocs = m.role === "assistant" && m.metadata?.sources?.length
                  ? Array.from(new Set(m.metadata.sources.map((s) => s.document)))
                  : [];

                return (
                  <Message from={m.role} key={m.id}>
                    <MessageContent className={m.role === "user" ? "bg-ink text-ink-foreground" : ""}>
                      {parts.map((p, i) =>
                        p && p.type === "text" ? (
                          m.role === "user" ? (
                            <span key={i}>{p.text}</span>
                          ) : (
                            <MessageResponse key={i}>{p.text}</MessageResponse>
                          )
                        ) : null,
                      )}
                      {m.role === "assistant" && (m.metadata?.sources?.length ?? 0) > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPicked(m.id)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:bg-secondary hover:text-secondary-foreground transition-colors"
                          >
                            <FileText className="size-3.5" />
                            <span>{m.metadata!.sources!.length} {t("sources")}</span>
                            {distinctDocs.length > 1 && (
                              <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                                from {distinctDocs.length} documents
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                    </MessageContent>
                  </Message>
                );
              })
            )}
            {status === "submitted" && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer>{t("searching")}</Shimmer>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="mx-auto w-full max-w-2xl px-4 pb-5">
          {/* Multi-Document Attachment Bar */}
          {availableDocs.length > 0 && (
            <div className="mb-2.5 rounded-xl border border-border/80 bg-background/95 p-3 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-2 pb-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Paperclip className="size-3.5 text-primary" />
                  <span>Attached Documents</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                    {selectedDocIds.length} of {availableDocs.length} active
                  </span>
                  {selectedDocIds.length >= 2 && (
                    <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Sparkles className="size-3" /> Multi-Doc Comparative Mode
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllDocs}
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-muted-foreground/30">•</span>
                  <button
                    type="button"
                    onClick={clearDocs}
                    className="text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {availableDocs.map((doc) => {
                  const isSelected = selectedDocIds.includes(doc.id);
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => toggleDoc(doc.id)}
                      title={isSelected ? `Attached: ${doc.name} (click to detach)` : `Click to attach ${doc.name}`}
                      className={`group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                        isSelected
                          ? "border-primary/50 bg-primary/10 text-primary shadow-xs"
                          : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      }`}
                    >
                      <span
                        className={`flex size-3.5 items-center justify-center rounded-sm border transition-colors ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40 group-hover:border-foreground"
                        }`}
                      >
                        {isSelected && <Check className="size-2.5 stroke-[3]" />}
                      </span>
                      <FileText className="size-3 shrink-0" />
                      <span className="max-w-[200px] truncate">{doc.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <PromptInput
            className="shadow-soft rounded-2xl bg-card"
            onSubmit={(msg) => {
              const text = msg.text?.trim();
              if (!text || busy) return;
              sendMessage({ text });
              setInput("");
            }}
          >
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                selectedDocIds.length >= 2
                  ? `Ask a question across ${selectedDocIds.length} attached documents...`
                  : t("placeholder")
              }
              autoFocus
            />
            <PromptInputFooter className="justify-between">
              <VoiceButton onText={(text) => setInput(text)} />
              <PromptInputSubmit status={status} onStop={stop} disabled={!busy && !input.trim()} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </section>

      <aside className="hidden w-96 shrink-0 flex-col border-l bg-card lg:flex">
        <div className="border-b px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <FileText className="size-4 text-secondary" /> {t("sources")}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {panelSources.length ? (
            <Sources sources={panelSources} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("s6")}</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  const { t } = useI18n();

  // Group sources by document
  const grouped = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of sources) {
      const doc = s.document || "Document";
      if (!map.has(doc)) map.set(doc, []);
      map.get(doc)!.push(s);
    }
    return Array.from(map.entries());
  }, [sources]);

  return (
    <div className="space-y-5">
      {grouped.map(([docName, docSources]) => (
        <div key={docName} className="space-y-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs font-semibold text-foreground border">
            <FileText className="size-3.5 text-primary shrink-0" />
            <span className="truncate flex-1 font-mono">{docName}</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {docSources.length} {docSources.length === 1 ? "excerpt" : "excerpts"}
            </span>
          </div>
          <ol className="space-y-2 pl-1">
            {docSources.map((s) => (
              <li key={s.n} className="rounded-xl border bg-background p-3.5 shadow-sm">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <span className="flex size-5 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
                    {s.n}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/80">{s.document}</span>
                  {s.page ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t("page")} {s.page}
                    </span>
                  ) : null}
                </p>
                <p className="mt-2 border-l-2 border-secondary pl-2.5 text-xs leading-relaxed text-muted-foreground">
                  {s.snippet}…
                </p>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
