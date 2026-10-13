import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import { aiAgentCreateFormConfig } from "./ai-agent-form-configs"

describe("AI agent starter defaults", () => {
  it("starts local agent creation with Ollama and the bundled model", () => {
    const translate = ((key: string) => key) as TFunction
    const fields = aiAgentCreateFormConfig(translate).sections.flatMap((section) => section.fields)
    const defaults = Object.fromEntries(fields.map((field) => [field.name, field.defaultValue]))

    expect(defaults.provider).toBe("Ollama")
    expect(defaults.model).toBe("gemma4:e2b-mlx")
    expect(defaults.costPer1KTokens).toBe(0)
  })
})
