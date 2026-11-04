import assert from "node:assert/strict"
import { describe, it } from "vitest"
import type { FormConfig } from "./form-types"
import type { MergedFormConfiguration, ParsedFormField } from "../forms/config/types"
import { mergeRuntimeFormConfig, parsedFieldToModularField } from "./runtime-form-config"
import { defaultValuesFromMetadata, metadataFromCustomFields } from "../forms/utils/metadata-defaults"
import { serializeAiFormSchema } from "./ai-form-schema"
import { salesForms } from "../forms/config/modules/sales.config"

const field = (overrides: Partial<ParsedFormField> = {}): ParsedFormField => ({
  id: 1, fieldId: "custom:regions", name: "regions", label: "Regions", type: "MultiSelect",
  options: [{ value: "north", label: "North" }, { value: "south", label: "South", disabled: true }],
  validation: { required: true }, aiSuggestions: [], order: 1, isSystem: false,
  isEnabled: true, showInList: false, width: "Full", ...overrides,
})
const empty: FormConfig = { id: "example", title: "Example", sections: [] }
const runtime = (...fields: ParsedFormField[]): MergedFormConfiguration => ({
  config: {} as MergedFormConfiguration["config"], fields, sourceFields: fields, customFields: fields,
})

describe("commercial date bindings", () => {
  const quotation: FormConfig = {
    id: "new-sale-order", title: "New quotation",
    sections: [{ id: "dates", fields: [
      { id: "validityDate", name: "validityDate", type: "date", label: "Valid until" },
      { id: "commitmentDate", name: "commitmentDate", type: "date", label: "Promised delivery date" },
    ] }],
  }

  it("applies legacy delivery metadata and defaults only to the delivery commitment", () => {
    const delivery = field({ fieldId: "delivery_date", name: "delivery_date", type: "Date", label: "Delivery Date", defaultValue: "2026-12-01", isSystem: true })
    const merged = mergeRuntimeFormConfig(quotation, runtime(delivery)).config.sections[0].fields
    assert.equal(merged[0].label, "Valid until")
    assert.equal(merged[0].defaultValue, undefined)
    assert.equal(merged[0].required, undefined)
    assert.equal(merged[1].label, "Delivery Date")
    assert.equal(merged[1].defaultValue, "2026-12-01")
    assert.equal(merged[1].required, true)
  })

  it("does not hide quotation expiry when the runtime delivery field is disabled", () => {
    const delivery = field({ fieldId: "delivery_date", name: "delivery_date", type: "Date", isSystem: true, isEnabled: false })
    const merged = mergeRuntimeFormConfig(quotation, { ...runtime(), sourceFields: [delivery] }, { preferStdbVisibility: true, runtimeFromDatabase: true })
    assert.deepEqual(merged.config.sections[0].fields.map((item) => item.name), ["validityDate"])
  })

  it("prefers canonical delivery metadata even when a legacy alias appears first", () => {
    const delivery = field({ fieldId: "delivery_date", name: "delivery_date", type: "Date", label: "Legacy delivery", defaultValue: "2026-12-01", isSystem: true })
    const commitment = field({ fieldId: "commitment_date", name: "commitment_date", type: "Date", label: "Promised delivery date", defaultValue: "2026-12-02", isSystem: true })
    const merged = mergeRuntimeFormConfig(quotation, runtime(delivery, commitment)).config.sections[0].fields
    assert.equal(merged[0].label, "Valid until")
    assert.equal(merged[1].label, "Promised delivery date")
    assert.equal(merged[1].defaultValue, "2026-12-02")
  })

  it("does not let an enabled legacy alias revive a disabled canonical delivery field", () => {
    const legacy = field({ fieldId: "delivery_date", name: "delivery_date", type: "Date", isSystem: true })
    const canonical = field({ fieldId: "commitment_date", name: "commitment_date", type: "Date", isSystem: true, isEnabled: false })
    const merged = mergeRuntimeFormConfig(quotation, { ...runtime(legacy), sourceFields: [legacy, canonical] }, { preferStdbVisibility: true, runtimeFromDatabase: true })
    assert.deepEqual(merged.config.sections[0].fields.map((item) => item.name), ["validityDate"])
  })

  it("retains legacy delivery fallback when source field metadata is empty", () => {
    const legacy = field({ fieldId: "delivery_date", name: "delivery_date", type: "Date", label: "Legacy delivery", isSystem: true })
    const merged = mergeRuntimeFormConfig(quotation, { ...runtime(legacy), sourceFields: [] }, { preferStdbVisibility: true, runtimeFromDatabase: true })
    assert.deepEqual(merged.config.sections[0].fields.map((item) => item.name), ["validityDate", "commitmentDate"])
    assert.equal(merged.config.sections[0].fields[1].label, "Legacy delivery")
  })
})

