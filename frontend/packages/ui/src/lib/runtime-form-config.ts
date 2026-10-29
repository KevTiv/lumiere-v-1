import { i18n as uiI18n } from "@lumiere/i18n"
import type { FormConfig, FormField, FormSection, FieldWidth } from "./form-types"
import type { MergedFormConfiguration, ParsedFormField, FieldType as StdbFieldType } from "../forms/config/types"
import { isCustomField } from "../forms/config/types"

/** Normalize field keys for cross-config matching (camelCase ↔ snake_case). */
export function normalizeFormFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

const STATIC_FIELD_ALIASES: Record<string, readonly string[]> = {
  contactname: ["firstname", "first_name", "name"],
  emailfrom: ["email"],
  activitytypeid: ["activitytype", "activity_type", "activity_type_id"],
  partnername: ["company", "companyname", "company_name"],
  partnerid: ["customer", "partner_id", "partner"],
  expectedrevenue: ["expected_revenue", "revenue"],
  datedeadline: ["date_deadline", "deadline"],
  clientorderref: ["client_order_ref", "order_number", "ordernumber"],
  validitydate: ["validity_date", "delivery_date", "deliverydate"],
}

function stdbFieldKeys(field: ParsedFormField): string[] {
  return [field.fieldId, field.name].map(normalizeFormFieldKey)
}

function staticFieldKeys(field: { id: string; name: string }): string[] {
  const base = [field.id, field.name].map(normalizeFormFieldKey)
  const aliases = STATIC_FIELD_ALIASES[field.name] ?? STATIC_FIELD_ALIASES[normalizeFormFieldKey(field.name)] ?? []
  return [...base, ...aliases.map(normalizeFormFieldKey)]
}

function findMatchingStdbField(
  staticField: { id: string; name: string },
  stdbFields: ParsedFormField[],
): ParsedFormField | undefined {
  const keys = new Set(staticFieldKeys(staticField))
  return stdbFields.find((f) => stdbFieldKeys(f).some((k) => keys.has(k)))
}

function stdbWidthToModular(width: ParsedFormField["width"]): FieldWidth | undefined {
  switch (width) {
    case "Full":
      return "full"
    case "Half":
      return "1/2"
    case "Third":
      return "1/3"
    case "TwoThirds":
      return "2/3"
    case "Quarter":
      return "1/4"
    default:
      return undefined
  }
}

function stdbTypeToModular(type: StdbFieldType): FormField["type"] {
  switch (type) {
    case "Text":
      return "text"
    case "Email":
      return "email"
    case "Password":
      return "password"
    case "Tel":
      return "tel"
    case "Url":
      return "url"
    case "Textarea":
      return "textarea"
    case "Number":
    case "Rating":
    case "Slider":
      return "number"
    case "Select":
    case "UserSelect":
      return "select"
    case "MultiSelect":
      return "multiselect"
    case "Checkbox":
      return "checkbox"
    case "Switch":
      return "switch"
    case "Radio":
      return "radio"
    case "Date":
      return "date"
    case "Time":
      return "time"
    case "DateTime":
      return "datetime"
    case "File":
      return "file"
    case "Hidden":
      return "hidden"
    default:
      throw new Error(uiI18n.t("common.builtIn.runtimeFormConfig.stdbTypeToModular.error", { defaultValue: "Unsupported runtime field type: {{type}}", type: type }))
  }
}

