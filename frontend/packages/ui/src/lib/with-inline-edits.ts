import type { EntityDetailConfig, EntityInlineEdit, EntityViewConfig } from "./entity-view-types"

/**
 * Makes the given columns (by key) of a table view editable in place. Other
 * columns and non-table views are returned untouched.
 */
export function withInlineEdits(
  ec: EntityViewConfig,
  edits: Record<string, EntityInlineEdit>,
): EntityViewConfig {
  if (ec.view.mode !== "table") return ec
  return {
    ...ec,
    view: {
      ...ec.view,
      columns: ec.view.columns.map((col) => (edits[col.key] ? { ...col, inlineEdit: edits[col.key] } : col)),
    },
  }
}

/**
 * Makes the given fields (by key) of a record detail view editable where they
 * are read. Other fields are returned untouched.
 */
export function withDetailInlineEdits(
  config: EntityDetailConfig,
  edits: Record<string, EntityInlineEdit>,
): EntityDetailConfig {
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => (edits[field.key] ? { ...field, inlineEdit: edits[field.key] } : field)),
    })),
  }
}
