import type {
  ParsedFormField,
  FormConfigField,
  FormRoleConfig,
  ParsedRoleConfig,
} from "./types"

import {
  parseFormField,
  parseRoleConfig,
  getFieldsForRole,
  mergeWithCustomFields,
  isCustomField,
  generateCustomFieldId,
} from "./types"

describe("Form Configuration Types", () => {
  describe("parseFormField", () => {
    const mockDbField: FormConfigField = {
      id: 1,
      configurationId: 1,
      fieldId: "test_field",
      name: "test_field",
      label: "Test Field",
      fieldType: "Text",
      description: "A test field",
      placeholder: "Enter value",
      defaultValue: "",
      optionsJson: JSON.stringify([
        { value: "opt1", label: "Option 1" },
        { value: "opt2", label: "Option 2" },
      ]),
      validationJson: JSON.stringify({ required: true, minLength: 3 }),
      aiSuggestionsJson: JSON.stringify(["suggestion1", "suggestion2"]),
      order: 1,
      isSystem: true,
      isEnabled: true,
      category: "general",
      showInList: false,
      width: "Full",
      sectionId: "section1",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    }

    it("should parse a FormConfigField correctly", () => {
      const parsed = parseFormField(mockDbField)

      expect(parsed.id).toBe(1)
      expect(parsed.fieldId).toBe("test_field")
      expect(parsed.label).toBe("Test Field")
      expect(parsed.type).toBe("Text")
      expect(parsed.description).toBe("A test field")
      expect(parsed.placeholder).toBe("Enter value")
      expect(parsed.order).toBe(1)
      expect(parsed.isSystem).toBe(true)
      expect(parsed.isEnabled).toBe(true)
    })

    it("should parse options correctly", () => {
      const parsed = parseFormField(mockDbField)

      expect(parsed.options).toHaveLength(2)
      expect(parsed.options[0]).toEqual({
        value: "opt1",
        label: "Option 1",
      })
    })

    it("should parse validation correctly", () => {
      const parsed = parseFormField(mockDbField)

      expect(parsed.validation).toEqual({
        required: true,
        minLength: 3,
      })
    })

    it("should parse ai suggestions correctly", () => {
      const parsed = parseFormField(mockDbField)

      expect(parsed.aiSuggestions).toEqual([
        "suggestion1",
        "suggestion2",
      ])
    })

    it("should handle empty JSON strings", () => {
      const emptyField = { ...mockDbField, optionsJson: "", validationJson: "", aiSuggestionsJson: "" }
      const parsed = parseFormField(emptyField)

      expect(parsed.options).toEqual([])
      expect(parsed.validation).toEqual({ required: false })
      expect(parsed.aiSuggestions).toEqual([])
    })
  })

  describe("parseRoleConfig", () => {
    const mockRoleConfig: FormRoleConfig = {
      id: 1,
      configurationId: 1,
      roleId: "role-admin",
      enabledFieldsJson: JSON.stringify(["field1", "field2"]),
      requiredFieldsJson: JSON.stringify(["field1"]),
      defaultPromptsJson: JSON.stringify(["prompt1", "prompt2"]),
      isActive: true,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    }

    it("should parse role config correctly", () => {
      const parsed = parseRoleConfig(mockRoleConfig)

      expect(parsed.enabledFields).toEqual(["field1", "field2"])
      expect(parsed.requiredFields).toEqual(["field1"])
      expect(parsed.defaultPrompts).toEqual(["prompt1", "prompt2"])
    })

    it("should handle empty JSON strings", () => {
      const emptyConfig = {
        ...mockRoleConfig,
        enabledFieldsJson: "",
        requiredFieldsJson: "",
        defaultPromptsJson: "",
      }
      const parsed = parseRoleConfig(emptyConfig)

      expect(parsed.enabledFields).toEqual([])
      expect(parsed.requiredFields).toEqual([])
      expect(parsed.defaultPrompts).toEqual([])
    })
  })

  describe("getFieldsForRole", () => {
    const mockFields: ParsedFormField[] = [
      {
        id: 1,
        fieldId: "field1",
        name: "field1",
        label: "Field 1",
        type: "Text",
        options: [],
        validation: { required: false },
        aiSuggestions: [],
        order: 1,
        isSystem: true,
        isEnabled: true,
        showInList: false,
        width: "Full",
      },
      {
        id: 2,
        fieldId: "field2",
        name: "field2",
        label: "Field 2",
        type: "Text",
        options: [],
        validation: { required: false },
        aiSuggestions: [],
        order: 2,
        isSystem: true,
        isEnabled: true,
        showInList: false,
        width: "Full",
      },
      {
        id: 3,
        fieldId: "field3",
        name: "field3",
        label: "Field 3",
        type: "Text",
        options: [],
        validation: { required: true },
        aiSuggestions: [],
        order: 3,
        isSystem: false,
        isEnabled: false,
        showInList: false,
        width: "Full",
      },
    ]

    it("should return only enabled system fields when no role config", () => {
      const result = getFieldsForRole(mockFields)
      
      expect(result).toHaveLength(2)
      expect(result.every(f => f.isEnabled)).toBe(true)
    })

    it("should filter by enabled fields from role config", () => {
      const roleConfig: ParsedRoleConfig = {
        enabledFields: ["field1", "field3"],
        requiredFields: [],
        defaultPrompts: [],
      }
      
      const result = getFieldsForRole(mockFields, roleConfig)
      
      expect(result).toHaveLength(1)
      expect(result[0].fieldId).toBe("field1")
    })

    it("should mark required fields from role config", () => {
      const roleConfig: ParsedRoleConfig = {
        enabledFields: ["field1", "field2"],
        requiredFields: ["field2"],
        defaultPrompts: [],
      }
      
      const result = getFieldsForRole(mockFields, roleConfig)
      const field2 = result.find(f => f.fieldId === "field2")
      
      expect(field2?.validation.required).toBe(true)
    })

    it("should sort fields by order", () => {
      const roleConfig: ParsedRoleConfig = {
        enabledFields: ["field2", "field1"],
        requiredFields: [],
        defaultPrompts: [],
      }
      
      const result = getFieldsForRole(mockFields, roleConfig)
      
      expect(result[0].fieldId).toBe("field1")
      expect(result[1].fieldId).toBe("field2")
    })
  })

  describe("mergeWithCustomFields", () => {
    const baseFields: ParsedFormField[] = [
      {
        id: 1,
        fieldId: "base_field",
        name: "base_field",
        label: "Base Field",
        type: "Text",
        options: [],
        validation: { required: false },
        aiSuggestions: [],
        order: 1,
        isSystem: true,
        isEnabled: true,
        showInList: false,
        width: "Full",
      },
    ]

    const customFields: ParsedFormField[] = [
      {
        id: 2,
        fieldId: "custom:my_field",
        name: "custom:my_field",
        label: "My Custom Field",
        type: "Text",
        options: [],
        validation: { required: false },
        aiSuggestions: [],
        order: 2,
        isSystem: false,
        isEnabled: true,
        showInList: false,
        width: "Full",
      },
    ]

    it("should merge and sort by order", () => {
      const result = mergeWithCustomFields(baseFields, customFields)
      
      expect(result).toHaveLength(2)
      expect(result[0].fieldId).toBe("base_field")
      expect(result[1].fieldId).toBe("custom:my_field")
    })

    it("should handle empty custom fields", () => {
      const result = mergeWithCustomFields(baseFields, [])
      
      expect(result).toEqual(baseFields)
    })

    it("should handle empty base fields", () => {
      const result = mergeWithCustomFields([], customFields)
      
      expect(result).toEqual(customFields)
    })
  })

  describe("isCustomField", () => {
    it("should return true for custom fields", () => {
      expect(isCustomField("custom:my_field")).toBe(true)
      expect(isCustomField("custom:deals_touched")).toBe(true)
    })

    it("should return false for regular fields", () => {
      expect(isCustomField("field1")).toBe(false)
      expect(isCustomField("title")).toBe(false)
      expect(isCustomField("")).toBe(false)
    })
  })

  describe("generateCustomFieldId", () => {
    it("should generate custom field IDs with prefix", () => {
      expect(generateCustomFieldId("my_field")).toBe("custom:my_field")
      expect(generateCustomFieldId("deals_touched")).toBe("custom:deals_touched")
    })
  })
})
