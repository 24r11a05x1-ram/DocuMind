import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
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
      // Ignore
    }
  }
  return envCache[key] || envCache[viteKey];
}

const MAX = 12 * 1024 * 1024;

function err(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const geminiKey =
          getEnv("GEMINI_API_KEY") ||
          getEnv("GOOGLE_GENERATIVE_AI_API_KEY") ||
          getEnv("GOOGLE_API_KEY");
        const lovableKey = getEnv("LOVABLE_API_KEY");
        const openaiKey = getEnv("OPENAI_API_KEY");
        const url = getEnv("SUPABASE_URL") || "https://yweefvfmutrutogxtyis.supabase.co";
        const anon =
          getEnv("SUPABASE_PUBLISHABLE_KEY") ||
          "sb_publishable_JuS6yJGn8w1-PN-Ss5cHhw_ta_3TZLS";

        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return err(401, "Please sign in");
        const sb = createClient(url, anon, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: u } = await sb.auth.getUser(token);
        if (!u.user) return err(401, "Please sign in");

        const len = Number(request.headers.get("content-length") ?? 0);
        if (len > MAX + 64 * 1024) return err(413, "Recording is too long");
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > MAX)
          return err(400, "No audio recorded");

        const lang = form.get("language") || "English";

        // 1. Google Gemini Audio Transcription (using user's Gemini key)
        if (geminiKey) {
          try {
            const buffer = Buffer.from(await file.arrayBuffer());
            const base64Audio = buffer.toString("base64");
            const mimeType = file.type || "audio/webm";

            const model = getEnv("GEMINI_MODEL") || "gemini-3.8-flash";
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [
                    {
                      parts: [
                        {
                          inlineData: {
                            mimeType,
                            data: base64Audio,
                          },
                        },
                        {
                          text: `Transcribe the speech in this audio accurately in ${lang}. Output ONLY the raw transcript text with no formatting, no markdown, no quotes, and no intro/outro.`,
                        },
                      ],
                    },
                  ],
                }),
                signal: request.signal,
              },
            );

            if (!response.ok) {
              const errBody = await response.text();
              console.error("Gemini transcribe error:", response.status, errBody);
              return err(response.status, `Gemini transcription failed: ${response.statusText}`);
            }

            const data = await response.json();
            const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

            const sse = `data: ${JSON.stringify({
              type: "transcript.text.delta",
              delta: transcript,
            })}\n\ndata: ${JSON.stringify({
              type: "transcript.text.done",
              text: transcript,
            })}\n\n`;

            return new Response(sse, {
              status: 200,
              headers: { "content-type": "text/event-stream; charset=utf-8" },
            });
          } catch (e) {
            console.error("Gemini audio transcription exception:", e);
            return err(500, e instanceof Error ? e.message : "Transcription failed");
          }
        }

        // 2. Lovable Gateway
        if (lovableKey) {
          const out = new FormData();
          out.append("model", "google/gemini-3.5-transcribe");
          out.append("file", new File([file], "question.webm", { type: "audio/webm" }));
          out.append("response_format", "json");
          out.append("stream", "true");
          if (typeof lang === "string" && /^[a-z]{2}$/.test(lang)) out.append("language", lang);

          const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableKey}` },
            body: out,
            signal: request.signal,
          });
          return new Response(res.body, {
            status: res.status,
            headers: { "content-type": res.headers.get("content-type") ?? "text/event-stream" },
          });
        }

        // 3. OpenAI Whisper
        if (openaiKey) {
          const out = new FormData();
          out.append("model", "whisper-1");
          out.append("file", new File([file], "question.webm", { type: "audio/webm" }));
          out.append("response_format", "json");
          const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${openaiKey}` },
            body: out,
            signal: request.signal,
          });
          const jsonRes = await res.json();
          const transcript = jsonRes.text || "";
          const sse = `data: ${JSON.stringify({
            type: "transcript.text.delta",
            delta: transcript,
          })}\n\ndata: ${JSON.stringify({
            type: "transcript.text.done",
            text: transcript,
          })}\n\n`;

          return new Response(sse, {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          });
        }

        return err(503, "Voice transcription requires GEMINI_API_KEY in .env");
      },
    },
  },
});
