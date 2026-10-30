"use client"

import { Checkbox } from "@lumiere/ui/components/checkbox"
import { Label } from "@lumiere/ui/components/label"

/** A labelable root keeps the visible checkbox and its full text one control. */
export function SetupConfirmation({ checked, onCheckedChange, label }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}) {
  return <div className="flex items-start gap-2">
    <Checkbox
      id="confirm-setup"
      nativeButton
      render={<button type="button" />}
      aria-labelledby="confirm-setup-label"
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
    />
    <Label id="confirm-setup-label" htmlFor="confirm-setup" className="text-sm leading-5">{label}</Label>
  </div>
}
