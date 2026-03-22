//! Unified Form Configuration Types
//!
//! These types match the SpacetimeDB schema and provide a unified interface
//! for configurable forms across all modules.

// ═════════════════════════════════════════════════════════════════════════════
// ENUMS
// ═════════════════════════════════════════════════════════════════════════════

export type FieldType = 
  | "Text"
  | "Email"
  | "Password"
  | "Tel"
  | "Url"
  | "Textarea"
  | "Number"
  | "Select"
  | "MultiSelect"
  | "Checkbox"
  | "Switch"
  | "Radio"
  | "Date"
  | "Time"
  | "DateTime"
  | "File"
  | "Hidden"
  | "Rating"
  | "Slider"
  | "Tags"
  | "UserSelect"
  | "Custom"

export type FieldWidth = "Full" | "Half" | "Third" | "TwoThirds" | "Quarter"

// ═════════════════════════════════════════════════════════════════════════════
// BASE TYPES
// ═════════════════════════════════════════════════════════════════════════════

export interface FieldOption {
  value: string
  label: string
  color?: string
  icon?: string
}

export interface FieldValidation {
  required: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: string
  message?: string
}

// ═════════════════════════════════════════════════════════════════════════════
// TABLE TYPES (from SpacetimeDB)
// ═════════════════════════════════════════════════════════════════════════════

export interface FormConfig {
  id: number
  organizationId: number
  moduleId: string
  formId: string
  name: string
  description: string
  isActive: boolean
  isSystemDefault: boolean
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
}

export interface FormConfigField {
  id: number
  configurationId: number
  fieldId: string
  name: string
  label: string
  fieldType: FieldType
  description: string
  placeholder: string
  defaultValue: string
  optionsJson: string // Serialized FieldOption[]
  validationJson: string // Serialized FieldValidation
  aiSuggestionsJson: string // Serialized string[]
  order: number
  isSystem: boolean
  isEnabled: boolean
  category: string
  showInList: boolean
  width: FieldWidth
  sectionId: string
  createdAt: string
  updatedAt: string
}

export interface FormRoleConfig {
  id: number
  configurationId: number
  roleId: string
  enabledFieldsJson: string // Serialized string[]
  requiredFieldsJson: string // Serialized string[]
  defaultPromptsJson: string // Serialized string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface UserCustomField {
  id: number
  organizationId: number
  userId: string
  configurationId: number
  fieldId: string
  fieldDataJson: string // Serialized field definition
  createdAt: string
  updatedAt: string
}

// ═════════════════════════════════════════════════════════════════════════════
// CLIENT-SIDE DERIVED TYPES
// ═════════════════════════════════════════════════════════════════════════════

export interface ParsedFormField {
  id: number
  fieldId: string
  name: string
  label: string
  type: FieldType
  description?: string
  placeholder?: string
  defaultValue?: unknown
  options: FieldOption[]
  validation: FieldValidation
  aiSuggestions: string[]
  order: number
  isSystem: boolean
  isEnabled: boolean
  category?: string
  showInList: boolean
  width: FieldWidth
  sectionId?: string
}

export interface ParsedRoleConfig {
  enabledFields: string[]
  requiredFields: string[]
  defaultPrompts: string[]
}

export interface MergedFormConfiguration {
  config: FormConfig
  fields: ParsedFormField[]
  roleConfig?: ParsedRoleConfig
  customFields: ParsedFormField[]
}

// ═════════════════════════════════════════════════════════════════════════════
// FORM REGISTRY TYPES
// ═════════════════════════════════════════════════════════════════════════════

export interface FormRegistryEntry {
  moduleId: string
  formId: string
  name: string
  description: string
  icon: string
  category: string
  defaultConfig: () => DefaultFormConfiguration
}

export interface DefaultFormConfiguration {
  moduleId: string
  formId: string
  name: string
  description: string
  isSystemDefault: boolean
  fields: CreateFormFieldParams[]
  roleConfigs?: Record<string, CreateRoleConfigParams>
}

// ═════════════════════════════════════════════════════════════════════════════
// PARAMETER TYPES (for reducers)
// ═════════════════════════════════════════════════════════════════════════════

export interface CreateFormConfigParams {
  moduleId: string
  formId: string
  name: string
  description?: string
  isSystemDefault: boolean
}

