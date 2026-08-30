import { strict as assert } from "node:assert"
import { test } from "node:test"

import { createStdbSdk } from "./sdk"

test("accounting SDK targets the immutable typed operation and selected company", async () => {
  let request: { url: string; body: string } | undefined
  const apiFetch = async (url: string, init?: RequestInit) => {
    request = { url, body: String(init?.body) }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  await createStdbSdk(apiFetch).forCompany(42n).accounting.accounts.create({
    code: "1000",
    name: "Cash",
    userTypeId: 1n,
    currencyId: null,
    internalType: null,
    internalGroup: null,
    groupId: null,
    reconcile: false,
    taxIds: [],
    note: null,
    openingDebit: 0,
    openingCredit: 0,
    allowedJournalIds: [],
    nonTrade: false,
    isOffBalance: false,
    metadata: null,
  })

  assert.equal(request?.url, "/api/operations/erp.create_account_account")
  assert.deepEqual(JSON.parse(request?.body ?? "{}"), {
    params: {
      company_id: { some: 42 },
      code: "1000",
      name: "Cash",
      user_type_id: 1,
      currency_id: { none: [] },
      internal_type: null,
      internal_group: null,
      group_id: { none: [] },
      reconcile: false,
      tax_ids: [],
      note: { none: [] },
      opening_debit: 0,
      opening_credit: 0,
      allowed_journal_ids: [],
      non_trade: false,
      is_off_balance: false,
      metadata: { none: [] },
    },
  })
})
