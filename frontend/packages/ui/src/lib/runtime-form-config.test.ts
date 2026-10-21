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
