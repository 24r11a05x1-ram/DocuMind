// Universal Mock Supabase Client for local / offline operation
export interface MockSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    aud: string;
    role: string;
    created_at: string;
    app_metadata: Record<string, unknown>;
    user_metadata: Record<string, unknown>;
  };
}

const STORAGE_KEY = "documind_auth_session";

function getLocalSession(): MockSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveLocalSession(session: MockSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

const authListeners: Set<(event: string, session: MockSession | null) => void> = new Set();

function emitAuthChange(event: string, session: MockSession | null) {
  for (const listener of authListeners) {
    try {
      listener(event, session);
    } catch (e) {
      console.error("Auth listener error:", e);
    }
  }
}

async function callDbApi(action: string, payload?: unknown) {
  const session = getLocalSession();
  const token = session?.access_token;
  try {
    const res = await fetch("/api/db", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { data: null, error: new Error(txt || `Request failed (${res.status})`) };
    }
    const data = await res.json();
    if (data && "error" in data) {
      return { data: null, error: new Error(data.error) };
    }
    return { data: data?.data !== undefined ? data.data : data, error: null };
  } catch (err) {
    console.warn(`Local API /api/db failed for ${action}, falling back to localStorage:`, err);
    return fallbackLocalStore(action, payload);
  }
}

// In-memory fallback if fetch itself fails in SSR or sandbox
const memoryStore = {
  threads: [] as any[],
  documents: [] as any[],
  chunks: [] as any[],
  messages: [] as any[],
};

function fallbackLocalStore(action: string, payload: any): { data: any; error: any } {
  if (typeof window !== "undefined") {
    try {
      if (action === "threads_list") {
        const raw = localStorage.getItem("documind_threads");
        return { data: raw ? JSON.parse(raw) : memoryStore.threads, error: null };
      }
      if (action === "threads_create") {
        const item = {
          id: crypto.randomUUID(),
          title: payload?.title || "New chat",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const raw = localStorage.getItem("documind_threads");
        const list = raw ? JSON.parse(raw) : [];
        list.unshift(item);
        localStorage.setItem("documind_threads", JSON.stringify(list));
        return { data: item, error: null };
      }
      if (action === "docs_list") {
        const raw = localStorage.getItem("documind_docs");
        return { data: raw ? JSON.parse(raw) : memoryStore.documents, error: null };
      }
    } catch {}
  }
  return { data: [], error: null };
}

class QueryBuilder {
  private table: string;
  private action: "select" | "insert" | "update" | "delete" = "select";
  private selectFields = "*";
  private insertData: any = null;
  private updateData: any = null;
  private filters: { col: string; val: any }[] = [];
  private isSingle = false;
  private isMaybeSingle = false;

  constructor(table: string) {
    this.table = table;
  }

  select(fields = "*") {
    this.selectFields = fields;
    return this;
  }

  insert(data: any) {
    this.action = "insert";
    this.insertData = data;
    return this;
  }

  update(data: any) {
    this.action = "update";
    this.updateData = data;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ col: column, val: value });
    return this;
  }

  order(_col: string, _opts?: { ascending?: boolean }) {
    return this;
  }

  limit(_n: number) {
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  async execute(): Promise<{ data: any; error: any }> {
    let actionName = "";
    let payload: any = {};

    const idFilter = this.filters.find((f) => f.col === "id")?.val;
    const threadFilter = this.filters.find((f) => f.col === "thread_id")?.val;

    if (this.table === "threads") {
      if (this.action === "select") {
        actionName = "threads_list";
      } else if (this.action === "insert") {
        actionName = "threads_create";
        payload = this.insertData || {};
      } else if (this.action === "update") {
        actionName = "threads_update";
        payload = { id: idFilter, patch: this.updateData };
      } else if (this.action === "delete") {
        actionName = "threads_delete";
        payload = { id: idFilter };
      }
    } else if (this.table === "documents") {
      if (this.action === "select") {
        actionName = "docs_list";
      } else if (this.action === "insert") {
        actionName = "docs_create";
        payload = this.insertData || {};
      } else if (this.action === "delete") {
        actionName = "docs_delete";
        payload = { id: idFilter };
      }
    } else if (this.table === "chunks") {
      if (this.action === "insert") {
        actionName = "chunks_insert";
        payload = { chunks: Array.isArray(this.insertData) ? this.insertData : [this.insertData] };
      } else {
        actionName = "chunks_search";
        payload = { q: "", k: 10 };
      }
    } else if (this.table === "messages") {
      if (this.action === "select") {
        actionName = "messages_list";
        payload = { thread_id: threadFilter };
      } else if (this.action === "insert") {
        actionName = "messages_insert";
        payload = this.insertData;
      }
    }

    if (!actionName) {
      return { data: [], error: null };
    }

    const res = await callDbApi(actionName, payload);
    let data = res.data;

    if (this.isSingle || this.isMaybeSingle) {
      if (Array.isArray(data)) {
        data = data[0] || null;
      }
    }

    return { data, error: res.error };
  }

  // Promise-like interface
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createMockSupabaseClient() {
  return {
    auth: {
      async signInWithPassword({ email, password }: { email: string; password?: string }) {
        const res = await callDbApi("auth_login", { email, password });
        if (res.error || !res.data) {
          // Provide instant fallback demo session
          const fallbackUser = {
            id: "00000000-0000-0000-0000-000000000001",
            email: email || "admin@documind.ai",
            aud: "authenticated",
            role: "authenticated",
            created_at: new Date().toISOString(),
            app_metadata: { provider: "email" },
            user_metadata: {},
          };
          const fallbackSession: MockSession = {
            access_token: `local-token-${fallbackUser.id}`,
            token_type: "bearer",
            expires_in: 86400 * 30,
            user: fallbackUser,
          };
          saveLocalSession(fallbackSession);
          emitAuthChange("SIGNED_IN", fallbackSession);
          return { data: { user: fallbackUser, session: fallbackSession }, error: null };
        }
        const session = res.data.session as MockSession;
        saveLocalSession(session);
        emitAuthChange("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      },

      async signUp({ email, password }: { email: string; password?: string }) {
        const res = await callDbApi("auth_signup", { email, password });
        if (res.error || !res.data) {
          return this.signInWithPassword({ email, password });
        }
        const session = res.data.session as MockSession;
        saveLocalSession(session);
        emitAuthChange("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      },

      async signInWithOAuth(_params: { provider: string; options?: any }) {
        // Fallback: log in with demo account
        return this.signInWithPassword({ email: "admin@documind.ai", password: "DocuMind2026!Key" });
      },

      async signOut() {
        saveLocalSession(null);
        emitAuthChange("SIGNED_OUT", null);
        return { error: null };
      },

      async getSession() {
        const session = getLocalSession();
        return { data: { session }, error: null };
      },

      async getUser(token?: string) {
        if (!token) {
          const s = getLocalSession();
          return { data: { user: s?.user || null }, error: null };
        }
        const res = await callDbApi("auth_user", { token });
        if (res.data?.user) {
          return { data: { user: res.data.user }, error: null };
        }
        const s = getLocalSession();
        return { data: { user: s?.user || null }, error: null };
      },

      onAuthStateChange(callback: (event: string, session: MockSession | null) => void) {
        authListeners.add(callback);
        // Call immediately with existing session
        const current = getLocalSession();
        setTimeout(() => callback(current ? "SIGNED_IN" : "INITIAL_SESSION", current), 0);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                authListeners.delete(callback);
              },
            },
          },
        };
      },
    },

    from(table: string) {
      return new QueryBuilder(table);
    },

    async rpc(fn: string, args?: any) {
      if (fn === "search_chunks") {
        const res = await callDbApi("chunks_search", { q: args?.q, k: args?.k });
        return { data: res.data || [], error: res.error };
      }
      return { data: [], error: null };
    },
  };
}
