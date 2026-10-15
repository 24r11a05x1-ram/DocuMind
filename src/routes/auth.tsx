import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Sparkles, FileText, ArrowRight, Loader2, Languages } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useSession } from "@/hooks/use-session";
import { useI18n, LanguageSelect } from "@/lib/i18n";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — DocuMind" },
      { name: "description", content: "Sign in to DocuMind to chat with your documents." },
      { property: "og:title", content: "Sign in — DocuMind" },
      { property: "og:description", content: "Sign in to DocuMind to chat with your documents." },
    ],
  }),
  component: AuthPage,
});

function GoogleIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function AuthPage() {
  const nav = useNavigate();
  const { t } = useI18n();
  const { session, loading } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) {
      nav({ to: "/chat", replace: true });
    }
  }, [session, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Please provide both email and password.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });
        if (error) {
          if (error.message.toLowerCase().includes("email not confirmed")) {
            toast.error("Email not confirmed. In Supabase Dashboard > Auth > Providers > Email, turn OFF 'Confirm email', or check 'Auto Confirm User' in Auth Users.");
          } else {
            toast.error(error.message || "Failed to sign in. Please verify your credentials.");
          }
        } else {
          toast.success("Signed in successfully!");
          nav({ to: "/chat", replace: true });
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
          options: { emailRedirectTo: `${window.location.origin}/chat` },
        });
        if (error) {
          toast.error(error.message || "Failed to create account.");
        } else if (!data.session) {
          toast.success("Account created! Check your email to confirm, or use demo account to log in directly.");
        } else {
          toast.success("Account created and signed in!");
          nav({ to: "/chat", replace: true });
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication error occurred.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/chat`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (error) {
        if (error.message.toLowerCase().includes("provider is not enabled")) {
          toast.error(
            "Google provider is not enabled yet in Supabase! Please enable it in your Supabase Dashboard > Authentication > Providers > Google.",
            { duration: 8000 }
          );
        } else {
          toast.error(error.message || "Google sign-in failed.");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function quickDemoLogin() {
    setBusy(true);
    try {
      setEmail("admin@documind.ai");
      setPassword("DocuMind2026!Key");
      const { error } = await supabase.auth.signInWithPassword({
        email: "admin@documind.ai",
        password: "DocuMind2026!Key",
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Logged in with Demo Account!");
        nav({ to: "/chat", replace: true });
      }
    } catch (err) {
      toast.error("Demo login failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper-grain p-4 sm:p-6 lg:p-8">
      {/* Top Header: Language and Home link */}
      <div className="mb-6 flex w-full max-w-4xl items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 transition hover:opacity-80">
          <img src={logo} alt="DocuMind logo" width={36} height={36} className="size-9 rounded-lg shadow-sm" />
          <span className="text-xl font-extrabold tracking-tight text-foreground">
            Docu<span className="text-primary">Mind</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSelect />
        </div>
      </div>

      {/* Main Container Card */}
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border bg-card shadow-xl lg:grid-cols-12">
        {/* Left / Form Section */}
        <div className="flex flex-col justify-between p-6 sm:p-10 lg:col-span-7">
          <div>
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {mode === "in" ? t("welcome") : t("createAccount")}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {mode === "in"
                  ? "Sign in to access your document threads and AI workspace."
                  : "Create an account to start chatting with your PDF & Word documents."}
              </p>
            </div>

            {/* Google Login Button */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted/80 disabled:opacity-60"
            >
              <GoogleIcon />
              <span>{t("google")}</span>
            </button>

            {/* Divider */}
            <div className="relative my-5 text-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <span className="relative bg-card px-3 text-xs uppercase tracking-wider text-muted-foreground">
                {t("or")}
              </span>
            </div>

            {/* Email & Password Form */}
            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  {t("email")}
                </label>
                <div className="relative">
                  <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background py-2.5 pr-3 pl-10 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  {t("password")}
                </label>
                <div className="relative">
                  <Lock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background py-2.5 pr-10 pl-10 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="bg-brand-gradient mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-95 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <span>{mode === "in" ? t("signIn") : t("signUp")}</span>
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </form>

            {/* Toggle Mode */}
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setMode(mode === "in" ? "up" : "in")}
                className="text-xs text-muted-foreground transition hover:text-primary"
              >
                {mode === "in" ? (
                  <>
                    Don&apos;t have an account? <span className="font-semibold text-primary">{t("signUp")}</span>
                  </>
                ) : (
                  <>
                    Already have an account? <span className="font-semibold text-primary">{t("signIn")}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 1-Click Instant Demo Login (Uses 0 Credits) */}
          <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-primary">
                <ShieldCheck className="size-4" />
                <span>Instant Demo Access</span>
              </div>
              <button
                type="button"
                onClick={quickDemoLogin}
                disabled={busy}
                className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                1-Click Login
              </button>
            </div>
            <p className="mt-1 text-muted-foreground">
              Sign in with pre-verified test credentials (no external credit usage):
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-foreground">
              <span><strong>Email:</strong> admin@documind.ai</span>
              <span><strong>Pass:</strong> DocuMind2026!Key</span>
            </div>
          </div>
        </div>

        {/* Right / Feature Showcase Side Panel */}
        <div className="bg-brand-gradient hidden flex-col justify-between p-8 text-primary-foreground lg:col-span-5 lg:flex">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-md">
              <Sparkles className="size-3.5" /> Next-Gen Document AI
            </span>
            <h2 className="mt-6 text-2xl font-bold leading-snug">
              Chat intelligently with your documents in any language.
            </h2>
            <p className="mt-3 text-sm text-primary-foreground/80 leading-relaxed">
              Upload research papers, manuals, and reports. Ask questions in Telugu, English, or any language and get grounded answers with source citations.
            </p>

            <ul className="mt-8 space-y-4 text-xs">
              <li className="flex items-start gap-3 rounded-xl bg-white/10 p-3 backdrop-blur-sm">
                <Languages className="size-4 shrink-0 text-white" />
                <div>
                  <strong className="block font-semibold text-white">Cross-Language Intelligence</strong>
                  <span>Ask in Telugu on English documents with automatic context translation.</span>
                </div>
              </li>
              <li className="flex items-start gap-3 rounded-xl bg-white/10 p-3 backdrop-blur-sm">
                <FileText className="size-4 shrink-0 text-white" />
                <div>
                  <strong className="block font-semibold text-white">Precise Source Citations</strong>
                  <span>Direct page numbers and text excerpt references for every claim.</span>
                </div>
              </li>
            </ul>
          </div>

          <p className="text-center text-[11px] text-primary-foreground/60">
            Powered by Google Gemini & Supabase &middot; DocuMind
          </p>
        </div>
      </div>
    </main>
  );
}
