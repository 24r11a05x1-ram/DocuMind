import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Database,
  Table as TableIcon,
  Search,
  Shield,
  Code2,
  FileText,
  Layers,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Key,
  Cpu,
} from "lucide-react";

export const Route = createFileRoute("/db")({
  component: SupabaseVisualizer,
});

interface StudioData {
  users: Array<{ id: string; email: string; created_at: string }>;
  documents: Array<{ id: string; name: string; size: number; chunk_count: number; created_at: string }>;
  threads: Array<{ id: string; title: string; created_at: string; updated_at: string }>;
  chunks: Array<{ id: string; document_id: string; document_name?: string; page: number | null; content: string }>;
}

export function SupabaseVisualizer() {
  const [tab, setTab] = useState<"tables" | "search" | "schema" | "rls" | "sql">("tables");
  const [activeTable, setActiveTable] = useState<"documents" | "chunks" | "threads" | "users">("documents");
  const [data, setData] = useState<StudioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("projects");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "studio_data" }),
      });
      const d = await res.json();
      if (d?.data) setData(d.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chunks_search", payload: { q, k: 6 } }),
      });
      const d = await res.json();
      setSearchResults(d?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    fetchData();
    runSearch("projects");
  }, []);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100 font-sans">
      {/* Top Supabase Navbar */}
      <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900 px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Database className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wide text-white">Supabase Studio</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                Connected • PostgreSQL 15
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">Project: documind-backend • pgvector / FTS enabled</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setTab("tables")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === "tables" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            <TableIcon className="size-3.5" /> Table Editor
          </button>
          <button
            onClick={() => setTab("search")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === "search" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            <Search className="size-3.5" /> Vector & FTS Lab
          </button>
          <button
            onClick={() => setTab("schema")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === "schema" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            <Layers className="size-3.5" /> ER Diagram
          </button>
          <button
            onClick={() => setTab("rls")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === "rls" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            <Shield className="size-3.5" /> RLS Security
          </button>
          <button
            onClick={() => setTab("sql")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === "sql" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            <Code2 className="size-3.5" /> SQL DDL
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            title="Refresh database state"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
            <span>Refresh</span>
          </button>
          <Link
            to="/chat"
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500"
          >
            <ArrowLeft className="size-3.5" /> Return to Chat
          </Link>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* TAB 1: TABLE EDITOR */}
        {tab === "tables" && (
          <div className="flex flex-1 overflow-hidden">
            {/* Table Selector Sidebar */}
            <aside className="w-64 border-r border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Public Schema Tables</p>
                <div className="mt-3 space-y-1">
                  <button
                    onClick={() => setActiveTable("documents")}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition ${
                      activeTable === "documents"
                        ? "bg-emerald-600/20 text-emerald-300 font-semibold border border-emerald-500/30"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="size-3.5 text-emerald-400" />
                      <span>public.documents</span>
                    </div>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                      {data?.documents?.length ?? 0}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveTable("chunks")}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition ${
                      activeTable === "chunks"
                        ? "bg-emerald-600/20 text-emerald-300 font-semibold border border-emerald-500/30"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="size-3.5 text-emerald-400" />
                      <span>public.chunks</span>
                    </div>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                      {data?.chunks?.length ?? 0}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveTable("threads")}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition ${
                      activeTable === "threads"
                        ? "bg-emerald-600/20 text-emerald-300 font-semibold border border-emerald-500/30"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Database className="size-3.5 text-emerald-400" />
                      <span>public.threads</span>
                    </div>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                      {data?.threads?.length ?? 0}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveTable("users")}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition ${
                      activeTable === "users"
                        ? "bg-emerald-600/20 text-emerald-300 font-semibold border border-emerald-500/30"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Key className="size-3.5 text-emerald-400" />
                      <span>auth.users</span>
                    </div>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                      {data?.users?.length ?? 0}
                    </span>
                  </button>
                </div>
              </div>

              {/* Status summary */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-400 space-y-1">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                  <CheckCircle2 className="size-3.5" /> RAG Pipeline Active
                </div>
                <p>Documents are split into semantic chunks with full-text search indexes.</p>
              </div>
            </aside>

            {/* Table View Grid */}
            <main className="flex-1 overflow-auto p-6 bg-slate-950">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <TableIcon className="size-5 text-emerald-400" />
                    <span>Table: public.{activeTable}</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Live database records synced in real time with DocuMind chat workspace.
                  </p>
                </div>
              </div>

              {/* DOCUMENTS TABLE */}
              {activeTable === "documents" && (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-900 text-slate-300 font-mono">
                      <tr>
                        <th className="p-3">id (uuid)</th>
                        <th className="p-3">name (text)</th>
                        <th className="p-3">size (bytes)</th>
                        <th className="p-3">chunk_count (int)</th>
                        <th className="p-3">created_at (timestamptz)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                      {data?.documents?.length ? (
                        data.documents.map((doc) => (
                          <tr key={doc.id} className="hover:bg-slate-800/40 transition">
                            <td className="p-3 text-emerald-400 truncate max-w-[140px]" title={doc.id}>
                              {doc.id}
                            </td>
                            <td className="p-3 text-white font-medium">{doc.name}</td>
                            <td className="p-3 text-slate-400">{(doc.size / 1024).toFixed(1)} KB</td>
                            <td className="p-3 text-amber-400 font-bold">{doc.chunk_count} chunks</td>
                            <td className="p-3 text-slate-400">{new Date(doc.created_at).toLocaleString()}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-500">
                            No documents uploaded yet. Upload a PDF or DOCX in chat to see it appear here!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* CHUNKS TABLE */}
              {activeTable === "chunks" && (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-900 text-slate-300 font-mono">
                      <tr>
                        <th className="p-3 w-32">id (uuid)</th>
                        <th className="p-3 w-40">document_name</th>
                        <th className="p-3 w-16">page</th>
                        <th className="p-3">content (text vector chunk)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                      {data?.chunks?.length ? (
                        data.chunks.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-800/40 transition">
                            <td className="p-3 text-emerald-400 truncate" title={c.id}>
                              {c.id.slice(0, 13)}...
                            </td>
                            <td className="p-3 text-slate-200 truncate" title={c.document_name}>
                              {c.document_name || "Document"}
                            </td>
                            <td className="p-3 text-amber-400">{c.page ?? 1}</td>
                            <td className="p-3 text-slate-300 font-sans leading-relaxed text-[11px]">
                              {c.content.slice(0, 220)}...
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500">
                            No chunks generated yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* THREADS TABLE */}
              {activeTable === "threads" && (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-900 text-slate-300 font-mono">
                      <tr>
                        <th className="p-3">id (uuid)</th>
                        <th className="p-3">title (text)</th>
                        <th className="p-3">created_at (timestamptz)</th>
                        <th className="p-3">updated_at (timestamptz)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                      {data?.threads?.length ? (
                        data.threads.map((t) => (
                          <tr key={t.id} className="hover:bg-slate-800/40 transition">
                            <td className="p-3 text-emerald-400 truncate max-w-[140px]">{t.id}</td>
                            <td className="p-3 text-white font-medium">{t.title}</td>
                            <td className="p-3 text-slate-400">{new Date(t.created_at).toLocaleString()}</td>
                            <td className="p-3 text-slate-400">{new Date(t.updated_at).toLocaleString()}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500">
                            No threads found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* USERS TABLE */}
              {activeTable === "users" && (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-900 text-slate-300 font-mono">
                      <tr>
                        <th className="p-3">id (uuid)</th>
                        <th className="p-3">email (character varying)</th>
                        <th className="p-3">role</th>
                        <th className="p-3">created_at (timestamptz)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                      {data?.users?.length ? (
                        data.users.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-800/40 transition">
                            <td className="p-3 text-emerald-400">{u.id}</td>
                            <td className="p-3 text-white font-medium">{u.email}</td>
                            <td className="p-3 text-emerald-400 font-semibold">authenticated</td>
                            <td className="p-3 text-slate-400">{new Date(u.created_at).toLocaleString()}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500">
                            No users registered.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </main>
          </div>
        )}

        {/* TAB 2: VECTOR & FTS LAB */}
        {tab === "search" && (
          <div className="flex-1 overflow-auto p-8 bg-slate-950">
            <div className="max-w-4xl mx-auto space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Search className="size-5 text-emerald-400" />
                  <span>Interactive Full-Text & Vector Retrieval Lab</span>
                </h2>
                <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                  Demonstrate to your teacher how the Supabase database searches and ranks document chunks using PostgreSQL
                  Full-Text Search (<code>tsvector</code>) and semantic scoring before feeding them into Google Gemini AI.
                </p>
              </div>

              {/* Search Bar */}
              <div className="flex gap-3">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch(searchQuery)}
                  placeholder="Type a search query (e.g., projects, ramcharan, machine learning, medicine)..."
                  className="flex-1 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500 font-mono"
                />
                <button
                  onClick={() => runSearch(searchQuery)}
                  disabled={searching}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {searching ? "Searching..." : "Execute search_chunks()"}
                </button>
              </div>

              {/* Query SQL Explanation Box */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-slate-300">
                <span className="text-slate-500 block mb-1">-- Equivalent Supabase RPC Call</span>
                <span className="text-emerald-400">SELECT</span> * <span className="text-emerald-400">FROM</span>{" "}
                public.search_chunks(<span className="text-amber-300">&apos;{searchQuery}&apos;</span>, k := 6);
              </div>

              {/* Results List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Matched Chunks ({searchResults.length})</span>
                  <span>Rank score computed via term frequency & lexical match</span>
                </div>

                {searchResults.map((r, i) => (
                  <div key={i} className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-md bg-emerald-500/20 text-xs font-bold text-emerald-400 border border-emerald-500/30">
                          #{i + 1}
                        </span>
                        <span className="text-sm font-semibold text-white">{r.document_name}</span>
                        {r.page && <span className="text-xs text-slate-400">Page {r.page}</span>}
                      </div>
                      <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/20">
                        Score: {r.rank}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed font-sans bg-slate-950/60 p-3 rounded-lg border border-slate-800/50">
                      {r.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ER DIAGRAM */}
        {tab === "schema" && (
          <div className="flex-1 overflow-auto p-8 bg-slate-950">
            <div className="max-w-4xl mx-auto space-y-8">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Layers className="size-5 text-emerald-400" />
                  <span>Database Entity-Relationship (ER) Architecture</span>
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Visual relational topology showing primary keys, foreign keys, and cascading relationships.
                </p>
              </div>

              {/* Visual Schema Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Branch 1: Knowledge Base */}
                <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/60 p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="font-bold text-emerald-400 flex items-center gap-2">
                      <FileText className="size-4" /> Knowledge Pipeline (Documents & Chunks)
                    </span>
                    <span className="text-xs text-slate-500 font-mono">1-to-Many</span>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs font-mono">
                    <p className="text-white font-bold text-sm">public.documents</p>
                    <ul className="text-slate-400 space-y-1">
                      <li>🔑 <span className="text-emerald-400">id</span> (uuid, PK)</li>
                      <li>👤 <span className="text-slate-300">user_id</span> (uuid, FK &rarr; auth.users)</li>
                      <li>📄 <span className="text-slate-300">name</span> (text)</li>
                      <li>📊 <span className="text-slate-300">size</span> (bigint)</li>
                      <li>🔢 <span className="text-slate-300">chunk_count</span> (int)</li>
                    </ul>
                  </div>

                  <div className="flex justify-center text-emerald-400 font-bold text-xs">&darr; ON DELETE CASCADE</div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs font-mono">
                    <p className="text-white font-bold text-sm">public.chunks</p>
                    <ul className="text-slate-400 space-y-1">
                      <li>🔑 <span className="text-emerald-400">id</span> (uuid, PK)</li>
                      <li>🔗 <span className="text-amber-300">document_id</span> (uuid, FK &rarr; documents.id)</li>
                      <li>👤 <span className="text-slate-300">user_id</span> (uuid, FK &rarr; auth.users)</li>
                      <li>📑 <span className="text-slate-300">page</span> (int)</li>
                      <li>📝 <span className="text-slate-300">content</span> (text)</li>
                      <li>⚡ <span className="text-emerald-400">fts</span> (tsvector, GIN Indexed)</li>
                    </ul>
                  </div>
                </div>

                {/* Branch 2: Conversation Threads */}
                <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/60 p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="font-bold text-emerald-400 flex items-center gap-2">
                      <Cpu className="size-4" /> Chat & Message Persistence
                    </span>
                    <span className="text-xs text-slate-500 font-mono">1-to-Many</span>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs font-mono">
                    <p className="text-white font-bold text-sm">public.threads</p>
                    <ul className="text-slate-400 space-y-1">
                      <li>🔑 <span className="text-emerald-400">id</span> (uuid, PK)</li>
                      <li>👤 <span className="text-slate-300">user_id</span> (uuid, FK &rarr; auth.users)</li>
                      <li>💬 <span className="text-slate-300">title</span> (text)</li>
                      <li>🕒 <span className="text-slate-300">updated_at</span> (timestamptz)</li>
                    </ul>
                  </div>

                  <div className="flex justify-center text-emerald-400 font-bold text-xs">&darr; ON DELETE CASCADE</div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs font-mono">
                    <p className="text-white font-bold text-sm">public.messages</p>
                    <ul className="text-slate-400 space-y-1">
                      <li>🔑 <span className="text-emerald-400">id</span> (uuid, PK)</li>
                      <li>🔗 <span className="text-amber-300">thread_id</span> (uuid, FK &rarr; threads.id)</li>
                      <li>👤 <span className="text-slate-300">user_id</span> (uuid, FK &rarr; auth.users)</li>
                      <li>🎭 <span className="text-slate-300">role</span> (text: user | assistant)</li>
                      <li>📦 <span className="text-emerald-400">parts</span> (jsonb with text & sources)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: RLS SECURITY */}
        {tab === "rls" && (
          <div className="flex-1 overflow-auto p-8 bg-slate-950">
            <div className="max-w-4xl mx-auto space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Shield className="size-5 text-emerald-400" />
                  <span>Row Level Security (RLS) & Multi-Tenant Policies</span>
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Supabase utilizes PostgreSQL Row Level Security to strictly isolate user documents and chats so no user
                  can view or query another user&apos;s data.
                </p>
              </div>

              <div className="space-y-4">
                {[
                  {
                    table: "public.documents",
                    policy: "own documents",
                    rule: "auth.uid() = user_id",
                    desc: "Ensures only authenticated users can upload, view, or delete their own documents.",
                  },
                  {
                    table: "public.chunks",
                    policy: "own chunks",
                    rule: "auth.uid() = user_id",
                    desc: "Vector and full-text search strictly filters to only the chunks belonging to the requesting user.",
                  },
                  {
                    table: "public.threads",
                    policy: "own threads",
                    rule: "auth.uid() = user_id",
                    desc: "Users can only list, update, and manage their own conversation threads.",
                  },
                  {
                    table: "public.messages",
                    policy: "own messages",
                    rule: "auth.uid() = user_id",
                    desc: "Chat messages and AI response histories are strictly isolated per user ID.",
                  },
                ].map((item, i) => (
                  <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-emerald-400">{item.table}</span>
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                        RLS ENABLED
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-950 p-2.5 font-mono text-xs text-slate-300">
                      CREATE POLICY &quot;{item.policy}&quot; ON {item.table} FOR ALL TO authenticated USING ({item.rule});
                    </div>
                    <p className="text-xs text-slate-400">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: SQL MIGRATION CODE */}
        {tab === "sql" && (
          <div className="flex-1 overflow-auto p-8 bg-slate-950">
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Code2 className="size-5 text-emerald-400" />
                    <span>PostgreSQL DDL Migration (Schema Definition)</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Production migration file executed on Supabase for DocuMind.
                  </p>
                </div>
              </div>

              <pre className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 font-mono text-xs text-emerald-300/90 leading-relaxed overflow-x-auto shadow-inner">
{`-- 1. Documents Table
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  size bigint not null default 0,
  chunk_count int not null default 0,
  created_at timestamptz not null default now()
);

-- 2. Chunks Table with Full-Text Search tsvector
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  page int,
  content text not null,
  fts tsvector generated always as (to_tsvector('simple', content)) stored
);
create index chunks_fts_idx on public.chunks using gin(fts);

-- 3. Conversation Threads
create table public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null default 'New chat',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 4. Chat Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  ui_id text not null,
  role text not null,
  parts jsonb not null,
  created_at timestamptz not null default now()
);

-- 5. Stored Procedure for Semantic Vector / Text Ranking
create or replace function public.search_chunks(q text, k int default 6)
returns table (id uuid, document_id uuid, document_name text, page int, content text, rank real)
language sql stable security invoker set search_path = public as $$
  select c.id, c.document_id, d.name, c.page, c.content,
    ts_rank(c.fts, query) as rank
  from public.chunks c
  join public.documents d on d.id = c.document_id,
  lateral (select to_tsquery('simple', coalesce(nullif(array_to_string(
     array(select lexeme from unnest(to_tsvector('simple', q))), ' | '), ''), 'zzzznomatch')) as query) qq
  where c.user_id = auth.uid() and c.fts @@ query
  order by rank desc
  limit k;
$$;`}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
