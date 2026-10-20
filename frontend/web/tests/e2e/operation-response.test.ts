import assert from "node:assert/strict"
import test from "node:test"

import { stdbBffCallUrl } from "@lumiere/stdb/commands"

import { matchesOperationResponse } from "./operation-response"

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

test("does not match a different operation", () => {
  assert.equal(
    matchesOperationResponse(
      response("/api/compat/reducer/revoke_permission"),
      "grant_permission",
    ),
    false,
  )
})


test("matches an exact immutable member access operation", () => {
  for (const prefix of ["/api", "/v1"]) {
    assert.equal(matchesOperationResponse(response(`${prefix}/operations/erp.set_member_access`), "erp.set_member_access"), true)
    assert.equal(matchesOperationResponse(response(`${prefix}/operations/erp.set_member_access/extra`), "erp.set_member_access"), false)
    assert.equal(matchesOperationResponse(response(`${prefix}/operations/erp.assign_role`), "erp.set_member_access"), false)
  }
})
