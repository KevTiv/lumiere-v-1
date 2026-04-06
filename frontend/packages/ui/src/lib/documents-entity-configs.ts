import type { ReactNode } from "react"
import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

/** Human-readable SpacetimeDB sum/enum JSON from SQL (e.g. `{ Pending: [] }` or `{ tag: "Pending" }`). */
export function formatStdbTaggedValue(v: unknown): string {
  if (v == null || v === "") return ""
  if (typeof v === "string") return v
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (typeof o.tag === "string") return o.tag
    const keys = Object.keys(o)
    if (keys.length === 1) return keys[0]
  }
  return String(v)
}

// ── Documents ─────────────────────────────────────────────────────────────────
export const documentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "documents-table",
  title: t("documents.documents.title"),
  description: t("documents.documents.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("documents.documents.searchPlaceholder"),
    searchKeys: ["name", "fileName", "resName"],
    filters: [
      {
        key: "isDeleted",
        label: t("documents.documents.filters.isDeleted.label"),
        type: "select",
        options: [
          { value: "false", label: t("documents.documents.filters.isDeleted.options.false") },
          { value: "true", label: t("documents.documents.filters.isDeleted.options.true") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("documents.documents.columns.name"), width: "min-w-48" },
      { key: "fileName", label: t("documents.documents.columns.fileName"), width: "min-w-36" },
      { key: "mimetype", label: t("documents.documents.columns.mimetype"), width: "min-w-24" },
      { key: "fileSize", label: t("documents.documents.columns.fileSize"), type: "number", align: "right" },
      { key: "isFavorite", label: t("documents.documents.columns.isFavorite"), type: "boolean" },
      { key: "isShared", label: t("documents.documents.columns.isShared"), type: "boolean" },
      { key: "versionCount", label: t("documents.documents.columns.versionCount"), type: "number", align: "right" },
      { key: "createDate", label: t("documents.documents.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("documents.documents.emptyMessage"),
  },
})

// ── Knowledge Articles ────────────────────────────────────────────────────────
export const knowledgeArticlesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "knowledge-articles-table",
  title: t("documents.knowledgeBase.title"),
  description: t("documents.knowledgeBase.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("documents.knowledgeBase.searchPlaceholder"),
    searchKeys: ["name", "description"],
    filters: [
      {
        key: "isPublished",
        label: t("documents.knowledgeBase.filters.isPublished.label"),
        type: "select",
        options: [
          { value: "true", label: t("documents.knowledgeBase.filters.isPublished.options.true") },
          { value: "false", label: t("documents.knowledgeBase.filters.isPublished.options.false") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("documents.knowledgeBase.columns.name"), width: "min-w-48" },
      { key: "description", label: t("documents.knowledgeBase.columns.description"), width: "min-w-48" },
      { key: "isPublished", label: t("documents.knowledgeBase.columns.isPublished"), type: "boolean" },
      { key: "articleItemCount", label: t("documents.knowledgeBase.columns.articleItemCount"), type: "number", align: "right" },
      { key: "articleMemberCount", label: t("documents.knowledgeBase.columns.articleMemberCount"), type: "number", align: "right" },
      { key: "createDate", label: t("documents.knowledgeBase.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("documents.knowledgeBase.emptyMessage"),
  },
})

export const documentProcessingJobsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "document-processing-jobs-table",
  title: t("documents.processing.title"),
  description: t("documents.processing.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("documents.processing.searchPlaceholder"),
    searchKeys: ["documentType", "jobType", "status", "modelUsed", "errorMessage"],
    filters: [
      {
        key: "isApproved",
        label: t("documents.processing.filters.isApproved.label"),
        type: "select",
        options: [
          { value: "false", label: t("documents.processing.filters.isApproved.options.no") },
          { value: "true", label: t("documents.processing.filters.isApproved.options.yes") },
        ],
      },
    ],
    columns: [
      { key: "id", label: t("documents.processing.columns.id"), type: "number", align: "right" },
      { key: "documentType", label: t("documents.processing.columns.documentType"), width: "min-w-28" },
      { key: "jobType", label: t("documents.processing.columns.jobType"), width: "min-w-28" },
      {
        key: "status",
        label: t("documents.processing.columns.status"),
        render: (_v, row): ReactNode => formatStdbTaggedValue(row.status),
      },
      {
        key: "isApproved",
        label: t("documents.processing.columns.approved"),
        type: "boolean",
      },
      {
        key: "confidenceScore",
        label: t("documents.processing.columns.confidence"),
        type: "number",
        align: "right",
      },
      { key: "modelUsed", label: t("documents.processing.columns.modelUsed"), width: "min-w-24" },
      { key: "createDate", label: t("documents.processing.columns.created"), type: "date" },
    ],
    emptyMessage: t("documents.processing.emptyMessage"),
  },
})

export const documentAiInsightsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "document-ai-insights-table",
  title: t("documents.insights.title"),
  description: t("documents.insights.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("documents.insights.searchPlaceholder"),
    searchKeys: ["title", "description", "relatedModel", "tags"],
    filters: [
      {
        key: "dismissed",
        label: t("documents.insights.filters.dismissed.label"),
        type: "select",
        options: [
          { value: "false", label: t("documents.insights.filters.dismissed.options.open") },
          { value: "true", label: t("documents.insights.filters.dismissed.options.dismissed") },
        ],
      },
      {
        key: "isAcknowledged",
        label: t("documents.insights.filters.isAcknowledged.label"),
        type: "select",
        options: [
          { value: "false", label: t("documents.insights.filters.isAcknowledged.options.no") },
          { value: "true", label: t("documents.insights.filters.isAcknowledged.options.yes") },
        ],
      },
    ],
    columns: [
      { key: "title", label: t("documents.insights.columns.title"), width: "min-w-40" },
      {
        key: "severity",
        label: t("documents.insights.columns.severity"),
        render: (_v, row): ReactNode => formatStdbTaggedValue(row.severity),
      },
      { key: "relatedModel", label: t("documents.insights.columns.relatedModel"), width: "min-w-28" },
      { key: "isAcknowledged", label: t("documents.insights.columns.acknowledged"), type: "boolean" },
      { key: "dismissed", label: t("documents.insights.columns.dismissed"), type: "boolean" },
      { key: "generatedAt", label: t("documents.insights.columns.generatedAt"), type: "datetime" },
    ],
    emptyMessage: t("documents.insights.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const documentsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "documents-table": documentsTableConfig(t),
  "knowledge-articles-table": knowledgeArticlesTableConfig(t),
  "document-processing-jobs-table": documentProcessingJobsTableConfig(t),
  "document-ai-insights-table": documentAiInsightsTableConfig(t),
})
