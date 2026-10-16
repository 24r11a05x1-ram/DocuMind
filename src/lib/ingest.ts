import { supabase } from "@/integrations/supabase/client";

type Page = { page: number | null; text: string };

async function extractPages(file: File): Promise<Page[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: Page[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const c = await p.getTextContent();
      const text = c.items.map((it) => ("str" in it ? it.str : "")).join(" ");
      pages.push({ page: i, text });
    }
    return pages;
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return [{ page: null, text: value }];
  }
  return [{ page: null, text: await file.text() }];
}

function chunk(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    out.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return out.filter((c) => c.length > 20);
}

export async function ingestFile(file: File) {
  const pages = await extractPages(file);
  const chunks = pages.flatMap((p) => chunk(p.text).map((content) => ({ page: p.page, content })));
  if (!chunks.length) throw new Error(`No readable text found in ${file.name}`);

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({ name: file.name, size: file.size, chunk_count: chunks.length })
    .select()
    .single();
  if (error) throw error;

  for (let i = 0; i < chunks.length; i += 200) {
    const { error: e } = await supabase
      .from("chunks")
      .insert(chunks.slice(i, i + 200).map((c) => ({ ...c, document_id: doc.id })));
    if (e) {
      await supabase.from("documents").delete().eq("id", doc.id);
      throw e;
    }
  }

  // Seamlessly sync to /api/db so localDb also has full knowledge of the document
  try {
    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data.session?.access_token;
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

    await fetch("/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        action: "docs_create",
        payload: {
          id: doc.id,
          name: file.name,
          size: file.size,
          chunk_count: chunks.length,
        },
      }),
    });

    for (let i = 0; i < chunks.length; i += 200) {
      await fetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          action: "chunks_insert",
          payload: {
            chunks: chunks.slice(i, i + 200).map((c) => ({ ...c, document_id: doc.id })),
          },
        }),
      });
    }
  } catch (syncErr) {
    console.warn("Local sync warning (non-fatal):", syncErr);
  }

  return doc;
}
