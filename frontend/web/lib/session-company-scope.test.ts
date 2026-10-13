import assert from "node:assert/strict"
import test from "node:test"

import { resolveSessionCompanyIds } from "./session-company-scope"

const companies = [
  { id: 9, isParent: false },
  { id: 3, isParent: true },
  { id: 5, isParent: false },
]

test("organization admins may select every organization company", () => {
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 3, roleNames: ["Admin"] }),
    [3, 5, 9],
  )
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 3, roleNames: ["organization-admin"] }),
    [3, 5, 9],
  )
})

test("company-bound users remain pinned to their membership company", () => {
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 9, roleNames: ["accountant"] }),
    [9],
  )
})

test("invalid membership falls back deterministically without expanding authority", () => {
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 999, roleNames: [] }),
    [3],
  )
  assert.deepEqual(resolveSessionCompanyIds({ companies: [], roleNames: ["owner"] }), [])
})
