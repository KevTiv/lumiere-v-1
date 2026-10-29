import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "@lumiere/i18n"
import type { EntityDetailConfig, EntityTableConfig } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityDetail } from "./entity-detail"
import { useScopedEntityDetailConfig, useScopedEntityTableConfig } from "./entity-view"

const table: EntityTableConfig = {
  mode: "table",
  get emptyMessage() { return i18n.t("common.save") },
  columns: [{ key: "amount", type: "currency", get label() { return i18n.t("common.save") } }],
}
const detail: EntityDetailConfig = {
  mode: "detail",
  sections: [{ id: "main", get title() { return i18n.t("common.notes") }, fields: [{ key: "name", label: "Name" }] }],
}

function ScopedSnapshot() {
  const scopedTable = useScopedEntityTableConfig(table)
  const scopedDetail = useScopedEntityDetailConfig(detail)
  return <>
    <span data-testid="scoped-empty">{scopedTable.emptyMessage}</span>
    <span data-testid="scoped-column">{scopedTable.columns[0]?.label}</span>
    <span data-testid="scoped-section">{scopedDetail.sections[0]?.title}</span>
    <EntityDetail config={detail} data={{ name: "Alpha" }} />
  </>
}

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("en")
})

describe("entity configuration language changes", () => {
  it("refreshes memoized configuration snapshots without a record or permission change", async () => {
    await i18n.changeLanguage("en")
    const previousSave = i18n.getResource("fr", "translation", "common.save")
    const previousNotes = i18n.getResource("fr", "translation", "common.notes")
    i18n.addResource("fr", "translation", "common.save", "Enregistrer le document")
    i18n.addResource("fr", "translation", "common.notes", "Notes françaises")
    try {
      render(<RBACProvider><ScopedSnapshot /></RBACProvider>)
      expect(screen.getByTestId("scoped-column").textContent).toBe("Save")
      expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy()

      await act(() => i18n.changeLanguage("fr"))

      expect(screen.getByTestId("scoped-empty").textContent).toBe("Enregistrer le document")
      expect(screen.getByTestId("scoped-column").textContent).toBe("Enregistrer le document")
      expect(screen.getByTestId("scoped-section").textContent).toBe("Notes françaises")
      expect(screen.getByRole("heading", { name: "Notes françaises" })).toBeTruthy()
    } finally {
      i18n.addResource("fr", "translation", "common.save", previousSave)
      i18n.addResource("fr", "translation", "common.notes", previousNotes)
    }
  })
})
