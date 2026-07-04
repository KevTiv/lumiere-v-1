import { describe, it, expect } from "vitest"
import type { FormConfig } from "./form-types"
import { serializeAiFormSchema } from "./ai-form-schema"

describe("serializeAiFormSchema", () => {
  it("keeps only safe schema metadata for AI suggestions", () => {
    const config: FormConfig = {
      id: "customer",
      title: "Customer",
      sections: [
        {
          id: "main",
          fields: [
            {
              id: "name",
              name: "name",
              label: "Name",
              type: "text",
              required: true,
              validation: {
                minLength: 2,
                custom: () => null,
              },
            },
            {
              id: "status",
              name: "status",
              label: "Status",
              type: "select",
              required: false,
              options: [{ value: "draft", label: "Draft" }],
            },
            {
              id: "attachment",
              name: "attachment",
              label: "Attachment",
              type: "file",
            },
          ],
        },
      ],
    }

    expect(serializeAiFormSchema(config)).toEqual([
      {
        name: "name",
        label: "Name",
        type: "text",
        required: true,
        validation: { minLength: 2 },
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        required: false,
        options: [{ value: "draft", label: "Draft" }],
      },
    ])
  })
})
