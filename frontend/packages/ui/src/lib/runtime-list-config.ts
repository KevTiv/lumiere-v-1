import type { EntityColumn, EntityFilter, EntityTableConfig } from "./entity-view-types"
import type { MergedFormConfiguration, ParsedFormField, FieldType } from "../forms/config/types"
import { isCustomField } from "../forms/config/types"
import { normalizeFormFieldKey } from "./runtime-form-config"

function stdbTypeToColumnType(type: FieldType): EntityColumn["type"] {
  switch (type) {
    case "Number":
    case "Rating":
    case "Slider":
      return "number"
    case "Date":
      return "date"
    case "DateTime":
      return "datetime"
    case "Checkbox":
    case "Switch":
      return "boolean"
    default:
      return "text"
  }
}

function metadataColumnRender(fieldKey: string) {
  return (_value: unknown, row: Record<string, unknown>) => {
    const raw = row.metadata
    if (raw == null || raw === "") return "—"
    try {
      const obj =
        typeof raw === "string"
          ? (JSON.parse(raw) as Record<string, unknown>)
          : (raw as Record<string, unknown>)
      const v = obj[fieldKey]
      if (v == null || v === "") return "—"
      return String(v)
    } catch {
      return "—"
    }
  }
}

function parsedFieldToColumn(field: ParsedFormField): EntityColumn {
  const isCustom = isCustomField(field.fieldId)
  const key = isCustom ? field.fieldId : field.name || field.fieldId
  return {
    key: isCustom ? `metadata:${field.fieldId}` : key,
    label: field.label,
    type: stdbTypeToColumnType(field.type),
    sortable: !isCustom,
    render: isCustom ? metadataColumnRender(field.fieldId) : undefined,
  }
}

/**
 * Merge STDB form list fields (`showInList`) into a static entity table config.
 * Custom fields read values from the row `metadata` JSON column.
 */
export function mergeRuntimeListConfig(
  base: EntityTableConfig,
  runtime: MergedFormConfiguration | null,
  fieldAliases: Readonly<Record<string, string | null>> = {},
): EntityTableConfig {
  if (!runtime) return base

  const baseColumns = base.columns ?? []
  const runtimeFields = runtime.fields ?? []

  const existingKeys = new Set(
    baseColumns.map((c) => normalizeFormFieldKey(c.key.replace(/^metadata:/, ""))),
  )

  const runtimeColumns = runtimeFields
    .filter((f) => f.showInList && f.isEnabled)
    .sort((a, b) => a.order - b.order)
    .map(parsedFieldToColumn)
    .flatMap((column) => {
      // Only the owning list can map legacy form names to its row projection.
      // Custom metadata keys retain their own identity.
      if (column.key.startsWith("metadata:")) return [column]
      const alias = fieldAliases[normalizeFormFieldKey(column.key)]
      return alias === null ? [] : [{ ...column, key: alias ?? column.key }]
    })
    .filter((col) => {
      const bare = col.key.replace(/^metadata:/, "")
      const norm = normalizeFormFieldKey(bare)
      if (existingKeys.has(norm)) return false
      existingKeys.add(norm)
      return true
    })

  if (runtimeColumns.length === 0) {
    return base
  }

  return {
    ...base,
    columns: [...baseColumns, ...runtimeColumns],
  }
}

/** Build select filters from STDB select fields marked showInList (optional extension). */
export function runtimeListFiltersFromFields(
  runtime: MergedFormConfiguration | null,
  fieldAliases: Readonly<Record<string, string | null>> = {},
): EntityFilter[] {
  if (!runtime) return []
  return (runtime.fields ?? [])
    .filter((f) => f.showInList && f.isEnabled && (f.type === "Select" || f.type === "Radio"))
    // Legacy form choices can use different values from the list's real states
    // and relations. The owning list supplies those canonical filters.
    .filter((f) => isCustomField(f.fieldId) || !(normalizeFormFieldKey(f.name || f.fieldId) in fieldAliases))
    .map((f) => ({
      key: f.name || f.fieldId,
      label: f.label,
      type: "select" as const,
      options: (f.options ?? []).map((o) => ({ value: o.value, label: o.label })),
    }))
}
