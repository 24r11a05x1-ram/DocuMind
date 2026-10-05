import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
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
    if (Array.isArray(obj.parts)) {
      return {
        id: (obj.id as string) || id,
        role: (obj.role as "user" | "assistant") || role,
        parts: obj.parts as Msg["parts"],
        metadata: obj.metadata as Msg["metadata"],
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
  const transport = useMemo(
    () =>
      new DefaultChatTransport<Msg>({
        api: "/api/chat",
        body: { threadId, language: langName },
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
          <h1 className="text-base font-semibold">{t("askTitle")}</h1>
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
                        <button
                          type="button"
                          onClick={() => setPicked(m.id)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:bg-secondary hover:text-secondary-foreground"
                        >
                          <FileText className="size-3.5" /> {m.metadata!.sources!.length} {t("sources")}
                        </button>
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
          <PromptInput
            className="shadow-soft rounded-2xl bg-card"
            onSubmit={(msg) => {
              const text = msg.text?.trim();
              if (!text || busy) return;
              sendMessage({ text });
              setInput("");
            }}
          >
            <PromptInputTextarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("placeholder")} autoFocus />
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
  return (
    <ol className="space-y-3">
      {sources.map((s) => (
        <li key={s.n} className="rounded-xl border bg-background p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">{s.n}</span>
            <span className="min-w-0 flex-1 truncate">{s.document}</span>
            {s.page ? <span className="text-xs text-muted-foreground">{t("page")} {s.page}</span> : null}
          </p>
          <p className="mt-2 border-l-2 border-secondary pl-3 text-sm leading-relaxed text-muted-foreground">{s.snippet}…</p>
        </li>
      ))}
    </ol>
  );
}
