import DocumentRow from "../generated/document_table";
import KnowledgeArticleRow from "../generated/knowledge_article_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type Document = Infer<typeof DocumentRow>;
export type KnowledgeArticle = Infer<typeof KnowledgeArticleRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function documentsSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM document WHERE organization_id = ${id}`,
    `SELECT * FROM knowledge_article WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryDocuments(): Document[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.document.iter()].sort(
    (a, b) => Number(b.createDate ?? 0) - Number(a.createDate ?? 0),
  );
}

export function queryKnowledgeArticles(): KnowledgeArticle[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.knowledge_article.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}
