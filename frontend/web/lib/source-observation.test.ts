import assert from "node:assert/strict"
import test from "node:test"
import { interpretSourceText, sourceHistoryLink, sourceHistorySelection } from "./source-observation"

test("mixed-language notes produce explanations without payment or stock effects", () => {
  assert.deepEqual(interpretSourceText("PAYEMENT CHEQ").map((hint) => hint.key), ["cheque"])
  assert.deepEqual(interpretSourceText("PAIEMENT CHÈQUE").map((hint) => hint.key), ["cheque"])
  assert.deepEqual(interpretSourceText("CREDIT").map((hint) => hint.key), ["credit"])
  assert.deepEqual(interpretSourceText("MOMO HQ").map((hint) => hint.key), ["mobileMoney", "headOffice"])
  const source = "INKOKO ZIFITE IKIBAZO"
  assert.equal(interpretSourceText(source)[0]?.original, source)
  assert.match(interpretSourceText(source)[0]?.message ?? "", /does not establish a write-off/)
  assert.deepEqual(interpretSourceText("not credit"), [])
  assert.deepEqual(interpretSourceText("CREDITON"), [])
  assert.deepEqual(interpretSourceText("unrecognized local note"), [])
})

test("verified-source links retain exact large dataset IDs and reset across companies", () => {
  const link = sourceHistoryLink(7, "9007199254740993")
  const url = new URL(link, "https://example.test")
  assert.equal(url.pathname, "/settings")
  assert.equal(url.hash, "#available-history")
  assert.deepEqual(sourceHistorySelection(url.search, 7), { batchId: "9007199254740993", verifiedOnly: true })
  assert.deepEqual(sourceHistorySelection(url.search, 8), { batchId: null, verifiedOnly: false })
  assert.throws(() => sourceHistoryLink(0), /operating company/)
  assert.throws(() => sourceHistoryLink(7, "1&companyId=8"), /dataset/)
  assert.equal(sourceHistorySelection("?historyCompany=7&historyBatch=bad&historyVerified=true", 7).batchId, null)
})
