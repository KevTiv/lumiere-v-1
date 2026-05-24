import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Documents mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` documents hooks.
 */
export const DOCUMENTS_BFF_REDUCERS = [
  "acknowledge_insight",
  "add_article_member",
  "add_document_version",
  "approve_document_processing_job",
  "complete_document_processing_job",
  "create_document",
  "create_document_folder",
  "create_document_processing_job",
  "create_knowledge_article",
  "create_knowledge_category",
  "delete_document",
  "delete_knowledge_article",
  "delete_knowledge_category",
  "import_knowledge_article_csv",
  "import_knowledge_category_csv",
  "lock_document",
  "lock_knowledge_article",
  "record_document_view",
  "remove_article_member",
  "set_article_published",
  "unlock_document",
  "unlock_knowledge_article",
  "update_document",
  "update_knowledge_article",
  "update_knowledge_category",
] as const;

export type DocumentsBffReducerKey = (typeof DOCUMENTS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<DocumentsBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function documentsBffCallUrl(reducer: DocumentsBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function documentsBffPost(
  reducer: DocumentsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: documentsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const DOCUMENTS_HINT_OVERRIDES: Partial<
  Record<DocumentsBffReducerKey, readonly string[]>
> = {
  acknowledge_insight: ["ai-insights"],
  add_article_member: ["knowledge-articles"],
  add_document_version: ["documents"],
  approve_document_processing_job: ["ai-document-processing-jobs"],
  complete_document_processing_job: ["ai-document-processing-jobs"],
  create_document: ["documents"],
  create_document_folder: ["documents"],
  create_document_processing_job: ["ai-document-processing-jobs"],
  create_knowledge_article: ["knowledge-articles"],
  create_knowledge_category: ["knowledge-articles"],
  delete_document: ["documents"],
  delete_knowledge_article: ["knowledge-articles"],
  delete_knowledge_category: ["knowledge-articles"],
  import_knowledge_article_csv: ["knowledge-articles"],
  import_knowledge_category_csv: ["knowledge-articles"],
  lock_document: ["documents"],
  lock_knowledge_article: ["knowledge-articles"],
  record_document_view: ["documents"],
  remove_article_member: ["knowledge-articles"],
  set_article_published: ["knowledge-articles"],
  unlock_document: ["documents"],
  unlock_knowledge_article: ["knowledge-articles"],
  update_document: ["documents"],
  update_knowledge_article: ["knowledge-articles"],
  update_knowledge_category: ["knowledge-articles"],
};

function documentsReducerHints(): Record<
  DocumentsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<DocumentsBffReducerKey, readonly string[]>;
  for (const k of DOCUMENTS_BFF_REDUCERS) {
    o[k] = DOCUMENTS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const DOCUMENTS_COMMAND_SUBSCRIPTION_HINTS: Record<
  DocumentsBffReducerKey,
  readonly string[]
> = documentsReducerHints();

export function documentsCommandContract(
  reducer: DocumentsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Documents reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: DOCUMENTS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
