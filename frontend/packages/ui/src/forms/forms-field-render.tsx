"use client"

import { cn } from "../lib/utils"
import type { FormField } from "../lib/form-types"
import { fieldWidthClasses } from "../lib/form-types"
import { Input } from "../components/input"
import { Textarea } from "../components/textarea"
import { Checkbox } from "../components/checkbox"
import { Switch } from "../components/switch"
import { Label } from "../components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import {
  radixSelectControlledValue,
  radixSelectItemValue,
  storedValueFromRadixSelect,
} from "./utils/radix-select-empty-value"

const inputBase =
  "bg-background border-input focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring transition-[border-color,box-shadow,background-color] duration-150"

function autoCompleteForField(field: FormField): string | undefined {
  if (field.autoComplete) return field.autoComplete
  if (field.type === "email") return "email"
  if (field.type === "tel") return "tel"
  if (field.type === "url") return "url"
  if (field.type === "password") return "off"
  return undefined
}

function inputModeForField(field: FormField): FormField["inputMode"] {
  if (field.inputMode) return field.inputMode
  if (field.type === "tel") return "tel"
  if (field.type === "url") return "url"
  if (field.type === "number") return "decimal"
  return undefined
}

interface FormFieldRendererProps {
  field: FormField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  aiSuggestion?: {
    confidence: number
    note?: string
  }
}

