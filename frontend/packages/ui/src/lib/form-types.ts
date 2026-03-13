import type { ComponentType } from "react"

export type FieldWidth = "full" | "1/2" | "1/3" | "2/3" | "1/4"

export type FieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "textarea"
  | "select"
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
  width?: FieldWidth
  className?: string
  defaultValue?: unknown
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
}

export interface TextareaField extends BaseField {
  type: "textarea"
  defaultValue?: string
  rows?: number
}

export interface SelectField extends BaseField {
  type: "select"
  defaultValue?: string
  options: Array<{
    value: string
    label: string
    disabled?: boolean
  }>
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
    value: unknown
    onChange: (value: unknown) => void
    error?: string
  }>
}

export type FormField =
  | TextField
  | NumberField
  | TextareaField
  | SelectField
  | CheckboxField
  | SwitchField
  | RadioField
  | DateField
  | FileField
  | HiddenField
  | CustomField

export interface FormSection {
  id: string
  title?: string
  description?: string
  fields: FormField[]
  columns?: 1 | 2 | 3
}

export interface FormConfig {
  id: string
  title: string
  description?: string
  sections: FormSection[]
  submitLabel?: string
  cancelLabel?: string
  layout?: "default" | "compact" | "card"
  showReset?: boolean
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
}

export const fieldWidthClasses: Record<FieldWidth, string> = {
  full: "col-span-12",
  "2/3": "col-span-12 md:col-span-8",
  "1/2": "col-span-12 md:col-span-6",
  "1/3": "col-span-12 md:col-span-4",
  "1/4": "col-span-12 md:col-span-3",
}
