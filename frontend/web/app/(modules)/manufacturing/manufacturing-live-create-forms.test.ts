import assert from "node:assert/strict"
import test from "node:test"

import type { FormConfig, ModuleTab } from "@lumiere/ui"
import { withManufacturingLiveCreateForm } from "./manufacturing-live-create-forms"

const form = (id: string) => ({ id, title: id, sections: [] }) as FormConfig
const forms = {
  orders: form("live-manufacturing-order"),
  boms: form("live-bom"),
  workcenters: form("live-workcenter"),
}

test("manufacturing order tabs receive the live selector form", () => {
  const staticForm = form("static-empty-order")
  const tab = { id: "orders", label: "Orders", type: "entity", createForm: staticForm } as ModuleTab

  const decorated = withManufacturingLiveCreateForm(tab, forms)

  assert.equal(decorated.createForm, forms.orders)
})

test("the live form decorator covers each configured create tab only", () => {
  assert.equal(withManufacturingLiveCreateForm({ id: "boms" } as ModuleTab, forms).createForm, forms.boms)
  assert.equal(withManufacturingLiveCreateForm({ id: "workcenters" } as ModuleTab, forms).createForm, forms.workcenters)
  const quality = { id: "quality" } as ModuleTab
  assert.equal(withManufacturingLiveCreateForm(quality, forms), quality)
})
