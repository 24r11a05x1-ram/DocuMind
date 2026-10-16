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
            const key = match[1];
            if (!key) continue;
            let val = (match[2] || "").trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            envCache[key] = val;
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
  const url = getEnv("SUPABASE_URL") || "https://uuyfpqfptizdnmvsstyb.supabase.co";
  const anon = getEnv("SUPABASE_PUBLISHABLE_KEY") || "sb_publishable_q8w4-Tj4YJnJvRUZzoJzHQ_9XbKhm84";

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, "Please sign in");

  const isExpiredDomain =
    !url ||
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

  let body: { messages?: UIMessage[]; threadId?: string; language?: string; documentIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return json(400, "Invalid request");
  }
  const messages = body.messages;
  const threadId = body.threadId;
  const language = typeof body.language === "string" ? body.language.slice(0, 40) : "English";
  const selectedDocIds = Array.isArray(body.documentIds) && body.documentIds.length > 0 ? body.documentIds : undefined;
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
      getEnv("GEMINI_MODEL") || "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
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

  // 2. High-Accuracy Multi-Document Retrieval Engine
  const STOP_WORDS = new Set([
    "the", "is", "at", "which", "on", "a", "an", "and", "or", "to", "in",
    "for", "with", "about", "of", "by", "from", "as", "what", "give", "tell",
    "me", "how", "why", "when", "who", "where", "can", "you", "does", "did",
    "their", "his", "her", "its", "are", "were", "been", "has", "have", "had",
    "this", "that", "these", "those", "both", "attached", "document", "documents", "file", "files",
    "show", "provide", "list", "summarize", "summary", "explain", "describe", "compare", "between"
  ]);

  const cleanTerms = (text: string) =>
    text
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\w\u0C00-\u0C7F]/g, ""))
      .filter((t) => t.length > 1);

  const rawKeywords = Array.from(new Set([...cleanTerms(searchKeywords), ...cleanTerms(question)]));
  const searchTokens = rawKeywords.filter((t) => !STOP_WORDS.has(t));
  const activeTokens = searchTokens.length > 0 ? searchTokens : rawKeywords;

  // Determine target document IDs (either explicitly attached or recent user documents)
  let targetDocIds = selectedDocIds;
  if (!targetDocIds || targetDocIds.length === 0) {
    if (supabase && !isExpiredDomain) {
      try {
        const { data: userDocs } = await supabase
          .from("documents")
          .select("id, name")
          .order("created_at", { ascending: false })
          .limit(4);
        if (userDocs && userDocs.length > 0) {
          targetDocIds = userDocs.map((d: any) => d.id);
        }
      } catch {}
    }
    if (!targetDocIds || targetDocIds.length === 0) {
      const localDocs = localDb.getDocuments();
      if (localDocs && localDocs.length > 0) {
        targetDocIds = localDocs.map((d) => d.id);
      }
    }
  }

  interface CandidateChunk {
    id: string;
    document_id: string;
    document_name: string;
    page: number | null;
    content: string;
  }
  let candidateChunks: CandidateChunk[] = [];

  // Query Supabase chunks directly if authenticated
  if (supabase && !isExpiredDomain) {
    try {
      let query = supabase.from("chunks").select("id, document_id, page, content, documents!inner(name)");
      if (targetDocIds && targetDocIds.length > 0) {
        query = query.in("document_id", targetDocIds);
      }
      const { data: rawChunks } = await query.limit(300);
      if (rawChunks && rawChunks.length > 0) {
        candidateChunks = rawChunks.map((c: any) => ({
          id: c.id,
          document_id: c.document_id,
          document_name: c.documents?.name || "Document",
          page: c.page,
          content: c.content,
        }));
      }
    } catch (e) {
      console.warn("Supabase direct chunks query failed:", e);
    }
  }

  // Fallback / complement with localDb chunks
  if (!candidateChunks.length) {
    const dbDocs = new Map(localDb.getDocuments().map((d) => [d.id, d.name]));
    const localAll = localDb.getChunks(500);
    const eligible = targetDocIds && targetDocIds.length > 0
      ? localAll.filter((c) => targetDocIds.includes(c.document_id))
      : localAll;
    candidateChunks = eligible.map((c) => ({
      id: c.id,
      document_id: c.document_id,
      document_name: dbDocs.get(c.document_id) || c.document_name || "Document",
      page: c.page,
      content: c.content,
    }));
  }

  // Score candidate chunks
  const scoredChunks = candidateChunks.map((c) => {
    const lower = c.content.toLowerCase();
    let score = 0;

    // Exact phrase match bonus
    if (activeTokens.length > 1) {
      const phrase = activeTokens.join(" ");
      if (lower.includes(phrase)) score += 20;
    }

    // Token occurrences
    for (const token of activeTokens) {
      if (lower.includes(token)) {
        const matches = lower.split(token).length - 1;
        score += matches * 4 + token.length;
      }
    }

    // Early page boost (page 1, 2) for summary/title/certificate
    if (c.page && c.page <= 2) {
      score += 2;
    }

    return {
      ...c,
      score,
    };
  });

  // Group chunks by document so EACH document is guaranteed an equal quota
  const chunksByDoc = new Map<string, typeof scoredChunks>();
  for (const item of scoredChunks) {
    if (!chunksByDoc.has(item.document_id)) {
      chunksByDoc.set(item.document_id, []);
    }
    chunksByDoc.get(item.document_id)!.push(item);
  }

  const activeDocIdsList = targetDocIds && targetDocIds.length > 0
    ? targetDocIds.filter((id) => chunksByDoc.has(id))
    : Array.from(chunksByDoc.keys());

  const effectiveDocCount = Math.max(1, activeDocIdsList.length);
  const perDocQuota = Math.max(3, Math.floor(14 / effectiveDocCount));
  const hits: Array<CandidateChunk & { score: number }> = [];

  for (const docId of activeDocIdsList) {
    const docItems = chunksByDoc.get(docId) || [];
    docItems.sort((a, b) => b.score - a.score || (a.page || 0) - (b.page || 0));

    const selectedForDoc = docItems.slice(0, perDocQuota);
    hits.push(...selectedForDoc);
  }

  // Fallback if no hits were found
  if (!hits.length && candidateChunks.length) {
    hits.push(...candidateChunks.slice(0, 8).map((c) => ({ ...c, score: 0.1 })));
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

  const docNamesInHits = Array.from(new Set((hits ?? []).map((h) => h.document_name)));
  const isMultiDoc = docNamesInHits.length > 1;

  // Format context excerpts grouped by document name with clean section markers
  let context = "";
  if (isMultiDoc) {
    context = docNamesInHits
      .map((docName) => {
        const docHits = hits.filter((h) => h.document_name === docName);
        const header = `=== ATTACHED DOCUMENT: "${docName}" ===`;
        const items = docHits
          .map((h) => {
            const idx = hits.indexOf(h) + 1;
            return `[${idx}] (Page ${h.page || 1}):\n${h.content}`;
          })
          .join("\n\n");
        return `${header}\n${items}`;
      })
      .join("\n\n----------------------------------------\n\n");
  } else {
    context = (hits ?? [])
      .map((h, i) => `[${i + 1}] ${h.document_name}${h.page ? ` – page ${h.page}` : ""}\n${h.content}`)
      .join("\n\n");
  }

  const system = `You are DocuMind, an intelligent document Q&A assistant with full multilingual capabilities.
${isMultiDoc ? `
MULTI-DOCUMENT COMPARATIVE & SYNTHESIS INSTRUCTIONS:
The user has attached multiple documents simultaneously (${docNamesInHits.map((d) => `"${d}"`).join(" AND ")}).
1. **Cross-Document Synthesis**: Read, correlate, and synthesize information from BOTH documents into a single, cohesive answer.
2. **Explicit Attribution**: Clearly identify which document each fact or answer comes from (e.g. "From ${docNamesInHits[0]}, ... while in ${docNamesInHits[1] || "the second document"}, ...").
3. **Compare & Contrast**: When the question asks for comparisons, differences, or shared aspects between the two documents, structure your answer with clear comparative headings or bullet points.
4. **Balanced Representation**: Do NOT ignore either document. Address information from both attached documents thoroughly.
` : `
1. **Document Context**: Answer using the numbered context excerpts [1], [2] from the user's uploaded document.
`}
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

  // 3. Direct Fast Gemini Model Generation (1-2s response time)
  if (geminiKey) {
    const geminiModels = [
      getEnv("GEMINI_MODEL") || "gemini-3.8-flash",
      "gemini-flash-latest",
      "gemini-2.5-flash-lite",
      "gemini-3.5-flash-lite",
    ];

    let geminiText = "";
    for (const modelName of geminiModels) {
      try {
        const fullPrompt = `${system}\n\nUser Question: ${question}\n\nAnswer accurately and concisely with inline source citations [1], [2]:`;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: {
                maxOutputTokens: 2048,
                temperature: 0.2,
              },
            }),
            signal: AbortSignal.timeout(20000),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (candidate) {
            geminiText = candidate;
            break;
          }
        }
      } catch (err) {
        console.warn(`Gemini model ${modelName} failed or timed out:`, err);
      }
    }

    if (geminiText) {
      const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
          writer.write({
            type: "start",
            messageMetadata: { sources },
          });
          writer.write({ type: "text-start", id: "0" });

          const words = geminiText.split(" ");
          for (let i = 0; i < words.length; i += 3) {
            const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
            writer.write({ type: "text-delta", id: "0", delta: chunk });
            await new Promise((r) => setTimeout(r, 10));
          }

          writer.write({ type: "text-end", id: "0" });
          writer.write({ type: "finish" });
        },
        onFinish: async ({ responseMessage }) => {
          await saveAssistantMessage(
            responseMessage.id || Math.random().toString(36).slice(2),
            geminiText,
          );
        },
      });

      return createUIMessageStreamResponse({ stream: uiStream });
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
    if (isMultiDoc) {
      answerContent = `### 📚 Multi-Document Comparative Analysis\n\n`;
      answerContent += `I analyzed your attached documents (**${docNamesInHits.join("** and **")}**) to answer your question: *"${question}"*\n\n`;

      for (const docName of docNamesInHits) {
        const docHits = hits.filter((h) => h.document_name === docName);
        answerContent += `#### 📄 From **${docName}**:\n`;
        docHits.slice(0, 3).forEach((h) => {
          const idx = hits.indexOf(h) + 1;
          answerContent += `- ${h.content.trim().slice(0, 280)}... [${idx}]\n`;
        });
        answerContent += "\n";
      }

      answerContent += `#### 🔍 **Cross-Document Synthesis & Findings:**\n`;
      answerContent += `The attached documents provide complementary information. Details extracted from **${docNamesInHits[0]}** directly correlate with facts outlined in **${docNamesInHits[1] || docNamesInHits[0]}**. Refer to the inline citations above for corresponding context.\n\n`;
    } else if (hits.length > 0 && hits[0]) {
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
    }
  } else {
    answerContent = `I searched your uploaded documents but couldn't find excerpts matching **"${question}"**.\n\nPlease upload or select documents in the sidebar to ask questions about them.\n\n`;
  }

  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageMetadata: { sources },
      });
      writer.write({ type: "text-start", id: "0" });

      const words = answerContent.split(" ");
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
        writer.write({ type: "text-delta", id: "0", delta: chunk });
        await new Promise((r) => setTimeout(r, 12));
      }

      writer.write({ type: "text-end", id: "0" });
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
