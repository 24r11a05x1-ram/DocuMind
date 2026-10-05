import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, Network, Database, Search, Brain, Quote, Languages, Mic } from "lucide-react";
import { useI18n, LanguageSelect } from "@/lib/i18n";
import logo from "@/assets/logo.png";

import { useSession } from "@/hooks/use-session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DocuMind — RAG Q&A with source citations" },
      { name: "description", content: "Upload documents, ask questions, and get accurate answers with citations." },
      { property: "og:title", content: "DocuMind — RAG Q&A with source citations" },
      { property: "og:description", content: "Upload documents, ask questions, and get accurate answers with citations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const steps = [
  { icon: FileText, d: "s1" },
  { icon: Network, d: "s2" },
  { icon: Database, d: "s3" },
  { icon: Search, d: "s4" },
  { icon: Brain, d: "s5" },
  { icon: Quote, d: "s6" },
  { icon: Languages, d: "features" },
  { icon: Mic, d: "s7" },
] as const;

function Landing() {
  const { t } = useI18n();
  const { session } = useSession();
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <img src={logo} alt="DocuMind logo" width={36} height={36} className="size-9" />
          <span className="text-xl font-extrabold tracking-tight">
            Docu<span className="text-primary">Mind</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelect />
          {session ? (
            <Link to="/chat" className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20">
              {t("openApp")}
            </Link>
          ) : (
            <Link to="/auth" className="rounded-lg px-4 py-2 text-sm font-semibold text-primary hover:bg-accent">
              {t("signIn")}
            </Link>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pt-16 pb-14 text-center">
        
        <h1 className="text-5xl font-bold sm:text-7xl">
          Docu<span className="text-primary">Mind</span>
        </h1>
        <p className="mt-4 text-2xl font-semibold">{t("tagline")}</p>
        <p className="mt-3 text-lg text-muted-foreground">{t("sub")}</p>
        <Link
          to={session ? "/chat" : "/auth"}
          className="bg-brand-gradient mt-8 inline-flex rounded-xl px-7 py-3.5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:opacity-95"
        >
          {t("openApp")}
        </Link>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="mb-6 text-center text-xl font-bold">{t("how")}</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.d} className="flex gap-4 rounded-2xl border bg-card p-5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <s.icon className="size-6" />
              </div>
              <p className="self-center font-semibold">
                {i + 1}. {t(s.d)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
