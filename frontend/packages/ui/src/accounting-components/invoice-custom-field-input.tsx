"use client"

import { useId } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { radixSelectControlledValue, radixSelectItemValue, storedValueFromRadixSelect } from "../forms/utils/radix-select-empty-value"
import { invoiceCustomFieldSupported, type InvoiceCustomField, type InvoiceCustomValue } from "./invoice-custom-fields"

interface InvoiceCustomFieldInputProps {
  field: InvoiceCustomField
  value: InvoiceCustomValue | undefined
  onChange: (value: InvoiceCustomValue) => void
}

export function InvoiceCustomFieldInput({ field, value, onChange }: InvoiceCustomFieldInputProps) {
  const id = useId()
  const { t } = useTranslation()
  const testId = `create-invoice-custom-${field.fieldId}`
  const label = `${field.label}${field.validation.required ? " *" : ""}`
  const disabled = !invoiceCustomFieldSupported(field)

  if (["Select", "Radio", "UserSelect"].includes(field.type)) {
    return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>
      <Select disabled={disabled} value={radixSelectControlledValue(typeof value === "string" ? value : undefined, field.options)} onValueChange={(next) => onChange(storedValueFromRadixSelect(next))}>
        <SelectTrigger id={id} data-testid={testId}><SelectValue placeholder={t("common.select", { defaultValue: "Select" })} /></SelectTrigger>
        <SelectContent>{field.options.map((option, index) => <SelectItem key={`${option.value}-${index}`} value={radixSelectItemValue(option, index)} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  }

  if (field.type === "MultiSelect") {
    const selected = Array.isArray(value) ? value : []
    return <fieldset disabled={disabled} className="space-y-2"><legend className="text-sm font-medium">{label}</legend>
      {field.options.map((option, index) => <div key={`${option.value}-${index}`} className="flex items-center gap-2">
        <Checkbox id={`${id}-${index}`} disabled={option.disabled} checked={selected.includes(option.value)} onCheckedChange={(checked) => onChange(checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))} />
        <Label htmlFor={`${id}-${index}`}>{option.label}</Label>
      </div>)}
    </fieldset>
  }

  if (["Checkbox", "Switch"].includes(field.type)) {
    return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>
      <Select disabled={disabled} value={typeof value === "boolean" ? String(value) : ""} onValueChange={(next) => onChange(next === "true")}>
        <SelectTrigger id={id} data-testid={testId}><SelectValue placeholder={t("common.select", { defaultValue: "Select" })} /></SelectTrigger>
        <SelectContent><SelectItem value="true">{t("common.yes", { defaultValue: "Yes" })}</SelectItem><SelectItem value="false">{t("common.no", { defaultValue: "No" })}</SelectItem></SelectContent>
      </Select>
    </div>
  }

  if (field.type === "Textarea" || field.type === "Tags") {
    return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>
      <Textarea variant="plain" id={id} data-testid={testId} disabled={disabled} value={Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />
      {field.type === "Tags" ? <p className="text-xs text-muted-foreground">{t("accounting.authoring.oneTagPerLine", { defaultValue: "Enter one tag per line." })}</p> : null}
    </div>
  }

  const numeric = ["Number", "Rating", "Slider"].includes(field.type)
  const type = numeric ? "number" : field.type === "DateTime" ? "datetime-local" : ["Email", "Tel", "Url", "Date", "Time"].includes(field.type) ? field.type.toLowerCase() : "text"
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>
    <Input id={id} data-testid={testId} disabled={disabled} type={type} step="any" min={field.validation.min} max={field.validation.max} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => onChange(numeric && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />
  </div>
}
