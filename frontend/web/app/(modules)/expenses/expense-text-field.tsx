"use client"

import { useId, type ComponentProps } from "react"
import { Field, FieldLabel } from "@lumiere/ui/components/field"
import { Input } from "@lumiere/ui/components/input"

/** Match the labelled record pickers used beside specialist expense fields. */
export function ExpenseTextField({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  return (
    <Field className="min-w-0" data-disabled={props.disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input autoComplete="off" {...props} id={id} />
    </Field>
  )
}
