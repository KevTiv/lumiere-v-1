import type { EntityInlineEdit, EntityViewConfig } from "./entity-view-types"

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
