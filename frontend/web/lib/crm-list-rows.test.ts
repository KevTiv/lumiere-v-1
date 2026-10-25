import assert from "node:assert/strict"
import test from "node:test"
import { crmContactListRow, crmLeadListRow } from "./crm-list-rows"

test("lead columns retain the real subject, company, email and timestamp", () => {
  const row = crmLeadListRow({ name: "Display rollout", email: "buyer@example.test", partnerId: 7, createdAt: "2026-10-25" }, new Map([["7", "Willow Design"]]))
  assert.equal(row.contactName, "Display rollout")
  assert.equal(row.partnerName, "Willow Design")
  assert.equal(row.emailFrom, "buyer@example.test")
  assert.equal(row.createDate, "2026-10-25")
})

test("company and person rows derive their company label from the correct relation", () => {
  const names = new Map([["7", "Willow Design"]])
  assert.deepEqual(crmContactListRow({ name: "Willow Design", type: "company" }, names), {
    name: "Willow Design", type: "company", isCompany: true, companyName: "Willow Design",
  })
  const person = crmContactListRow({ name: "Demo buyer", type: "person", parentId: 7 }, names)
  assert.equal(person.isCompany, false)
  assert.equal(person.companyName, "Willow Design")
  assert.equal(crmContactListRow({ name: "Unreadable type" }, names).isCompany, undefined)
})
