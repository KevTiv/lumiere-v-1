import assert from "node:assert/strict"
import test from "node:test"

import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/stdb/stdb-params-json"

test("procurement score wire JSON keeps zero scores and spells notes as Option", () => {
  const withNotes = stdbParamsToJson(
    { countryPackKey: "us", scoreKind: "price", scoreValue: 0, maxValue: 10, notes: "weak" },
    "UpsertProposalProcurementScoreParams",
  )
  assert.deepEqual(withNotes, {
    country_pack_key: "us",
    score_kind: "price",
    score_value: 0,
    max_value: 10,
    notes: { some: "weak" },
  })
  const noNotes = stdbParamsToJson(
    { countryPackKey: "us", scoreKind: "price", scoreValue: 3.5, maxValue: 10, notes: null },
    "UpsertProposalProcurementScoreParams",
  )
  assert.deepEqual(noNotes.notes, { none: [] })
  assert.equal(noNotes.score_value, 3.5)
})

test("template wire JSON spells country pack and metadata as Option", () => {
  const sectionsJson = JSON.stringify([{ title: "Summary", content: "x", sequence: 10 }])
  const none = stdbParamsToJson(
    { name: "Std", category: "general", locale: "en", countryPackKey: null, sectionsJson, isActive: true, metadata: null },
    "CreateProposalTemplateParams",
  )
  assert.deepEqual(none, {
    name: "Std",
    category: "general",
    locale: "en",
    country_pack_key: { none: [] },
    sections_json: sectionsJson,
    is_active: true,
    metadata: { none: [] },
  })
  const some = stdbParamsToJson(
    { name: "Std", category: "general", locale: "en", countryPackKey: "us", sectionsJson, isActive: false, metadata: null },
    "CreateProposalTemplateParams",
  )
  assert.deepEqual(some.country_pack_key, { some: "us" })
  assert.equal(some.is_active, false)
})

test("section conflict resolve wire JSON spells aiSuggestion as Option and keeps sequence 0", () => {
  const none = stdbParamsToJson(
    { title: "Scope", content: "mine", status: "draft", sequence: 0, aiSuggestion: null },
    "UpsertProposalSectionParams",
  )
  assert.deepEqual(none, {
    title: "Scope",
    content: "mine",
    status: "draft",
    sequence: 0,
    ai_suggestion: { none: [] },
  })
  const some = stdbParamsToJson(
    { title: "Scope", content: "mine", status: "draft", sequence: 30, aiSuggestion: "hint" },
    "UpsertProposalSectionParams",
  )
  assert.deepEqual(some.ai_suggestion, { some: "hint" })
  assert.equal(some.sequence, 30)
})

test("section conflict resolve command body carries ids, no expected revision, and the Option-spelled params", () => {
  const { init } = stdbBffCommandPost("resolve_proposal_section_conflict", {
    companyId: 3n,
    proposalId: 1n,
    sectionId: 7n,
    params: stdbParamsToJson(
      { title: "Scope", content: "mine", status: "draft", sequence: 10, aiSuggestion: null },
      "UpsertProposalSectionParams",
    ),
  })
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  const text = JSON.stringify(body)
  assert.ok(text.includes('"ai_suggestion":{"none":[]}'), text)
  assert.ok(!text.includes("expected_revision") && !text.includes("expectedRevision"), text)
})
