const numericSettings = [
  "temperature",
  "maxTokens",
  "rateLimitPerMinute",
  "contextWindow",
  "topP",
  "frequencyPenalty",
  "presencePenalty",
] as const

type ConfigurationField =
  | (typeof numericSettings)[number]
  | "systemPrompt"
  | "monthlyBudget"
type ConfigurationProjection = { [Field in ConfigurationField]?: unknown }

/** A replacement form must not interpret a field hidden by read policy as a
 * blank value or a default. Action-only commands do not need this snapshot. */
export function hasCompleteAiAgentConfiguration(
  row: ConfigurationProjection,
): boolean {
  return (
    numericSettings.every(
      (field) => typeof row[field] === "number" && Number.isFinite(row[field]),
    ) &&
    (row.systemPrompt === null || typeof row.systemPrompt === "string") &&
    (row.monthlyBudget === null ||
      (typeof row.monthlyBudget === "number" &&
        Number.isFinite(row.monthlyBudget)))
  )
}