/** Convert a STDB parsed field into a ModularForm {@link FormField}. */
export function parsedFieldToModularField(field: ParsedFormField): FormField {
  const base = {
    id: field.fieldId,
    name: isCustomField(field.fieldId) ? field.fieldId : field.name || field.fieldId,
    label: field.label,
    placeholder: field.placeholder,
    description: field.description,
    required: field.validation.required,
    width: stdbWidthToModular(field.width),
    defaultValue: field.defaultValue,
    visibleWhen: field.visibleWhen,
    validation: {
      min: field.validation.min,
      max: field.validation.max,
      minLength: field.validation.minLength,
      maxLength: field.validation.maxLength,
      pattern: field.validation.pattern,
    },
  }

  const modularType = stdbTypeToModular(field.type)
  if (modularType === "multiselect") {
    if (field.defaultValue !== undefined &&
        (!Array.isArray(field.defaultValue) || !field.defaultValue.every((value) => typeof value === "string"))) {
      throw new Error(uiI18n.t("common.builtIn.runtimeFormConfig.parsedFieldToModularField.error", { defaultValue: "MultiSelect default must be an array of strings: {{fieldId}}", fieldId: field.fieldId }))
    }
    return {
      ...base,
      type: "multiselect",
      options: field.options.map((option) => ({ ...option })),
      defaultValue: field.defaultValue as string[] | undefined,
    }
  }
  if (modularType === "select" || modularType === "radio") {
    return {
      ...base,
      type: modularType,
      options: field.options.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled })),
      defaultValue: typeof field.defaultValue === "string" ? field.defaultValue : undefined,
    }
  }
  if (modularType === "checkbox" || modularType === "switch") {
    return {
      ...base,
      type: modularType,
      defaultValue: Boolean(field.defaultValue),
    }
  }
  if (modularType === "number") {
    return {
      ...base,
      type: "number",
      defaultValue:
        typeof field.defaultValue === "number"
          ? field.defaultValue
          : field.defaultValue != null && field.defaultValue !== ""
            ? Number(field.defaultValue)
            : undefined,
    }
  }
  return {
    ...base,
    type: modularType,
    defaultValue:
      field.defaultValue != null && field.defaultValue !== ""
        ? String(field.defaultValue)
        : undefined,
  } as FormField
}

function applyStdbOverrides(staticField: FormField, stdbField: ParsedFormField): FormField {
  const overrides = {
    label: stdbField.label || staticField.label,
    placeholder: stdbField.placeholder || staticField.placeholder,
    description: stdbField.description || staticField.description,
    required: stdbField.validation.required || staticField.required,
    width: stdbWidthToModular(stdbField.width) ?? staticField.width,
    visibleWhen: stdbField.visibleWhen ?? staticField.visibleWhen,
  }
  let merged: FormField = { ...staticField, ...overrides }
  if (stdbField.type === "UserSelect" && staticField.type === "select") {
    merged = {
      ...staticField,
      ...overrides,
      type: "select",
      options: stdbField.options.map(option => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
      })),
    }
  }
  if (stdbField.defaultValue !== undefined && staticField.defaultValue === undefined) {
    return { ...merged, defaultValue: stdbField.defaultValue } as FormField
  }
  return merged
}

/**
 * Merge a static module {@link FormConfig} with a STDB {@link MergedFormConfiguration}.
 * Static fields remain the source of reducer field names; STDB drives visibility, labels, and custom fields.
 *
 * `preferStdbVisibility`: when true and the runtime came from a DB row, hide static fields that
 * exist in STDB but are disabled / not in the role-enabled set. Unmatched static fields are kept
 * so reducer contracts survive incomplete registry seeds.
 */
