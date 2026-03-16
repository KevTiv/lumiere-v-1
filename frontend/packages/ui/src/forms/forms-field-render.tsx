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

const inputBase =
  "bg-background border-input focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-150"

interface FormFieldRendererProps {
  field: FormField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
}

export function FormFieldRenderer({
  field,
  value,
  onChange,
  error,
}: FormFieldRendererProps) {
  const width = field.width || "full"

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
            type={field.type}
            placeholder={field.placeholder}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            required={field.required}
            className={cn(inputBase, error && "border-destructive focus-visible:ring-destructive/20")}
          />
        )

      case "number":
        return (
          <Input
            id={field.id}
            name={field.name}
            type="number"
            placeholder={field.placeholder}
            value={(value as number) ?? ""}
            onChange={(e) => onChange(e.target.valueAsNumber || "")}
            disabled={field.disabled}
            required={field.required}
            step={field.step}
            min={field.validation?.min}
            max={field.validation?.max}
            className={cn(inputBase, error && "border-destructive focus-visible:ring-destructive/20")}
          />
        )

      case "textarea":
        return (
          <Textarea
            id={field.id}
            name={field.name}
            placeholder={field.placeholder}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            required={field.required}
            rows={field.rows || 3}
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
            value={(value as string) || ""}
            onValueChange={onChange}
            disabled={field.disabled}
          >
            <SelectTrigger
              className={cn(
                "w-full",
                inputBase,
                error && "border-destructive focus-visible:ring-destructive/20"
              )}
            >
              <SelectValue placeholder={field.placeholder || "Select..."} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
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
              checked={(value as boolean) || false}
              onCheckedChange={onChange}
              disabled={field.disabled}
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
          <div className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg border border-border/50 px-4 py-3">
            {field.label && (
              <Label
                htmlFor={field.id}
                className="text-sm text-foreground cursor-pointer"
              >
                {field.label}
              </Label>
            )}
            <Switch
              id={field.id}
              checked={(value as boolean) || false}
              onCheckedChange={onChange}
              disabled={field.disabled}
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
                  aria-checked={selected}
                  disabled={field.disabled || option.disabled}
                  onClick={() => onChange(option.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
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
            type={field.type === "datetime" ? "datetime-local" : field.type}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            required={field.required}
            className={cn(inputBase, error && "border-destructive focus-visible:ring-destructive/20")}
          />
        )

      case "file":
        return (
          <Input
            id={field.id}
            name={field.name}
            type="file"
            accept={field.accept}
            multiple={field.multiple}
            onChange={(e) => onChange(e.target.files)}
            disabled={field.disabled}
            required={field.required}
            className={cn(
              inputBase,
              "file:bg-primary file:text-primary-foreground file:border-0 file:rounded-md file:px-3 file:py-1 file:mr-3",
              error && "border-destructive"
            )}
          />
        )

      case "hidden":
        return (
          <input type="hidden" name={field.name} value={(value as string) || ""} />
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
    <div className={cn(fieldWidthClasses[width] ?? "col-span-12", "space-y-1.5", field.className)}>
      {showLabel && field.label && (
        <Label
          htmlFor={field.id}
          className="text-sm font-medium text-foreground"
        >
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      {renderField()}
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <span className="inline-block w-1 h-1 rounded-full bg-destructive flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
