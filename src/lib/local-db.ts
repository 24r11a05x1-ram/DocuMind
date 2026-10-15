import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface LocalUser {
  id: string;
  email: string;
  password?: string;
  created_at: string;
}

export interface LocalThread {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface LocalDocument {
  id: string;
  user_id: string;
  name: string;
  size: number;
  chunk_count: number;
  created_at: string;
}

export interface LocalChunk {
  id: string;
  document_id: string;
  user_id: string;
  page: number | null;
  content: string;
}

export interface LocalMessage {
  id: string;
  thread_id: string;
  user_id: string;
  ui_id: string;
  role: string;
  parts: unknown;
  created_at: string;
}

interface LocalDatabaseState {
  users: LocalUser[];
  threads: LocalThread[];
  documents: LocalDocument[];
  chunks: LocalChunk[];
  messages: LocalMessage[];
}

const DEFAULT_USER: LocalUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@documind.ai",
  password: "DocuMind2026!Key",
  created_at: "2026-10-01T00:00:00Z",
};

const DB_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "documind_db.json");

function ensureDbFile(): LocalDatabaseState {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial: LocalDatabaseState = {
        users: [DEFAULT_USER],
        threads: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            user_id: DEFAULT_USER.id,
            title: "Welcome to DocuMind",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        documents: [],
        chunks: [],
        messages: [],
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf-8");
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const data = JSON.parse(raw) as LocalDatabaseState;
    if (!data.users || !data.users.some((u) => u.email === DEFAULT_USER.email)) {
      data.users = [DEFAULT_USER, ...(data.users || [])];
      saveDb(data);
    }
    return data;
  } catch (err) {
    console.error("Error reading local db file, using in-memory state:", err);
    return {
      users: [DEFAULT_USER],
      threads: [],
      documents: [],
      chunks: [],
      messages: [],
    };
  }
}

function saveDb(data: LocalDatabaseState) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving local db file:", err);
  }
}