export function mergeRuntimeFormConfig(
  staticConfig: FormConfig,
  runtime: MergedFormConfiguration | null,
  options?: {
    preferStdbVisibility?: boolean
    runtimeFromDatabase?: boolean
  },
): { config: FormConfig; customFieldIds: string[]; bindingErrors: string[] } {
  if (!runtime) {
    return { config: staticConfig, customFieldIds: [], bindingErrors: [] }
  }

  const preferStdb =
    Boolean(options?.preferStdbVisibility) && Boolean(options?.runtimeFromDatabase)
  const sourceFields = runtime.sourceFields?.length ? runtime.sourceFields : runtime.fields

  const bindingErrors: string[] = []
  const matchedStdbIds = new Set<string>()
  const sections: FormSection[] = staticConfig.sections.map((section) => ({
    ...section,
    fields: section.fields
      .map((field) => {
        const inRoleOrEnabled = findMatchingStdbField(field, runtime.fields)
        if (inRoleOrEnabled) {
          matchedStdbIds.add(inRoleOrEnabled.fieldId)
          const runtimeIsArray = inRoleOrEnabled.type === "MultiSelect" || inRoleOrEnabled.type === "Tags"
          const staticIsArray = field.type === "multiselect"
          const defaultIsArray = Array.isArray(inRoleOrEnabled.defaultValue)
          const invalidArrayDefault = staticIsArray && inRoleOrEnabled.defaultValue !== undefined &&
            (!defaultIsArray || !(inRoleOrEnabled.defaultValue as unknown[]).every((item) => typeof item === "string"))
          // Registries seeded before an ID list became a picker still describe it as text. With no
          // runtime default to carry over, the static picker stays authoritative.
          const legacyTextForPicker = staticIsArray && !runtimeIsArray &&
            (inRoleOrEnabled.type === "Text" || inRoleOrEnabled.type === "Textarea") &&
            (inRoleOrEnabled.defaultValue === undefined || inRoleOrEnabled.defaultValue === "")
          if (legacyTextForPicker) return applyStdbOverrides(field, { ...inRoleOrEnabled, defaultValue: undefined })
          if (runtimeIsArray !== staticIsArray || invalidArrayDefault || (!staticIsArray && defaultIsArray)) {
            bindingErrors.push(uiI18n.t("common.runtimeForms.incompatibleCardinality", { defaultValue: "Runtime field {{id}} has incompatible cardinality for {{name}}", id: inRoleOrEnabled.fieldId, name: field.name }))
            return field
          }
          // The static renderer remains authoritative, including Custom runtime metadata.
          return applyStdbOverrides(field, inRoleOrEnabled)
        }
        if (preferStdb && findMatchingStdbField(field, sourceFields)) {
          // Defined in STDB but not enabled for this role / is_enabled=false → hide
          return null
        }
        return field
      })
      .filter((f): f is FormField => f != null),
  }))

  // Only genuinely custom fields (`custom:` prefixed, added via the per-user custom
  // field feature) belong in the "Additional fields" overflow section. System/default
  // fields that failed to match a static field are legacy registry drift (the default
  // form registry's field names have fallen out of sync with the static form configs
  // that actually drive reducer submission) — surfacing them as brand-new *required*
  // inputs blocks every submit, since they can never be filled in via the real form.
  // See CLAUDE.md "Static fields remain the source of reducer field names; STDB drives
  // visibility, labels, and custom fields" — custom fields only, not arbitrary system ones.
  const extraFields = runtime.fields
    .filter((f) => f.isEnabled && !matchedStdbIds.has(f.fieldId) && isCustomField(f.fieldId))
    .sort((a, b) => a.order - b.order)
    .flatMap((field) => {
      try {
        return [parsedFieldToModularField(field)]
      } catch (error) {
        bindingErrors.push(uiI18n.t("common.runtimeForms.invalidField", { defaultValue: "Runtime field {{id}}: {{message}}", id: field.fieldId, message: error instanceof Error ? error.message : uiI18n.t("common.runtimeForms.invalidBinding", { defaultValue: "Invalid field binding" }) }))
        return []
      }
    })

  if (extraFields.length > 0) {
    sections.push({
      id: "runtime-extra-fields",
      get title() { return uiI18n.t("common.builtIn.runtimeFormConfig.mergeRuntimeFormConfig.runtimeExtraFields.title") },
      fields: extraFields,
    })
  }

  return {
    config: { ...staticConfig, sections },
    bindingErrors,
    customFieldIds: runtime.fields.filter((f) => isCustomField(f.fieldId)).map((f) => f.fieldId),
  }
}