export function FormFieldRenderer({
  field,
  value,
  onChange,
  error,
  aiSuggestion,
}: FormFieldRendererProps) {
  const width = field.width || "full"
  const descriptionId = field.description ? `${field.id}-description` : undefined
  const errorId = error ? `${field.id}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined

  const renderField = () => {
    switch (field.type) {
      case "text":
      case "email":
      case "password":
      case "tel":
      case "url":
        return (
          <Input
            id={field.id}
            name={field.name}
            data-testid={`form-field-${field.name}`}
            type={field.type}
            placeholder={field.placeholder}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            required={field.required}
            autoComplete={autoCompleteForField(field)}
            inputMode={inputModeForField(field)}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(inputBase, error && "border-destructive focus-visible:ring-destructive/20")}
          />
        )

      case "number":
        return (
          <Input
            id={field.id}
            name={field.name}
            data-testid={`form-field-${field.name}`}
            type="number"
            placeholder={field.placeholder}
            value={(value as number) ?? ""}
            onChange={(e) => {
              const next = e.target.valueAsNumber
              onChange(Number.isNaN(next) ? "" : next)
            }}
            disabled={field.disabled}
            required={field.required}
            step={field.step}
            min={field.validation?.min}
            max={field.validation?.max}
            inputMode={inputModeForField(field)}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(inputBase, error && "border-destructive focus-visible:ring-destructive/20")}
          />
        )

      case "textarea":
        return (
          <Textarea
            id={field.id}
            name={field.name}
            data-testid={`form-field-${field.name}`}
            placeholder={field.placeholder}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            required={field.required}
            rows={field.rows || 3}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(
              inputBase,
              "min-h-[80px] resize-none",
              error && "border-destructive focus-visible:ring-destructive/20"
            )}
          />
        )

      case "select":
        return (
          <Select
            value={radixSelectControlledValue(value as string | undefined, field.options)}
            onValueChange={(v) => onChange(storedValueFromRadixSelect(v))}
            disabled={field.disabled}
          >
            <SelectTrigger
              data-testid={`form-field-${field.name}`}
              className={cn(
                "w-full",
                inputBase,
                error && "border-destructive focus-visible:ring-destructive/20"
              )}
              aria-invalid={!!error}
              aria-describedby={describedBy}
            >
              <SelectValue placeholder={field.placeholder || "Select..."} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option, idx) => (
                <SelectItem
                  key={`${radixSelectItemValue(option, idx)}-${idx}`}
                  value={radixSelectItemValue(option, idx)}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case "checkbox":
        return (
          <div className="flex items-center gap-3 pt-2">
            <Checkbox
              id={field.id}
              data-testid={`form-field-${field.name}`}
              checked={(value as boolean) || false}
              onCheckedChange={onChange}
              disabled={field.disabled}
              aria-invalid={!!error}
              aria-describedby={describedBy}
            />
            {field.label && (
              <Label
                htmlFor={field.id}
                className="text-sm text-muted-foreground cursor-pointer"
              >
                {field.label}
              </Label>
            )}
          </div>
        )

      case "switch":
        return (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs">
            <div className="min-w-0">
              {field.label && (
                <Label
                  htmlFor={field.id}
                  className="cursor-pointer text-sm font-medium text-foreground"
                >
                  {field.label}
                </Label>
              )}
              {field.description ? (
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{field.description}</p>
              ) : null}
            </div>
            <Switch
              id={field.id}
              data-testid={`form-field-${field.name}`}
              checked={(value as boolean) || false}
              onCheckedChange={onChange}
              disabled={field.disabled}
              aria-invalid={!!error}
              aria-describedby={describedBy}
            />
          </div>
        )

      case "radio":
        return (
          <div
            className={cn(
              "flex gap-2 pt-1",
              field.layout === "vertical" ? "flex-col" : "flex-row flex-wrap"
            )}
          >
            {field.options.map((option) => {
              const selected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  data-testid={`form-field-${field.name}-${option.value}`}
                  aria-checked={selected}
                  disabled={field.disabled || option.disabled}
                  onClick={() => onChange(option.value)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-foreground border-input hover:bg-muted/50",
                    (field.disabled || option.disabled) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )

      case "date":
      case "time":
      case "datetime":
        return (
          <Input
            id={field.id}
            name={field.name}
            data-testid={`form-field-${field.name}`}
            type={field.type === "datetime" ? "datetime-local" : field.type}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            required={field.required}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(inputBase, error && "border-destructive focus-visible:ring-destructive/20")}
          />
        )

      case "file":
        return (
          <Input
            id={field.id}
            name={field.name}
            data-testid={`form-field-${field.name}`}
            type="file"
            accept={field.accept}
            multiple={field.multiple}
            onChange={(e) => onChange(e.target.files)}
            disabled={field.disabled}
            required={field.required}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(
              inputBase,
              "file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1 file:text-foreground",
              error && "border-destructive"
            )}
          />
        )

      case "hidden":
        return (
          <input data-testid={`form-field-${field.name}`} type="hidden" name={field.name} value={(value as string) || ""} />
        )

      case "custom": {
        const CustomComponent = field.component
        return (
          <CustomComponent
            field={field}
            value={value}
            onChange={onChange}
            error={error}
          />
        )
      }

      default:
        return null
    }
  }

  // Don't render wrapper for hidden fields
  if (field.type === "hidden") {
    return renderField()
  }

  // Checkbox and switch handle their own labels
  const showLabel = field.type !== "checkbox" && field.type !== "switch"

  return (
    <div
      className={cn(
        fieldWidthClasses[width] ?? "col-span-12",
        "space-y-1.5 rounded-md",
        aiSuggestion && "border border-info/30 bg-info/5 p-2",
        field.className,
      )}
    >
      {showLabel && field.label && (
        <Label
          htmlFor={field.id}
          className="text-sm font-medium text-foreground"
        >
          {field.label}
          {field.required && <span className="ml-1 text-muted-foreground" aria-label="required">*</span>}
        </Label>
      )}
      {renderField()}
      {field.description && field.type !== "switch" && (
        <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">{field.description}</p>
      )}
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-xs leading-5 text-destructive" role="alert">
          <span className="inline-block h-1 w-1 flex-shrink-0 rounded-full bg-destructive" />
          {error}
        </p>
      )}
      {aiSuggestion ? (
        <p className="text-xs leading-5 text-info">
          AI suggestion applied ({Math.round(aiSuggestion.confidence * 100)}% confidence)
          {aiSuggestion.note ? `: ${aiSuggestion.note}` : ""}
        </p>
      ) : null}
    </div>
  )
}
