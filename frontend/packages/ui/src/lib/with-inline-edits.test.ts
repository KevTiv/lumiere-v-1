import { describe, expect, it } from "vitest"
import { withInlineEdits } from "./with-inline-edits"
import type { EntityInlineEdit, EntityViewConfig } from "./entity-view-types"

const edit: EntityInlineEdit = { kind: "text", save: async () => undefined }

function tableConfig(): EntityViewConfig {
  return {
    view: {
      mode: "table",
      columns: [
        { key: "name", label: "Name" },
        { key: "state", label: "State" },
      ],
    },
  } as unknown as EntityViewConfig
}

describe("withInlineEdits", () => {
  it("attaches inlineEdit only to the named columns", () => {
    const out = withInlineEdits(tableConfig(), { name: edit })
    if (out.view.mode !== "table") throw new Error("expected table")
    expect(out.view.columns[0]?.inlineEdit).toBe(edit)
    expect(out.view.columns[1]?.inlineEdit).toBeUndefined()
  })

  it("ignores unknown keys and does not mutate the input", () => {
    const input = tableConfig()
    const out = withInlineEdits(input, { missing: edit })
    if (input.view.mode !== "table" || out.view.mode !== "table") throw new Error("expected table")
    expect(out.view.columns.every((c) => c.inlineEdit === undefined)).toBe(true)
    expect(input.view.columns.every((c) => c.inlineEdit === undefined)).toBe(true)
  })

  it("returns non-table configs unchanged", () => {
    const board = { view: { mode: "board" } } as unknown as EntityViewConfig
    expect(withInlineEdits(board, { name: edit })).toBe(board)
  })
})
