import assert from "node:assert/strict"
import test from "node:test"
import { parsePlatformAiProfile, parsePlatformAiProfileState } from "./ai-platform-profile"

export const profileFixture = {
  template_key: "alpha-default", template_version: 1,
  generation_profile: {
    provider: "mistral", model: "generation-v1", max_tokens: 2048, context_window: 32000,
    timeout_ms: 30000, max_concurrency: 2, input_cost_per_1k_microunits: 0, output_cost_per_1k_microunits: 10,
  },
  review_profile: {
    provider: "mistral", model: "review-v1", max_tokens: 2048, context_window: 32000,
    timeout_ms: 30000, max_concurrency: 2, input_cost_per_1k_microunits: 1, output_cost_per_1k_microunits: 10,
  },
  currency: "USD", monthly_limit_units: 5000000, rate_limit_per_minute: 10, max_enrolled_organizations: 5,
}

test("profile input strips authority, credentials and catalog IDs", () => {
  assert.deepEqual(parsePlatformAiProfile({ ...profileFixture, org_id: 99, stdb_token: "forged", skill_ids: [99] }), profileFixture)
})

test("profile validation rejects impossible model routing and unsafe numeric limits", () => {
  for (const patch of [
    { template_key: "wrong.key" }, { template_key: "a".repeat(97) }, { template_version: 0 },
    { monthly_limit_units: Number.MAX_SAFE_INTEGER + 1 }, { monthly_limit_units: 0 },
    { currency: "usd" }, { max_enrolled_organizations: 0 },
    { review_profile: { ...profileFixture.review_profile, provider: "gemini" } },
    { review_profile: profileFixture.generation_profile },
    { generation_profile: { ...profileFixture.generation_profile, model: "model-latest" } },
    { generation_profile: { ...profileFixture.generation_profile, model: "x".repeat(129) } },
    { generation_profile: { ...profileFixture.generation_profile, context_window: 2048 } },
    { generation_profile: { ...profileFixture.generation_profile, input_cost_per_1k_microunits: 1_000_000_000_001 } },
  ]) assert.throws(() => parsePlatformAiProfile({ ...profileFixture, ...patch }))
})

test("read-back must contain the published active version in the canonical catalog", () => {
  assert.deepEqual(parsePlatformAiProfileState({ active_template: null, templates: [] }), { active_template: null, templates: [] })
  const active_template = { ...profileFixture, id: 7 }
  const templates = [{ id: 7, template_key: "alpha-default", template_version: 1 }]
  assert.deepEqual(parsePlatformAiProfileState({ active_template, templates }), { active_template, templates })
  assert.throws(() => parsePlatformAiProfileState({ active_template, templates: [] }), /verified/)
  assert.throws(() => parsePlatformAiProfileState({ active_template, templates: [{ ...templates[0], template_version: 2 }] }), /verified/)
  assert.throws(() => parsePlatformAiProfileState({ templates }), /Invalid AI profile/)
})