export interface CreateFormFieldParams {
  fieldId: string
  name: string
  label: string
  fieldType: FieldType
  description?: string
  placeholder?: string
  defaultValue?: string
  options?: FieldOption[]
  validation?: FieldValidation
  aiSuggestions?: string[]
  order: number
  isSystem: boolean
  isEnabled: boolean
  category?: string
  showInList: boolean
  width: FieldWidth
  sectionId?: string
}

export interface UpdateFormFieldParams {
  label?: string
  description?: string
  placeholder?: string
  defaultValue?: string
  options?: FieldOption[]
  validation?: FieldValidation
  aiSuggestions?: string[]
  order?: number
  isEnabled?: boolean
  showInList?: boolean
  width?: FieldWidth
}

export interface CreateRoleConfigParams {
  roleId: string
  enabledFields: string[]
  requiredFields: string[]
  defaultPrompts: string[]
}

export interface CreateUserCustomFieldParams {
  configurationId: number
  fieldId: string
  name: string
  label: string
  fieldType: FieldType
  description?: string
  placeholder?: string
  defaultValue?: string
  options: FieldOption[]
  validation: FieldValidation
  order: number
  width: FieldWidth
}

// ═════════════════════════════════════════════════════════════════════════════
// MODULE METADATA
// ═════════════════════════════════════════════════════════════════════════════

export interface FormModuleMetadata {
  id: string
  name: string
  description: string
  icon: string
  color: string
  forms: FormRegistryEntry[]
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

export function parseFormField(dbField: FormConfigField): ParsedFormField {
  return {
    id: dbField.id,
    fieldId: dbField.fieldId,
    name: dbField.name,
    label: dbField.label,
    type: dbField.fieldType,
    description: dbField.description || undefined,
    placeholder: dbField.placeholder || undefined,
    defaultValue: dbField.defaultValue ? JSON.parse(dbField.defaultValue) : undefined,
    options: dbField.optionsJson ? JSON.parse(dbField.optionsJson) : [],
    validation: dbField.validationJson ? JSON.parse(dbField.validationJson) : { required: false },
    aiSuggestions: dbField.aiSuggestionsJson ? JSON.parse(dbField.aiSuggestionsJson) : [],
    order: dbField.order,
    isSystem: dbField.isSystem,
    isEnabled: dbField.isEnabled,
    category: dbField.category || undefined,
    showInList: dbField.showInList,
    width: dbField.width,
    sectionId: dbField.sectionId || undefined,
  }
}

export function parseRoleConfig(dbConfig: FormRoleConfig): ParsedRoleConfig {
  return {
    enabledFields: dbConfig.enabledFieldsJson ? JSON.parse(dbConfig.enabledFieldsJson) : [],
    requiredFields: dbConfig.requiredFieldsJson ? JSON.parse(dbConfig.requiredFieldsJson) : [],
    defaultPrompts: dbConfig.defaultPromptsJson ? JSON.parse(dbConfig.defaultPromptsJson) : [],
  }
}

export function getFieldsForRole(
  allFields: ParsedFormField[],
  roleConfig?: ParsedRoleConfig
): ParsedFormField[] {
  if (!roleConfig) {
    // If no role config, return all enabled system fields
    return allFields.filter(f => f.isEnabled && f.isSystem)
  }

  return allFields
    .filter(f => f.isEnabled && roleConfig.enabledFields.includes(f.fieldId))
    .map(f => ({
      ...f,
      validation: {
        ...f.validation,
        required: roleConfig.requiredFields.includes(f.fieldId) || f.validation.required,
      },
    }))
    .sort((a, b) => a.order - b.order)
}

export function mergeWithCustomFields(
  baseFields: ParsedFormField[],
  customFields: ParsedFormField[]
): ParsedFormField[] {
  return [...baseFields, ...customFields].sort((a, b) => a.order - b.order)
}

export function isCustomField(fieldId: string): boolean {
  return fieldId.startsWith("custom:")
}

export function generateCustomFieldId(key: string): string {
  return `custom:${key}`
}

export function serializeFieldForDb(field: Partial<CreateFormFieldParams>): {
  optionsJson: string
  validationJson: string
  aiSuggestionsJson: string
} {
  return {
    optionsJson: JSON.stringify(field.options || []),
    validationJson: JSON.stringify(field.validation || { required: false }),
    aiSuggestionsJson: JSON.stringify(field.aiSuggestions || []),
  }
}
