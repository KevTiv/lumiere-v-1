import { expect, test } from "vitest"
import { hasCompleteAiAgentConfiguration } from "./ai-agent-configuration"

const configuration = {
  temperature: 0.7,
  maxTokens: 4096,
  rateLimitPerMinute: 60,
  contextWindow: 32000,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  systemPrompt: "Keep the existing private prompt",
  monthlyBudget: 42,
}

test("a replacement editor requires every persisted setting to be readable", () => {
  expect(hasCompleteAiAgentConfiguration(configuration)).toBe(true)
  for (const field of Object.keys(configuration)) {
    const partial = { ...configuration }
    Reflect.deleteProperty(partial, field)
    expect(hasCompleteAiAgentConfiguration(partial), `hidden ${field}`).toBe(
      false,
    )
  }
  expect(
    hasCompleteAiAgentConfiguration({
      temperature: 0.7,
      maxTokens: 4096,
      monthlyBudget: 42,
    }),
  ).toBe(false)
})

test("explicitly empty settings and zero limits remain editable", () => {
  expect(
    hasCompleteAiAgentConfiguration({
      ...configuration,
      systemPrompt: null,
      monthlyBudget: null,
      rateLimitPerMinute: 0,
    }),
  ).toBe(true)
  expect(
    hasCompleteAiAgentConfiguration({
      ...configuration,
      systemPrompt: "",
      monthlyBudget: 0,
      temperature: 0,
    }),
  ).toBe(true)
  expect(
    hasCompleteAiAgentConfiguration({
      ...configuration,
      rateLimitPerMinute: NaN,
    }),
  ).toBe(false)
})
