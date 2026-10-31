import type { ComponentType, HTMLAttributes } from "react"

export type FieldWidth = "full" | "1/2" | "1/3" | "2/3" | "1/4"

export type FieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "money"
  | "percent"
  | "quantity"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "multiselect"
  | "checkbox"
  | "switch"
  | "radio"
  | "date"
  | "time"
  | "datetime"
  | "file"
  | "hidden"
  | "custom"

export interface BaseField {
  id: string
  name: string
  label?: string
  placeholder?: string
  description?: string
  required?: boolean
  disabled?: boolean
  autoComplete?: string
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"]
  width?: FieldWidth
  className?: string
  defaultValue?: unknown
  /** Show a field for one value or a fixed set of values (string comparison). */
  visibleWhen?: { field: string; equals: string } | { field: string; oneOf: readonly string[] }
  validation?: {
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    custom?: (value: unknown) => string | null
  }
}

export interface TextField extends BaseField {
  type: "text" | "email" | "password" | "tel" | "url"
  defaultValue?: string
}

export interface NumberField extends BaseField {
  type: "number"
  defaultValue?: number
  step?: number
  min?: number
  max?: number
}

/** An amount stored as a plain number in major units (e.g. 1234.5), shown with grouping. */
export interface MoneyField extends BaseField {
  type: "money"
  defaultValue?: number
  /** ISO 4217 code shown beside the amount. */
  currency?: string
  /** Fraction digits always shown (default 2). Extra typed digits are kept, not rounded away. */
  decimals?: number
}

/** A percentage stored as 0–100 (not a 0–1 fraction). Bounds default to 0–100. */
export interface PercentField extends BaseField {
  type: "percent"
  defaultValue?: number
  decimals?: number
}

/** A non-negative amount of something, optionally with a unit of measure. */
export interface QuantityField extends BaseField {
  type: "quantity"
  defaultValue?: number
  unit?: string
  decimals?: number
}

export type NumericField = MoneyField | PercentField | QuantityField

export function isNumericField(field: FormField): field is NumericField {
  return field.type === "money" || field.type === "percent" || field.type === "quantity"
}

/** Effective min/max for a numeric field: `validation` wins over the type's default range. */
export function numericFieldBounds(field: NumericField): { min?: number; max?: number } {
  const min = field.validation?.min ?? (field.type === "money" ? undefined : 0)
  const max = field.validation?.max ?? (field.type === "percent" ? 100 : undefined)
  return { min, max }
}

export interface TextareaField extends BaseField {
  type: "textarea"
  defaultValue?: string
  rows?: number
  /**
   * `markdown` (default) edits with the rich text editor. `plain` keeps a bare
   * textarea for raw HTML, code or ID lists that must not be reformatted.
   */
  format?: "markdown" | "plain"
}

/** Field names whose values are machine-read (IDs, CSV, JSON, HTML, templates). */
const RAW_TEXT_FIELD_NAME = /(Ids|Json|Csv|Data|Domain|Html|Values|Prompt|Template|Expression|Sql)$|^metadata$/

/** Whether a textarea field should use the bare textarea instead of the rich text editor. */
export function isPlainTextareaField(field: Pick<TextareaField, "name" | "format">): boolean {
  if (field.format) return field.format === "plain"
  return RAW_TEXT_FIELD_NAME.test(field.name)
}

export interface SelectField extends BaseField {
  type: "select"
  defaultValue?: string
  /** Type to narrow the options: for a list of linked records too long to scroll. */
  searchable?: boolean
  options: ReadonlyArray<{
    value: string
    label: string
    disabled?: boolean
  }>
}

export interface MultiSelectField extends BaseField {
  type: "multiselect"
  defaultValue?: string[]
  options: SelectField["options"]
}

export interface CheckboxField extends BaseField {
  type: "checkbox"
  defaultValue?: boolean
}

export interface SwitchField extends BaseField {
  type: "switch"
  defaultValue?: boolean
}

export interface RadioField extends BaseField {
  type: "radio"
  defaultValue?: string
  options: Array<{
    value: string
    label: string
    disabled?: boolean
  }>
  layout?: "horizontal" | "vertical"
}

export interface DateField extends BaseField {
  type: "date" | "time" | "datetime"
  defaultValue?: string
  /** Earliest allowed value in the field's string format (`YYYY-MM-DD` for dates). */
  minDate?: string
  /** Latest allowed value in the field's string format (`YYYY-MM-DD` for dates). */
  maxDate?: string
}

export interface FileField extends BaseField {
  type: "file"
  accept?: string
  multiple?: boolean
}

export interface HiddenField extends BaseField {
  type: "hidden"
  defaultValue?: string
}

export interface CustomField extends BaseField {
  type: "custom"
  component: ComponentType<{
    field: CustomField
    /** Current form values for dependent record choices. */
    values?: FormValues
    value: unknown
    onChange: (value: unknown) => void
    error?: string
  }>
}

export type FormField =
  | TextField
  | NumberField
  | MoneyField
  | PercentField
  | QuantityField
  | TextareaField
  | SelectField
  | MultiSelectField
  | CheckboxField
  | SwitchField
  | RadioField
  | DateField
  | FileField
  | HiddenField
  | CustomField

export interface FormSection {
  id: string
  /** Optional details stay mounted so collapsing never discards entered values. */
  collapsible?: boolean
  title?: string
  description?: string
  icon?: string
  fields: FormField[]
  columns?: 1 | 2 | 3
}

export interface FormConfig {
  id: string
  title: string
  description?: string
  /** When true, default layout omits the top title row (use inside another card). */
  hideTitle?: boolean
  /** An explicit create-owner limit: configured custom fields cannot be committed atomically. */
  customFieldCreateUnavailableMessage?: string
  /** The native owner atomically validates the admitted configured field subset during creation. */
  customFieldCreateCapability?: "atomic-configured-v1"
  /** When false, omits the footer (submit / cancel / reset). Default true. */
  showActions?: boolean
  sections: FormSection[]
  submitLabel?: string
  cancelLabel?: string
  layout?: "default" | "compact" | "card"
  size?: "md" | "lg" | "xl"
  icon?: string
  iconColor?: string
  showReset?: boolean
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
}

/** Values at the existing dynamic form submission boundary, also used by local previews. */
export type FormValues = Parameters<NonNullable<FormConfig["onSubmit"]>>[0]

export type FormPreviewRenderer = (values: FormValues) => import("react").ReactNode

export interface AiFormAssistConfig {
  enabled?: boolean
  companyId?: number
  formId?: string
  entityType?: string
  initialPrompt?: string
}

export const fieldWidthClasses: Record<FieldWidth, string> = {
  full: "col-span-12",
  "2/3": "col-span-12 md:col-span-8",
  "1/2": "col-span-12 md:col-span-6",
  "1/3": "col-span-12 md:col-span-4",
  "1/4": "col-span-12 md:col-span-3",
}
