import { createFileRoute } from "@tanstack/react-router";
import { localDb } from "@/lib/local-db";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/db")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { action, payload } = body;

          // 1. Auth: Sign In
          if (action === "auth_login") {
            const { email, password } = payload || {};
            let user = localDb.findUserByEmail(email);
            if (!user) {
              // Auto-register new users or default demo user
              user = localDb.createUser(email, password);
            } else if (password && user.password && user.password !== password && email !== "admin@documind.ai") {
              return json({ error: "Invalid password" }, 400);
            }
            const session = localDb.createSession(user);
            return json({ user: session.user, session });
          }

          // 2. Auth: Sign Up
          if (action === "auth_signup") {
            const { email, password } = payload || {};
            const user = localDb.createUser(email, password);
            const session = localDb.createSession(user);
            return json({ user: session.user, session });
          }

          // 3. Auth: Get User from token
          if (action === "auth_user") {
            const token = payload?.token || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
            const user = localDb.verifyToken(token || "");
            if (!user) return json({ error: "User not found" }, 404);
            const session = localDb.createSession(user);
            return json({ user: session.user, session });
          }

          // Resolve current user id
          const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || payload?.token;
          const currentUser = localDb.verifyToken(token || "") || localDb.findUserByEmail("admin@documind.ai")!;
          const userId = currentUser.id;

          // 4. Threads
          if (action === "threads_list") {
            const threads = localDb.getThreads();
            return json({ data: threads });
          }

          if (action === "threads_create") {
            const thread = localDb.createThread(userId, payload?.title || "New chat");
            return json({ data: thread });
          }

          if (action === "threads_update") {
            const thread = localDb.updateThread(payload?.id, payload?.patch);
            return json({ data: thread });
          }

          if (action === "threads_delete") {
            localDb.deleteThread(payload?.id);
            return json({ success: true });
          }

          // 5. Documents
          if (action === "docs_list") {
            const docs = localDb.getDocuments();
            return json({ data: docs });
          }

          if (action === "docs_create") {
            const doc = localDb.createDocument(userId, payload);
            return json({ data: doc });
          }

          if (action === "docs_delete") {
            localDb.deleteDocument(payload?.id);
            return json({ success: true });
          }

          // 6. Chunks
          if (action === "chunks_insert") {
            const chunks = localDb.insertChunks(userId, payload?.chunks || []);
            return json({ data: chunks });
          }

          if (action === "chunks_search") {
            const results = localDb.searchChunks(payload?.q || "", payload?.k || 6);
            return json({ data: results });
          }

          // 7. Messages
          if (action === "messages_list") {
            const msgs = localDb.getMessages(payload?.thread_id);
            return json({ data: msgs });
          }

          if (action === "messages_insert") {
            const msg = localDb.insertMessage(userId, payload);
            return json({ data: msg });
          }

          return json({ error: `Unknown action: ${action}` }, 400);
        } catch (err) {
          console.error("API /api/db error:", err);
          return json({ error: err instanceof Error ? err.message : "Internal database error" }, 500);
        }
      },
    },
  },
});
