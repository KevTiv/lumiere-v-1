"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "../lib/utils"
import { Input } from "./input"

export interface EditableNumberProps {
  /** The saved value. */
  value: number
  /** Save a changed, valid value. A rejection puts the saved value back. */
  onCommit: (value: number) => Promise<void> | void
  /** Reports the value being typed (null once it matches the saved one or is not a number). */
  onDraft?: (value: number | null) => void
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  "aria-label": string
  "data-testid"?: string
  className?: string
}

function format(value: number): string {
  return Number.isFinite(value) ? String(value) : ""
}

/**
 * A number shown in place and edited in place: type, then Enter or leave the field to save,
 * Escape to go back. A value that is not a number, or is out of range, is flagged and never saved.
 */
export function EditableNumber({
  value,
  onCommit,
  onDraft,
  disabled,
  min,
  max,
  step,
  "aria-label": ariaLabel,
  "data-testid": testId,
  className,
}: EditableNumberProps) {
  const [text, setText] = useState(format(value))
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const settled = useRef(value)
  // Escape reverts and then blurs; that blur must not save what was just thrown away.
  const cancelled = useRef(false)

  // A change from outside (a refresh, another edit) replaces what is shown unless the user is typing.
  useEffect(() => {
    settled.current = value
    if (!focused && !saving) setText(format(value))
  }, [value, focused, saving])

  const parsed = text.trim() === "" ? Number.NaN : Number(text)
  const invalid =
    Number.isNaN(parsed) || (min != null && parsed < min) || (max != null && parsed > max)

  const revert = () => {
    setText(format(settled.current))
    onDraft?.(null)
  }

  const commit = async () => {
    if (invalid || parsed === settled.current) {
      revert()
      return
    }
    setSaving(true)
    try {
      await onCommit(parsed)
      onDraft?.(null)
    } catch {
      revert()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Input
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      disabled={disabled || saving}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-busy={saving || undefined}
      data-testid={testId}
      className={cn("h-8 w-24 text-right tabular-nums", className)}
      onFocus={() => setFocused(true)}
      onChange={(event) => {
        setText(event.target.value)
        const next = event.target.value.trim() === "" ? Number.NaN : Number(event.target.value)
        const bad = Number.isNaN(next) || (min != null && next < min) || (max != null && next > max)
        onDraft?.(bad || next === settled.current ? null : next)
      }}
      onBlur={() => {
        setFocused(false)
        if (cancelled.current) {
          cancelled.current = false
          return
        }
        void commit()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === "Escape") {
          event.preventDefault()
          cancelled.current = true
          revert()
          event.currentTarget.blur()
        }
      }}
    />
  )
}
