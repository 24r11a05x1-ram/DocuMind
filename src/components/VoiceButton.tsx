import { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createParser } from "eventsource-parser";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

type State = "idle" | "recording" | "transcribing";

// Type declaration for Web Speech API
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal: boolean;
    };
    length: number;
  };
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: { error: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

export function VoiceButton({ onText }: { onText: (text: string, final?: boolean) => void }) {
  const { lang, t } = useI18n();
  const [state, setState] = useState<State>("idle");
  const rec = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  async function start() {
    // 1. Try Browser Native Speech Recognition (Supported in Chrome, Edge, Safari)
    const SpeechRecognitionClass =
      typeof window !== "undefined"
        ? (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition
        : undefined;

    if (SpeechRecognitionClass) {
      try {
        const recognition = new SpeechRecognitionClass();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = lang || "en-US";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (!result) continue;
            const first = result[0];
            if (!first) continue;
            const transcript = first.transcript;
            if (result.isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }

          const currentText = finalTranscript || interimTranscript;
          if (currentText) {
            onText(currentText, !!finalTranscript);
          }
        };

        recognition.onerror = () => {
          // If native recognition errors, fallback to audio recording
          stopNative();
          void startMediaRecorder();
        };

        recognition.onend = () => {
          setState("idle");
        };

        recognition.start();
        recognitionRef.current = recognition;
        setState("recording");
        return;
      } catch (err) {
        console.warn("Native speech recognition failed, falling back to Gemini audio recorder:", err);
      }
    }

    // 2. Fallback to MediaRecorder + Gemini backend transcription
    await startMediaRecorder();
  }

  function stopNative() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
  }

  async function startMediaRecorder() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        void send(new Blob(chunks, { type: "audio/webm" }));
      };

      mr.start();
      rec.current = mr;
      setState("recording");
    } catch {
      toast.error(t("micDenied"));
      setState("idle");
    }
  }

  function stop() {
    if (recognitionRef.current) {
      stopNative();
      setState("idle");
    } else if (rec.current && state === "recording") {
      rec.current.stop();
    }
  }

  async function send(blob: Blob) {
    if (blob.size < 1000) {
      setState("idle");
      return;
    }
    setState("transcribing");

    try {
      const { data } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append("file", blob, "question.webm");
      fd.append("language", lang);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
        body: fd,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? j?.error ?? j?.message ?? `Error ${res.status}`);
      }

      let text = "";
      let done = false;
      const parser = createParser({
        onEvent: (ev) => {
          try {
            const d = JSON.parse(ev.data);
            if (d.type === "transcript.text.delta") {
              text += d.delta;
              onText(text, false);
            }
            if (d.type === "transcript.text.done") {
              text = d.text;
              done = true;
              onText(text, true);
            }
            if (d.type === "error") throw new Error(d.error?.message ?? "Transcription failed");
          } catch (e) {
            if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
          }
        },
      });

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        parser.feed(value);
      }

      if (!done && text) onText(text, true);
      if (!text.trim()) toast.error(t("noSpeech"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transcription failed");
    }
    setState("idle");
  }

  const label = state === "recording" ? t("stopRec") : t("speak");
  return (
    <button
      type="button"
      onClick={() => (state === "recording" ? stop() : state === "idle" && start())}
      disabled={state === "transcribing"}
      aria-label={label}
      title={label}
      className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition ${
        state === "recording"
          ? "animate-pulse bg-destructive text-destructive-foreground"
          : "bg-accent text-accent-foreground hover:bg-primary hover:text-primary-foreground"
      }`}
    >
      {state === "recording" ? (
        <Square className="size-4" />
      ) : state === "transcribing" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Mic className="size-4" />
      )}
      <span>
        {state === "recording"
          ? t("listening")
          : state === "transcribing"
            ? t("transcribing")
            : t("speak")}
      </span>
    </button>
  );
}
