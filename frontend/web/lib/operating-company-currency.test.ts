import assert from "node:assert/strict"
import test from "node:test"
import { operatingCompanyCurrencyCode, WORKSPACE_ROW_CURRENCY_KEY } from "./operating-company-currency"

const currencies = [{ id: 1, code: "rwf" }, { id: 2, code: "BRL" }, { id: 3, code: "" }]
const companies = [{ id: 7, currencyId: 2 }, { id: 8, currency_id: 1 }, { id: 9, currencyId: 3 }, { id: 10 }]

test("is the upper-case ISO code of the operating company's currency", () => {
  assert.equal(operatingCompanyCurrencyCode(currencies, companies, 7n), "BRL")
  assert.equal(operatingCompanyCurrencyCode(currencies, companies, "8"), "RWF")
})

test("is undefined when the company, its currency or the code is unknown", () => {
  assert.equal(operatingCompanyCurrencyCode(currencies, companies, 99), undefined)
  assert.equal(operatingCompanyCurrencyCode(currencies, companies, null), undefined)
  assert.equal(operatingCompanyCurrencyCode(currencies, companies, 9), undefined)
  assert.equal(operatingCompanyCurrencyCode(currencies, companies, 10), undefined)
  assert.equal(operatingCompanyCurrencyCode([], companies, 8), undefined)
})

test("names the row field every workspace table reads its currency from", () => {
  assert.equal(WORKSPACE_ROW_CURRENCY_KEY, "currencyId")
})
