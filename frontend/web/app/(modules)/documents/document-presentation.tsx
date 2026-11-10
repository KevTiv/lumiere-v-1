import type { TFunction } from "i18next"
import {
  FileIdentity,
  type FileIdentityProps,
} from "@lumiere/ui/components/file-identity"
import type {
  EntityColumn,
  EntityColumnLayout,
  EntityRow,
  EntityViewConfig,
} from "@lumiere/ui/lib/entity-view-types"
import { unwrapEntityValue } from "@lumiere/ui/lib/entity-row-values"
import { fileKindLabel, fileKindOf } from "@lumiere/ui/lib/file-kind"
import { documentRelatedRecordLabel } from "@lumiere/ui/lib/file-metadata"

export function documentText(value: unknown): string | undefined {
  const plain = unwrapEntityValue(value)
  return typeof plain === "string" && plain.trim() ? plain : undefined
}

export function documentFileIdentity(row: EntityRow): FileIdentityProps {
  return {
    title: documentText(row.name),
    fileName: documentText(row.fileName ?? row.file_name),
    mimetype: documentText(row.mimetype),
    size: unwrapEntityValue(row.fileSize ?? row.file_size),
  }
}

export function documentAttachmentLabel(row: EntityRow, t: TFunction): string {
  const model = documentText(row.resModel ?? row.res_model)
  return model
    ? (documentText(row.resName ?? row.res_name) ??
        documentRelatedRecordLabel(model, t))
    : t("documents.page.standalone", { defaultValue: "Standalone file" })
}

const identity: EntityColumnLayout = {
  min: 15,
  preferred: 22,
  grow: 2,
  wrap: 2,
}
const description: EntityColumnLayout = {
  min: 12,
  preferred: 20,
  grow: 1,
  wrap: 2,
}
const compact: EntityColumnLayout = { min: 5, preferred: 7, max: 9, wrap: 2 }
const date: EntityColumnLayout = { min: 8, preferred: 9, max: 11, wrap: 2 }

function presentColumn(
  column: EntityColumn,
  table: string,
  t: TFunction,
): EntityColumn {
  const { key } = column
  const files =
    table === "documents-table" || table === "documents-recycle-bin-table"
  if (files && key === "name")
    return {
      ...column,
      layout: { ...identity, min: 17, preferred: 26 },
      render: (value, row) => {
        const file = documentFileIdentity(row)
        return (
          <FileIdentity
            {...file}
            title={documentText(value)}
            size={table === "documents-table" ? undefined : file.size}
          />
        )
      },
    }
  if (files && key === "fileName")
    return { ...column, layout: identity, defaultHidden: true }
  if (files && key === "mimetype")
    return {
      ...column,
      label: t("documents.fileIdentity.type", { defaultValue: "File type" }),
      layout: compact,
      defaultHidden: true,
      render: (value, row) =>
        fileKindLabel(
          fileKindOf(documentText(value), documentText(row.fileName)),
          t,
        ),
    }
  if (
    files &&
    [
      "fiscalKind",
      "residencyRegion",
      "retentionDays",
      "isFavorite",
      "isShared",
    ].includes(key)
  ) {
    return { ...column, layout: compact, defaultHidden: true }
  }
  if (table === "document-folders-table" && key === "parentPath") {
    return {
      ...column,
      layout: description,
      render: (value, row) =>
        documentText(value) ??
        (row.parentId == null
          ? t("documents.fileManagement.root", { defaultValue: "Root folder" })
          : "—"),
    }
  }
  if (
    (table === "document-ai-insights-table" && key === "relatedModel") ||
    (table === "mail-templates-table" && key === "model")
  ) {
    return {
      ...column,
      layout: description,
      render: (value) => {
        const model = documentText(value)
        return model ? documentRelatedRecordLabel(model, t) : "—"
      },
    }
  }
  if (
    table === "document-processing-jobs-table" &&
    ["id", "modelUsed"].includes(key)
  ) {
    return { ...column, layout: compact, defaultHidden: true }
  }
  if (["name", "title"].includes(key)) return { ...column, layout: identity }
  if (["description", "subject"].includes(key))
    return { ...column, layout: description }
  if (column.type === "date" || column.type === "datetime")
    return { ...column, layout: date }
  if (
    column.type === "number" ||
    column.type === "boolean" ||
    ["status", "severity"].includes(key)
  ) {
    return { ...column, layout: compact }
  }
  return column
}

/** Allocate space by purpose without changing shared table mechanics or existing actions. */
export function withDocumentsTablePresentation(
  config: EntityViewConfig,
  t: TFunction,
): EntityViewConfig {
  if (config.view.mode !== "table") return config
  return {
    ...config,
    view: {
      ...config.view,
      columns: config.view.columns.map((column) =>
        presentColumn(column, config.id, t),
      ),
    },
  }
}
