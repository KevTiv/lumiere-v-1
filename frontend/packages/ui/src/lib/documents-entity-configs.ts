import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

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
        label: t("documents.documents.filters.isDeleted"),
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
        label: t("documents.knowledgeBase.filters.isPublished"),
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

// ── Registry ──────────────────────────────────────────────────────────────────
export const documentsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "documents-table": documentsTableConfig(t),
  "knowledge-articles-table": knowledgeArticlesTableConfig(t),
})
