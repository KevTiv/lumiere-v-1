import type { FormConfig, FormField } from "../lib/form-types"

export type CustomFieldCreateIssueReason = "unsupportedType" | "conditionalVisibility" | "validationPattern" | "unavailableChoices" | "ambiguousDefinition"

export const customFieldCreateReasonMessages: Record<CustomFieldCreateIssueReason, string> = {
  unsupportedType: "unsupported field type",
  conditionalVisibility: "conditional visibility is not supported during creation",
  validationPattern: "this validation pattern is not supported during creation",
  unavailableChoices: "no stored selectable options are available",
  ambiguousDefinition: "more than one field definition uses this key",
}

interface CustomFieldCreateDefinition {
  type: string
  visibleWhen?: unknown
  validation?: { required?: boolean; pattern?: string }
  options?: ReadonlyArray<{ value: string; disabled?: boolean }>
}

export interface CustomFieldCreateIssue {
  fieldId: string
  label: string
  reason: CustomFieldCreateIssueReason
}

const supportedTypes = new Set(["Text", "Email", "Tel", "Url", "Textarea", "Number", "Rating", "Slider", "Select", "Radio", "MultiSelect", "UserSelect", "Tags", "Checkbox", "Switch", "Date", "Time", "DateTime"])

/** Mirrors the bounded native configurable-create owner; native validation remains authoritative. */
export function configuredCustomFieldCreateIssue(field: CustomFieldCreateDefinition): CustomFieldCreateIssueReason | undefined {
  if (!supportedTypes.has(field.type)) return "unsupportedType"
  if (field.visibleWhen) return "conditionalVisibility"
  if (field.validation?.pattern && field.validation.pattern !== "email") return "validationPattern"
  if ((field.type === "UserSelect" || field.validation?.required)
    && ["Select", "Radio", "MultiSelect", "UserSelect"].includes(field.type)
    && !field.options?.some((option) => !option.disabled)) return "unavailableChoices"
  return undefined
}

interface NamedDefinition extends CustomFieldCreateDefinition {
  fieldId: string
  label: string
  isEnabled?: boolean
}

/** Use stored definitions before runtime UserSelect hydration changes their options. */
export function configuredCustomFieldCreateIssues(fields: readonly NamedDefinition[]): CustomFieldCreateIssue[] {
  const issues: CustomFieldCreateIssue[] = []
  const seen = new Set<string>()
  for (const field of fields) {
    if (field.isEnabled === false || !field.fieldId.startsWith("custom:")) continue
    const reason = seen.has(field.fieldId) ? "ambiguousDefinition" : configuredCustomFieldCreateIssue(field)
    seen.add(field.fieldId)
    if (reason) issues.push({ fieldId: field.fieldId, label: field.label || field.fieldId, reason })
  }
  return issues
}

export function runtimeCustomFieldCreateIssues(runtime: {
  fields: readonly NamedDefinition[]
  sourceFields?: readonly NamedDefinition[]
  customFields?: readonly NamedDefinition[]
} | null): CustomFieldCreateIssue[] {
  if (!runtime) return []
  const rawDefinitions = [...(runtime.sourceFields ?? []), ...(runtime.customFields ?? [])]
  const admitted = new Set(runtime.fields.filter((field) => field.isEnabled !== false && field.fieldId.startsWith("custom:")).map((field) => field.fieldId))
  const definitions = rawDefinitions.filter((field) => admitted.has(field.fieldId)
    || (field.isEnabled !== false && field.fieldId.startsWith("custom:") && field.validation?.required))
  return configuredCustomFieldCreateIssues(definitions.length ? definitions : runtime.fields)
}

const modularTypes: Partial<Record<FormField["type"], string>> = {
  text: "Text", email: "Email", tel: "Tel", url: "Url", textarea: "Textarea",
  number: "Number", money: "Number", percent: "Number", quantity: "Number",
  select: "Select", radio: "Radio", multiselect: "MultiSelect", checkbox: "Checkbox", switch: "Switch",
  date: "Date", time: "Time", datetime: "DateTime",
}

/** Also inspect the final fields, so a caller transform cannot introduce an unsupported create field. */
export function resolvedCustomFieldCreateIssues(config: FormConfig): CustomFieldCreateIssue[] {
  return configuredCustomFieldCreateIssues(config.sections.flatMap((section) => section.fields)
    .filter((field) => field.name.startsWith("custom:") || field.id.startsWith("custom:"))
    .map((field) => ({
      fieldId: field.name.startsWith("custom:") ? field.name : field.id,
      label: field.label || field.name,
      type: modularTypes[field.type] ?? "Custom",
      visibleWhen: field.visibleWhen,
      validation: { ...field.validation, required: field.required },
      options: "options" in field ? field.options : undefined,
    })))
}