describe("runtime form cardinality", () => {
  it("preserves multiple defaults, custom identity, and disabled options", () => {
    const result = parsedFieldToModularField(field({ defaultValue: ["north", "south"] }))
    assert.equal(result.type, "multiselect")
    assert.equal(result.name, "custom:regions")
    assert.deepEqual(result.defaultValue, ["north", "south"])
    if (result.type === "multiselect") assert.equal(result.options[1].disabled, true)
  })
  it("leaves missing defaults available for the form's empty-array initialization", () => {
    assert.equal(parsedFieldToModularField(field()).defaultValue, undefined)
    assert.deepEqual(parsedFieldToModularField(field({ defaultValue: [] })).defaultValue, [])
  })
  it("rejects scalar and mixed-array defaults instead of dropping selections", () => {
    for (const defaultValue of ["north", ["north", 1], null]) {
      assert.throws(() => parsedFieldToModularField(field({ defaultValue })), /array of strings/)
    }
  })
  it("reports unsupported custom bindings and never substitutes text", () => {
    for (const type of ["Tags", "Custom", "FutureType"] as ParsedFormField["type"][]) {
      const result = mergeRuntimeFormConfig(empty, runtime(field({ type })))
      assert.equal(result.config.sections.length, 0)
      assert.match(result.bindingErrors[0], /custom:regions.*Unsupported runtime field type/)
    }
  })
  it("keeps scalar reducer fields intact and diagnoses runtime arrays", () => {
    const scalar: FormConfig = { ...empty, sections: [{ id: "main", fields: [{
      id: "regions", name: "regions", type: "select", options: [], defaultValue: "north",
    }] }] }
    const result = mergeRuntimeFormConfig(scalar, runtime(field({ fieldId: "regions", defaultValue: ["south"] })))
    assert.deepEqual(result.config.sections[0].fields[0], scalar.sections[0].fields[0])
    assert.match(result.bindingErrors[0], /incompatible cardinality/)
  })
  it("keeps a static picker over legacy text metadata that carries no default", () => {
    const staticConfig: FormConfig = { ...empty, sections: [{ id: "main", fields: [{
      id: "taxIds", name: "taxIds", type: "multiselect", options: [{ value: "1", label: "VAT 20%" }],
    }] }] }
    for (const type of ["Text", "Textarea"] as ParsedFormField["type"][]) {
      const result = mergeRuntimeFormConfig(staticConfig, runtime(field({
        fieldId: "taxIds", name: "taxIds", type, label: "Tax IDs", options: [], validation: { required: false },
      })))
      assert.deepEqual(result.bindingErrors, [])
      const merged = result.config.sections[0].fields[0]
      assert.equal(merged.type, "multiselect")
      assert.equal(merged.label, "Tax IDs")
      assert.equal(merged.defaultValue, undefined)
    }
    const withDefault = mergeRuntimeFormConfig(staticConfig, runtime(field({
      fieldId: "taxIds", name: "taxIds", type: "Text", defaultValue: "1,2", options: [],
    })))
    assert.match(withDefault.bindingErrors[0], /incompatible cardinality/)
  })
  it("retains a declared static renderer when runtime metadata requests Custom", () => {
    const staticConfig: FormConfig = { ...empty, sections: [{ id: "main", fields: [{ id: "regions", name: "regions", type: "text" }] }] }
    const result = mergeRuntimeFormConfig(staticConfig, runtime(field({ fieldId: "regions", type: "Custom", label: "Updated label" })))
    assert.equal(result.config.sections[0].fields[0].type, "text")
    assert.equal(result.config.sections[0].fields[0].label, "Updated label")
    assert.deepEqual(result.bindingErrors, [])
  })
  it("rejects an array default on a runtime scalar before it reaches a reducer", () => {
    const scalar: FormConfig = { ...empty, sections: [{ id: "main", fields: [{ id: "regions", name: "regions", type: "text" }] }] }
    const result = mergeRuntimeFormConfig(scalar, runtime(field({ fieldId: "regions", type: "Text", defaultValue: ["north"] })))
    assert.equal(result.config.sections[0].fields[0].defaultValue, undefined)
    assert.equal(result.bindingErrors.length, 1)
  })
  it("preserves arrays through metadata serialization and rehydration", () => {
    const result = mergeRuntimeFormConfig(empty, runtime(field({ defaultValue: ["north", "south"] })))
    const configured = result.config.sections[0].fields[0]
    const serialized = metadataFromCustomFields({ [configured.name]: configured.defaultValue }, result.customFieldIds)
    assert.deepEqual(defaultValuesFromMetadata(serialized, result.customFieldIds), { "custom:regions": ["north", "south"] })
    assert.deepEqual(result.bindingErrors, [])
  })
  it("retains conditional visibility on array fields", () => {
    const visibleWhen = { field: "status", equals: "open" }
    assert.deepEqual(parsedFieldToModularField(field({ visibleWhen })).visibleWhen, visibleWhen)
  })
  it("does not offer array fields to the scalar-only AI schema", () => {
    const result = mergeRuntimeFormConfig(empty, runtime(field()))
    assert.deepEqual(serializeAiFormSchema(result.config), [])
  })

  it("applies live organization users to a matched UserSelect field", () => {
    const staticConfig: FormConfig = {
      id: "assign-owner",
      title: "Assign owner",
      sections: [{
        id: "main",
        fields: [{
          id: "owner_id",
          name: "owner_id",
          label: "Owner",
          type: "select",
          options: [],
        }],
      }],
    }
    const userField = field({
      fieldId: "owner_id",
      name: "owner_id",
      label: "Owner",
      type: "UserSelect",
      options: [{ value: "abc123", label: "Ada Lovelace" }],
      isSystem: true,
    })

    const merged = mergeRuntimeFormConfig(staticConfig, {
      config: {},
      fields: [userField],
      sourceFields: [userField],
      customFields: [],
    } as MergedFormConfiguration)

    assert.deepEqual(merged.config.sections[0]?.fields[0]?.options, [
      { value: "abc123", label: "Ada Lovelace", disabled: undefined },
    ])
  })

  it("preserves canonical customer options for the sales order partner field", () => {
    const customerField = salesForms
      .find((entry) => entry.formId === "new-sale-order")
      ?.defaultConfig()
      .fields.find((candidate) => candidate.fieldId === "customer")
    assert.equal(customerField?.fieldType, "Select")

    const staticConfig: FormConfig = {
      id: "new-sale-order",
      title: "New sale order",
      sections: [{
        id: "main",
        fields: [{
          id: "partnerId",
          name: "partnerId",
          label: "Customer",
          type: "select",
          options: [{ value: "344", label: "Acme Corporation" }],
        }],
      }],
    }
    const runtimeCustomer = field({
      fieldId: "customer",
      name: "customer",
      label: "Customer",
      type: customerField?.fieldType ?? "Select",
      options: [],
      isSystem: true,
    })

    const merged = mergeRuntimeFormConfig(staticConfig, runtime(runtimeCustomer))

    assert.deepEqual(merged.config.sections[0]?.fields[0]?.options, [
      { value: "344", label: "Acme Corporation" },
    ])
  })
})