export const localDb = {
  getUsers(): LocalUser[] {
    const db = ensureDbFile();
    return db.users;
  },

  findUserByEmail(email: string): LocalUser | undefined {
    const db = ensureDbFile();
    return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  },

  findUserById(id: string): LocalUser | undefined {
    const db = ensureDbFile();
    return db.users.find((u) => u.id === id);
  },

  createUser(email: string, password?: string): LocalUser {
    const db = ensureDbFile();
    const existing = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing) return existing;
    const user: LocalUser = {
      id: crypto.randomUUID(),
      email: email.trim(),
      password: password || "password123",
      created_at: new Date().toISOString(),
    };
    db.users.push(user);
    saveDb(db);
    return user;
  },

  verifyToken(token: string): LocalUser | null {
    if (!token) return null;
    // Local demo token format: "local-token-<userId>" or fallback to default
    if (token.startsWith("local-token-")) {
      const uid = token.replace("local-token-", "");
      const u = this.findUserById(uid);
      if (u) return u;
    }
    // Allow any token in local offline mode
    return DEFAULT_USER;
  },

  createSession(user: LocalUser) {
    return {
      access_token: `local-token-${user.id}`,
      token_type: "bearer",
      expires_in: 86400 * 30,
      user: {
        id: user.id,
        email: user.email,
        aud: "authenticated",
        role: "authenticated",
        created_at: user.created_at,
        app_metadata: { provider: "email" },
        user_metadata: {},
      },
    };
  },

  // Threads
  getThreads(userId?: string): LocalThread[] {
    const db = ensureDbFile();
    const list = userId ? db.threads.filter((t) => t.user_id === userId) : db.threads;
    return [...list].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  },

  getThread(id: string): LocalThread | undefined {
    const db = ensureDbFile();
    return db.threads.find((t) => t.id === id);
  },

  createThread(userId: string, title = "New chat"): LocalThread {
    const db = ensureDbFile();
    const now = new Date().toISOString();
    const thread: LocalThread = {
      id: crypto.randomUUID(),
      user_id: userId,
      title,
      created_at: now,
      updated_at: now,
    };
    db.threads.unshift(thread);
    saveDb(db);
    return thread;
  },

  updateThread(id: string, patch: Partial<LocalThread>): LocalThread | undefined {
    const db = ensureDbFile();
    const idx = db.threads.findIndex((t) => t.id === id);
    const existing = db.threads[idx];
    if (!existing) return undefined;
    db.threads[idx] = {
      id: existing.id,
      user_id: existing.user_id,
      title: existing.title,
      created_at: existing.created_at,
      ...patch,
      updated_at: patch.updated_at || new Date().toISOString(),
    };
    saveDb(db);
    return db.threads[idx];
  },

  deleteThread(id: string) {
    const db = ensureDbFile();
    db.threads = db.threads.filter((t) => t.id !== id);
    db.messages = db.messages.filter((m) => m.thread_id !== id);
    saveDb(db);
  },

  // Documents
  getDocuments(userId?: string): LocalDocument[] {
    const db = ensureDbFile();
    const list = userId ? db.documents.filter((d) => d.user_id === userId) : db.documents;
    return [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  },

  createDocument(userId: string, doc: { name: string; size: number; chunk_count: number }): LocalDocument {
    const db = ensureDbFile();
    const newDoc: LocalDocument = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: doc.name,
      size: doc.size,
      chunk_count: doc.chunk_count,
      created_at: new Date().toISOString(),
    };
    db.documents.unshift(newDoc);
    saveDb(db);
    return newDoc;
  },

  deleteDocument(id: string) {
    const db = ensureDbFile();
    db.documents = db.documents.filter((d) => d.id !== id);
    db.chunks = db.chunks.filter((c) => c.document_id !== id);
    saveDb(db);
  },

  // Chunks
  insertChunks(userId: string, chunks: { document_id: string; page: number | null; content: string }[]) {
    const db = ensureDbFile();
    const mapped: LocalChunk[] = chunks.map((c) => ({
      id: crypto.randomUUID(),
      document_id: c.document_id,
      user_id: userId,
      page: c.page,
      content: c.content,
    }));
    db.chunks.push(...mapped);
    saveDb(db);
    return mapped;
  },

  getChunks(limit = 6): (LocalChunk & { document_name: string })[] {
    const db = ensureDbFile();
    const docs = new Map(db.documents.map((d) => [d.id, d.name]));
    return db.chunks.slice(0, limit).map((c) => ({
      ...c,
      document_name: docs.get(c.document_id) || "Document",
    }));
  },

  searchChunks(query: string, limit = 8, documentIds?: string[]): {
    id: string;
    document_id: string;
    document_name: string;
    page: number | null;
    content: string;
    rank: number;
  }[] {
    const db = ensureDbFile();
    if (!db.chunks.length) return [];

    const docs = new Map(db.documents.map((d) => [d.id, d.name]));
    const targetDocIds = Array.isArray(documentIds) && documentIds.length > 0 ? documentIds : null;
    const eligibleChunks = targetDocIds ? db.chunks.filter((c) => targetDocIds.includes(c.document_id)) : db.chunks;

    if (!eligibleChunks.length) return [];

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\w\u0C00-\u0C7F]/g, "")) // preserve English & Telugu Unicode
      .filter((t) => t.length > 1);

    if (!terms.length) {
      if (targetDocIds && targetDocIds.length > 1) {
        const perDoc = Math.max(2, Math.ceil(limit / targetDocIds.length));
        const res: any[] = [];
        for (const docId of targetDocIds) {
          const docChunks = eligibleChunks.filter((c) => c.document_id === docId).slice(0, perDoc);
          res.push(...docChunks.map((c) => ({
            id: c.id,
            document_id: c.document_id,
            document_name: docs.get(c.document_id) || "Document",
            page: c.page,
            content: c.content,
            rank: 0.1,
          })));
        }
        return res;
      }
      return eligibleChunks.slice(0, limit).map((c) => ({
        id: c.id,
        document_id: c.document_id,
        document_name: docs.get(c.document_id) || "Document",
        page: c.page,
        content: c.content,
        rank: 0.1,
      }));
    }

    const scored = eligibleChunks.map((c) => {
      const lower = c.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) {
          const matches = lower.split(term).length - 1;
          score += matches * 2 + term.length;
        }
      }
      return {
        id: c.id,
        document_id: c.document_id,
        document_name: docs.get(c.document_id) || "Document",
        page: c.page,
        content: c.content,
        rank: score,
      };
    });

    // Multi-Document Balanced Distribution:
    // When 2+ documents are attached, ensure balanced retrieval so BOTH documents are represented!
    const activeDocIds = targetDocIds || Array.from(new Set(eligibleChunks.map((c) => c.document_id)));
    if (activeDocIds.length > 1) {
      const perDocLimit = Math.max(3, Math.ceil(limit / activeDocIds.length));
      const balancedResults: typeof scored = [];

      for (const docId of activeDocIds) {
        const docMatches = scored
          .filter((s) => s.document_id === docId && s.rank > 0)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, perDocLimit);

        if (docMatches.length > 0) {
          balancedResults.push(...docMatches);
        } else {
          // If no keyword match for this document, include top excerpt so model has context
          const fallbackChunk = eligibleChunks.find((c) => c.document_id === docId);
          if (fallbackChunk) {
            balancedResults.push({
              id: fallbackChunk.id,
              document_id: fallbackChunk.document_id,
              document_name: docs.get(fallbackChunk.document_id) || "Document",
              page: fallbackChunk.page,
              content: fallbackChunk.content,
              rank: 0.05,
            });
          }
        }
      }

      if (balancedResults.length > 0) {
        return balancedResults.sort((a, b) => b.rank - a.rank).slice(0, Math.max(limit, activeDocIds.length * 3));
      }
    }

    return scored
      .filter((s) => s.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);
  },

  // Messages
  getMessages(threadId: string): LocalMessage[] {
    const db = ensureDbFile();
    return db.messages
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  },

  insertMessage(userId: string, msg: { thread_id: string; ui_id: string; role: string; parts: unknown }): LocalMessage {
    const db = ensureDbFile();
    const newMsg: LocalMessage = {
      id: crypto.randomUUID(),
      thread_id: msg.thread_id,
      user_id: userId,
      ui_id: msg.ui_id,
      role: msg.role,
      parts: msg.parts,
      created_at: new Date().toISOString(),
    };
    db.messages.push(newMsg);
    saveDb(db);
    return newMsg;
  },
};
