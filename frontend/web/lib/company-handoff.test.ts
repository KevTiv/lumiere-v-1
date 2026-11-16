import assert from "node:assert/strict"
import test from "node:test"
import { companyHandoff } from "./company-handoff"
import { companySetupLinks } from "./company-setup-model"

test("guided setup selects authorized company without losing the deep link", () => {
  for (const { href } of companySetupLinks("7").slice(0, 5)) {
    const target = new URL(href, "https://workspace.test")
    assert.ok(target.pathname === "/accounting" || target.pathname === "/products")
    const handoff = companyHandoff(`${href}&filter=state%3Aactive#setup`, [1, 7])
    assert.equal(handoff?.companyId, 7)
    assert.equal(handoff?.href, `${target.pathname}?tab=${target.searchParams.get("tab")}&filter=state%3Aactive#setup`)
  }
})

test("company handoffs reject unauthorized and malformed ids", () => {
  for (const requested of ["8", "0", "7e0", "7.1", "9007199254740992"]) {
    assert.equal(companyHandoff(`/accounting?tab=accounts&companyId=${requested}`, [7]), null)
  }
  assert.equal(companyHandoff("/accounting?companyId=7", []), null)
})
