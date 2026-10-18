"use client"

import type { CustomField } from "@lumiere/ui"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"

type PickerOption = { value: string; label: string }
type PickerField = CustomField & { options?: PickerOption[] }

/** Checkbox list for the form dialog; the form value is the array of selected option values. */
function TaxPicker({
  field,
  value,
  onChange,
  error,
}: {
  field: CustomField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
}) {
  const options = (field as PickerField).options ?? []
  const selected = new Set(Array.isArray(value) ? value.map(String) : [])
  return (
    <ScrollArea className="max-h-56 rounded-md border" data-testid={`form-field-${field.name}`}>
      <div className="flex flex-col gap-2 p-3">
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={selected.has(option.value)}
              aria-invalid={Boolean(error)}
              onCheckedChange={(next) => {
                const nextValues = new Set(selected)
                if (next) nextValues.add(option.value)
                else nextValues.delete(option.value)
                onChange([...nextValues])
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </ScrollArea>
  )
}

/** A multi-select form field of the given options, preselecting `defaultValue`. */
export function taxPickerField(spec: {
  id: string
  name: string
  label: string
  options: PickerOption[]
  defaultValue: string[]
  emptyHint: string
}): CustomField {
  return {
    id: spec.id,
    name: spec.name,
    type: "custom",
    label: spec.label,
    description: spec.options.length === 0 ? spec.emptyHint : undefined,
    defaultValue: spec.defaultValue,
    component: TaxPicker,
    options: spec.options,
  } as PickerField
}
