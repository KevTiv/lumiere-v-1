import assert from "node:assert/strict"
import test from "node:test"

import { stdbBffCallUrl } from "@lumiere/stdb/commands"

import { matchesOperationFaultTarget, matchesOperationResponse } from "./operation-response"

function response(path: string) {
  return { url: () => `http://127.0.0.1:3100${path}` }
}

test("matches immutable operation traffic", () => {
  assert.equal(
    matchesOperationResponse(
      response(stdbBffCallUrl("grant_permission")),
      "grant_permission",
    ),
    true,
  )
})

test("matches explicitly named compatibility traffic", () => {
  assert.equal(
    matchesOperationResponse(
      response("/api/compat/reducer/grant_permission"),
      "grant_permission",
    ),
    true,
  )
  assert.equal(
    matchesOperationResponse(
      response("/api/compat/reducer/create_form_configuration"),
      "create_form_configuration",
    ),
    true,
  )
})

test("matches an immutable contract operation", () => {
  assert.equal(
    matchesOperationResponse(
      response("/api/operations/erp.create_purchase_order_once"),
      "erp.create_purchase_order_once",
    ),
    true,
  )
  assert.equal(
    matchesOperationResponse(
      response("/api/operations/erp.create_purchase_order"),
      "erp.create_purchase_order_once",
    ),
    false,
  )
})

test("does not match a different operation", () => {
  assert.equal(
    matchesOperationResponse(
      response("/api/compat/reducer/revoke_permission"),
      "grant_permission",
    ),
    false,
  )
})

test("fault injection resolves names and legacy URLs to immutable operations", () => {
  const url = new URL(stdbBffCallUrl("confirm_sales_order"), "http://127.0.0.1:3100")
  for (const target of ["confirm_sales_order", "/api/compat/reducer/confirm_sales_order", "/v1/compat/reducer/confirm_sales_order", url.pathname]) {
    assert.equal(matchesOperationFaultTarget(url, target), true, target)
  }
  assert.equal(matchesOperationFaultTarget(url, "confirm_payslip"), false)
  assert.equal(matchesOperationFaultTarget(url, "confirm"), false)
  assert.equal(matchesOperationFaultTarget(new URL(`${url}/extra`), url.pathname), false)
  assert.equal(matchesOperationFaultTarget(new URL("http://localhost/api/compat/reducer/confirm_sales_order"), "confirm_sales_order"), true)
})


test("matches an exact immutable member access operation", () => {
  for (const prefix of ["/api", "/v1"]) {
    assert.equal(matchesOperationResponse(response(`${prefix}/operations/erp.set_member_access`), "erp.set_member_access"), true)
    assert.equal(matchesOperationResponse(response(`${prefix}/operations/erp.set_member_access/extra`), "erp.set_member_access"), false)
    assert.equal(matchesOperationResponse(response(`${prefix}/operations/erp.assign_role`), "erp.set_member_access"), false)
  }
})
