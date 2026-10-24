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

  it("describes money, percent and quantity as numbers with their default bounds", () => {
    const config: FormConfig = {
      id: "deal", title: "Deal",
      sections: [{ id: "main", fields: [
        { id: "revenue", name: "revenue", type: "money", currency: "USD" },
        { id: "probability", name: "probability", type: "percent" },
        { id: "qty", name: "qty", type: "quantity", validation: { max: 10 } },
      ] }],
    }

    expect(serializeAiFormSchema(config)).toEqual([
      { name: "revenue", label: undefined, type: "number", required: false },
      { name: "probability", label: undefined, type: "number", required: false, validation: { min: 0, max: 100 } },
      { name: "qty", label: undefined, type: "number", required: false, validation: { min: 0, max: 10 } },
    ])
  })
})
