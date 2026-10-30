import assert from "node:assert/strict"
import test from "node:test"
import { articleMemberOptions, currentArticleMember } from "./article-member-options"

const active = "ab".repeat(32)
const departed = "cd".repeat(32)
const article = { id: "9007199254740993", organizationId: 7, memberIds: [active, departed] }

test("article removal keeps departed members selectable without people-directory access", () => {
  const membership = articleMemberOptions(article, 7)
  assert.equal(membership.status, "ready")
  assert.deepEqual(membership.options.map((option) => option.value), [active, departed])
  assert.match(membership.options[1].label, new RegExp(departed))
  assert.equal(currentArticleMember([article], article.id, 7, departed), departed)
})

test("available names enrich only actual exposed article members", () => {
  const membership = articleMemberOptions(article, 7, [{ value: active, label: "Alex" }, { value: "ef".repeat(32), label: "Not a member" }])
  assert.match(membership.options[0].label, /^Alex · /)
  assert.equal(membership.options.length, 2)
  assert.equal(currentArticleMember([article], article.id, 7, "ef".repeat(32)), null)
})

test("masked, malformed, ambiguous and foreign article membership never authorizes removal", () => {
  assert.equal(articleMemberOptions({ id: article.id, organizationId: 7 }, 7).status, "unavailable")
  assert.equal(articleMemberOptions({ ...article, memberIds: [active, "invalid"] }, 7).status, "unavailable")
  assert.equal(articleMemberOptions({ ...article, memberIds: [active, active] }, 7).status, "unavailable")
  assert.equal(currentArticleMember([article], "9007199254740992", 7, departed), null)
  assert.equal(currentArticleMember([article], article.id, 8, departed), null)
  assert.equal(currentArticleMember([article, article], article.id, 7, departed), null)
  assert.equal(currentArticleMember([{ ...article, memberIds: [active] }], article.id, 7, departed), null)
})
