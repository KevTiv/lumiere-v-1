import { describe, expect, it } from "vitest"

import type { MergedFormConfiguration, ParsedFormField } from "../forms/config/types"
import type { FormConfig } from "./form-types"
import { mergeRuntimeFormConfig } from "./runtime-form-config"

describe("mergeRuntimeFormConfig", () => {
  it("applies live organization users to a matched UserSelect field", () => {
    const staticConfig: FormConfig = {
      id: "assign-owner",
      title: "Assign owner",
      sections: [
        {
          id: "main",
          fields: [
            {
              id: "owner_id",
              name: "owner_id",
              label: "Owner",
              type: "select",
              options: [],
            },
          ],
        },
      ],
    }
    const userField = {
      id: 1,
      fieldId: "owner_id",
      name: "owner_id",
      label: "Owner",
      type: "UserSelect",
      options: [{ value: "abc123", label: "Ada Lovelace" }],
      validation: { required: true },
      aiSuggestions: [],
      order: 1,
      isSystem: true,
      isEnabled: true,
      showInList: false,
      width: "Full",
    } satisfies ParsedFormField
    const runtime = {
      config: {},
      fields: [userField],
      sourceFields: [userField],
      customFields: [],
    } as MergedFormConfiguration

    const merged = mergeRuntimeFormConfig(staticConfig, runtime)
    expect(merged.config.sections[0]?.fields[0]).toMatchObject({
      type: "select",
      options: [{ value: "abc123", label: "Ada Lovelace" }],
    })
  })
})
