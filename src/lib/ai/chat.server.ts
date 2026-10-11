import { createOpenAI } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import type { Database } from "@/integrations/supabase/types";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./run-id.server";
import { localDb } from "@/lib/local-db";
import fs from "node:fs";
import path from "node:path";

let envCache: Record<string, string> | null = null;
function getEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const viteKey = key.startsWith("VITE_") ? key : `VITE_${key}`;
  if (process.env[viteKey]) return process.env[viteKey];

  if (!envCache) {
    envCache = {};
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
          if (match) {
            let val = (match[2] || "").trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            envCache[match[1]] = val;
          }
        }
      }
    } catch {
      // Ignore errors reading local .env file
    }
  }
  return envCache[key] || envCache[viteKey];
}

export type Source = { n: number; document: string; page: number | null; snippet: string };

function json(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textOf(m: UIMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ");
}

export async function handleChat(request: Request) {
  const url = getEnv("SUPABASE_URL") || "https://yweefvfmutrutogxtyis.supabase.co";
  const anon = getEnv("SUPABASE_PUBLISHABLE_KEY") || "sb_publishable_JuS6yJGn8w1-PN-Ss5cHhw_ta_3TZLS";

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, "Please sign in");

  const isExpiredDomain =
    !url ||
    url.includes("yweefvfmutrutogxtyis") ||
    url.includes("example") ||
    url.includes("placeholder");

  let user: { id: string; email: string } | null = null;
  let supabase: any = null;

  if (isExpiredDomain || token.startsWith("local-token-")) {
    const localUser = localDb.verifyToken(token);
    if (localUser) user = { id: localUser.id, email: localUser.email };
  } else {
    try {
      supabase = createClient<Database>(url, anon, {
        global: {
          headers: { Authorization: `Bearer ${token}` },
          fetch: (input, init) => {
            const h = new Headers(init?.headers);
            h.set("apikey", anon);
            return fetch(input, { ...init, headers: h });
          },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user) user = { id: userData.user.id, email: userData.user.email || "" };
    } catch {}
    if (!user) {
      const localUser = localDb.verifyToken(token);
      if (localUser) user = { id: localUser.id, email: localUser.email };
    }
  }

  if (!user) return json(401, "Please sign in");

  let body: { messages?: UIMessage[]; threadId?: string; language?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, "Invalid request");
  }
  const messages = body.messages;
  const threadId = body.threadId;
  const language = typeof body.language === "string" ? body.language.slice(0, 40) : "English";
  if (!Array.isArray(messages) || !messages.length || typeof threadId !== "string")
    return json(400, "Invalid request");

  let threadTitle = "New chat";
  if (supabase && !isExpiredDomain) {
    try {
      const { data: thread } = await supabase
        .from("threads")
        .select("id,title")
        .eq("id", threadId)
        .maybeSingle();
      if (thread) threadTitle = thread.title;
    } catch {}
  } else {
    let localThread = localDb.getThread(threadId);
    if (!localThread) {
      localThread = localDb.createThread(user.id, "New chat");
    }
    threadTitle = localThread.title;
  }

  const last = messages[messages.length - 1]!;
  const question = last.role === "user" ? textOf(last) : "";

  // Persist user message
  if (last.role === "user") {
    const userParts = Array.isArray(last.parts) ? last.parts : [{ type: "text", text: question }];
    localDb.insertMessage(user.id, {
      thread_id: threadId,
      ui_id: last.id,
      role: "user",
      parts: { id: last.id, role: "user", parts: userParts },
    });

    if (supabase && !isExpiredDomain) {
      try {
        await supabase.from("messages").insert({
          thread_id: threadId,
          ui_id: last.id,
          role: "user",
          parts: { id: last.id, role: "user", parts: userParts } as never,
        });
        const patch: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
        if (threadTitle === "New chat" && question) patch.title = question.slice(0, 60);
        await supabase.from("threads").update(patch).eq("id", threadId);
      } catch {}
    } else {
      if (threadTitle === "New chat" && question) {
        localDb.updateThread(threadId, { title: question.slice(0, 60) });
      }
    }
  }

  // Available AI keys
  const lovableKey = getEnv("LOVABLE_API_KEY");
  const geminiKey =
    getEnv("GEMINI_API_KEY") ||
    getEnv("GOOGLE_GENERATIVE_AI_API_KEY") ||
    getEnv("GOOGLE_API_KEY");
  const openaiKey = getEnv("OPENAI_API_KEY");
  const groqKey = getEnv("GROQ_API_KEY");
  const openrouterKey = getEnv("OPENROUTER_API_KEY");

  // 1. Cross-Lingual Search Translation: If asked in Telugu / Hindi / non-English, extract English terms
  let searchKeywords = question;
  const isNonEnglish = /[^\x00-\x7F]/.test(question);

  if (question && isNonEnglish && geminiKey) {
    const modelsToTry = [
      getEnv("GEMINI_MODEL") || "gemini-3.8-flash",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-flash-latest",
    ];

    for (const model of modelsToTry) {
      try {
        const trRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `The user asked this question in a regional/foreign language:\n"${question}"\n\nTask: Translate this question into 3-6 English keywords to search English technical documents. Output ONLY space-separated English words.`,
                    },
                  ],
                },
              ],
            }),
            signal: AbortSignal.timeout(4000),
          }
        );
        if (trRes.ok) {
          const trData = await trRes.json();
          const extracted = trData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (extracted) {
            searchKeywords = extracted.replace(/[^\w\s]/g, " ").trim();
            break;
          }
        }
      } catch {
        // continue to next model
      }
    }
  }

  // 2. Retrieval: Search Chunks
  let hits: any[] = [];
  if (supabase && !isExpiredDomain) {
    try {
      const { data } = await supabase.rpc("search_chunks", {
        q: searchKeywords,
        k: 6,
      });
      if (data && data.length > 0) hits = data;
    } catch {}
  }

  // Fallback to localDb chunk search
  if (!hits || hits.length === 0) {
    hits = localDb.searchChunks(searchKeywords, 6);
  }

  // If 0 hits with translated keywords, try searching original question
  if ((!hits || hits.length === 0) && searchKeywords !== question) {
    if (supabase && !isExpiredDomain) {
      try {
        const fallbackSearch = await supabase.rpc("search_chunks", {
          q: question,
          k: 6,
        });
        if (fallbackSearch.data && fallbackSearch.data.length > 0) {
          hits = fallbackSearch.data;
        }
      } catch {}
    }
    if (!hits || hits.length === 0) {
      hits = localDb.searchChunks(question, 6);
    }
  }

  // If still 0 hits, fetch top document chunks
  if (!hits || hits.length === 0) {
    hits = localDb.getChunks(6);
  }

  const sources: Source[] = (hits ?? []).map((h, i) => ({
    n: i + 1,
    document: h.document_name,
    page: h.page,
    snippet: h.content.slice(0, 220),
  }));

  const saveAssistantMessage = async (msgId: string, answerText: string) => {
    const parts = [{ type: "text", text: answerText || "Answer generated." }];
    localDb.insertMessage(user.id, {
      thread_id: threadId,
      ui_id: msgId || Math.random().toString(36).slice(2),
      role: "assistant",
      parts: {
        id: msgId,
        role: "assistant",
        parts,
        metadata: { sources },
      },
    });
    if (supabase && !isExpiredDomain) {
      try {
        await supabase.from("messages").insert({
          thread_id: threadId,
          ui_id: msgId || Math.random().toString(36).slice(2),
          role: "assistant",
          parts: {
            id: msgId,
            role: "assistant",
            parts,
            metadata: { sources },
          } as never,
        });
      } catch {}
    }
  };

  const context = (hits ?? [])
    .map((h, i) => `[${i + 1}] ${h.document_name}${h.page ? ` – page ${h.page}` : ""}\n${h.content}`)
    .join("\n\n");

  const system = `You are DocuMind, an intelligent document Q&A assistant with full multilingual capabilities.

CRITICAL INSTRUCTIONS:
1. **Document Context**: Answer using the numbered context excerpts [1], [2] from the user's uploaded documents (which may be in English).
2. **Language Policy**:
   - The user may ask questions in Telugu (తెలుగు), Hindi, or any other language about an English document.
   - You MUST ALWAYS respond in the EXACT SAME LANGUAGE that the user asked the question in!
   - If the user asks in Telugu, translate the knowledge from the English document excerpts into clear, natural, grammatically correct Telugu script.
   - If the user asks in English, answer in English.
   - Fallback language: ${language}.
3. **Citations**: Cite sources inline like [1], [2] right after the corresponding claims or sentences.
4. **Formatting**: Use clean Markdown formatting (bullet points, clear paragraphs, bold titles).
5. **Truthfulness**: Rely strictly on the provided context excerpts to answer.

Context Excerpts:
${context || "(no relevant excerpts were found)"}`;

  // 3. Model Streaming with Auto-Fallback across active Gemini models
  if (geminiKey) {
    const geminiModels = [
      getEnv("GEMINI_MODEL") || "gemini-3.8-flash",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-flash-latest",
    ];

    const provider = createOpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: geminiKey,
    });

    for (const modelName of geminiModels) {
      try {
        const result = streamText({
          model: provider.chat(modelName),
          system,
          messages: await convertToModelMessages(messages),
          abortSignal: request.signal,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          sendReasoning: false,
          messageMetadata: ({ part }) => (part.type === "start" ? { sources } : undefined),
          onFinish: async ({ responseMessage }) => {
            let answerText = "";
            try {
              answerText = (await result.text).trim();
            } catch {}
            if (!answerText && Array.isArray(responseMessage.parts)) {
              answerText = responseMessage.parts
                .map((p: any) => (p && p.type === "text" ? p.text : ""))
                .join("")
                .trim();
            }
            await saveAssistantMessage(
              responseMessage.id || Math.random().toString(36).slice(2),
              answerText || "Answer generated.",
            );
          },
        });
      } catch (err) {
        console.warn(`Gemini model ${modelName} failed, trying next fallback:`, err);
      }
    }
  }

  // 4. OpenAI Provider
  if (openaiKey) {
    try {
      const provider = createOpenAI({
        baseURL: getEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1",
        apiKey: openaiKey,
      });
      const result = streamText({
        model: provider.chat(getEnv("OPENAI_MODEL") || "gpt-4o-mini"),
        system,
        messages: await convertToModelMessages(messages),
        abortSignal: request.signal,
      });

      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        sendReasoning: false,
        messageMetadata: ({ part }) => (part.type === "start" ? { sources } : undefined),
        onFinish: async ({ responseMessage }) => {
          let answerText = "";
          try {
            answerText = (await result.text).trim();
          } catch {}
          await saveAssistantMessage(
            responseMessage.id || Math.random().toString(36).slice(2),
            answerText || "Answer generated.",
          );
        },
      });
    } catch (err) {
      console.warn("OpenAI streamText failed:", err);
    }
  }

  // 5. Lovable Gateway
  if (lovableKey) {
    try {
      const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
      const provider = createOpenAI({
        baseURL: "https://ai.gateway.lovable.dev/v1",
        apiKey: lovableKey,
        headers: { "Lovable-API-Key": lovableKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
        fetch: runIdFetch.fetch,
      });
      const result = streamText({
        model: provider.responses("openai/gpt-6-sol"),
        system,
        messages: await convertToModelMessages(messages),
        abortSignal: request.signal,
      });

      const response = result.toUIMessageStreamResponse({
        originalMessages: messages,
        sendReasoning: true,
        messageMetadata: ({ part }) => (part.type === "start" ? { sources } : undefined),
        onFinish: async ({ responseMessage }) => {
          let answerText = "";
          try {
            answerText = (await result.text).trim();
          } catch {}
          await saveAssistantMessage(
            responseMessage.id || Math.random().toString(36).slice(2),
            answerText || "Answer generated.",
          );
        },
      });
      return withLovableAiGatewayRunIdHeader(response, runIdFetch);
    } catch (err) {
      console.warn("Lovable gateway failed:", err);
    }
  }

  // 6. Direct Document Q&A Synthesizer (Instant 0-Quota Fallback)
  let answerContent = "";
  if (hits && hits.length > 0) {
    const primary = hits[0];
    const secondary = hits.slice(1);
    answerContent = `Based on your uploaded document (**${primary.document_name}**)${primary.page ? ` (page ${primary.page})` : ""}:\n\n`;
    answerContent += `${primary.content.trim()} [1]\n\n`;
    if (secondary.length > 0) {
      answerContent += `**Relevant excerpts:**\n`;
      secondary.forEach((h, idx) => {
        answerContent += `- ${h.content.trim().slice(0, 260)}... [${idx + 2}]\n`;
      });
      answerContent += "\n";
    }
  } else {
    answerContent = `I searched your uploaded documents but couldn't find excerpts matching **"${question}"**.\n\nPlease upload or select a document in the sidebar to ask questions about it.\n\n`;
  }

  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageMetadata: { sources },
      });
      const partId = "text-part-0";
      writer.write({ type: "text-start", partId });

      const words = answerContent.split(" ");
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
        writer.write({ type: "text-delta", partId, textDelta: chunk });
        await new Promise((r) => setTimeout(r, 15));
      }

      writer.write({ type: "text-finish", partId });
      writer.write({ type: "finish" });
    },
    onFinish: async ({ responseMessage }) => {
      await saveAssistantMessage(
        responseMessage.id || Math.random().toString(36).slice(2),
        answerContent,
      );
    },
  });

  return createUIMessageStreamResponse({ stream: uiStream });
}
