export type PlatformModelProfile = {
  provider: string
  model: string
  max_tokens: number
  context_window: number
  timeout_ms: number
  max_concurrency: number
  input_cost_per_1k_microunits: number
  output_cost_per_1k_microunits: number
}

export type PlatformAiProfile = {
  template_key: string
  template_version: number
  generation_profile: PlatformModelProfile
  review_profile: PlatformModelProfile
  currency: string
  monthly_limit_units: number
  rate_limit_per_minute: number
  max_enrolled_organizations: number
}

export type PlatformAiProfileState = {
  active_template: (PlatformAiProfile & { id: number }) | null
  templates: { id: number; template_key: string; template_version: number }[]
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI profile")
  return value as Record<string, unknown>
}

function integer(value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("AI profile limits must be valid whole numbers")
  }
  return value
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)) {
    throw new Error("AI profile keys and model names must be valid identifiers")
  }
  return value
}

function modelProfile(value: unknown): PlatformModelProfile {
  const row = record(value)
  const provider = row.provider
  if (provider !== "mistral" && provider !== "gemini" && provider !== "ollama") {
    throw new Error("Select a supported AI provider")
  }
  const model = row.model
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/.test(model)) {
    throw new Error("Enter an exact model identifier")
  }
  if (model.endsWith("-latest")) throw new Error("Use an exact model version instead of a latest alias")
  const max_tokens = integer(row.max_tokens, 1, 0xffffffff)
  const context_window = integer(row.context_window, 1, 0xffffffff)
  if (max_tokens >= context_window) throw new Error("The context window must exceed the output token limit")
  return {
    provider, model, max_tokens, context_window,
    timeout_ms: integer(row.timeout_ms, 1, 0xffffffff),
    max_concurrency: integer(row.max_concurrency, 1, 0xffffffff),
    input_cost_per_1k_microunits: integer(row.input_cost_per_1k_microunits, 0, 1_000_000_000_000),
    output_cost_per_1k_microunits: integer(row.output_cost_per_1k_microunits, 0, 1_000_000_000_000),
  }
}

/** Allow only profile settings; credentials, tenant ids and skill ids stay server-owned. */
export function parsePlatformAiProfile(value: unknown): PlatformAiProfile {
  const row = record(value)
  if (typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) {
    throw new Error("Enter a three-letter currency code")
  }
  const generation_profile = modelProfile(row.generation_profile)
  const review_profile = modelProfile(row.review_profile)
  if (generation_profile.provider !== review_profile.provider) throw new Error("Both models must use the same provider")
  if (generation_profile.model === review_profile.model) {
    throw new Error("Select a distinct review model")
  }
  return {
    template_key: identifier(row.template_key),
    template_version: integer(row.template_version, 1, 0xffffffff),
    generation_profile, review_profile, currency: row.currency,
    monthly_limit_units: integer(row.monthly_limit_units),
    rate_limit_per_minute: integer(row.rate_limit_per_minute, 1, 0xffffffff),
    max_enrolled_organizations: integer(row.max_enrolled_organizations, 1, 0xffffffff),
  }
}

export function parsePlatformAiProfileState(value: unknown): PlatformAiProfileState {
  const row = record(value)
  if (!Array.isArray(row.templates)) throw new Error("AI profile read-back is incomplete")
  const templates = row.templates.map((value) => {
    const item = record(value)
    return { id: integer(item.id), template_key: identifier(item.template_key), template_version: integer(item.template_version, 1, 0xffffffff) }
  })
  const active_template = row.active_template === null ? null : {
    ...parsePlatformAiProfile(row.active_template), id: integer(record(row.active_template).id),
  }
  if (active_template && !templates.some((item) => item.id === active_template.id && item.template_key === active_template.template_key && item.template_version === active_template.template_version)) {
    throw new Error("The default AI profile could not be verified")
  }
  return { active_template, templates }
}
