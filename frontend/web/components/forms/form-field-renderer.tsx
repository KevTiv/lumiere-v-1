"use client"

import { cn } from "@/lib/utils"
import type { FormField, fieldWidthClasses } from "@/lib/form-types"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const widthClasses: Record<string, string> = {
  full: "col-span-12",
  "2/3": "col-span-12 md:col-span-8",
  "1/2": "col-span-12 md:col-span-6",
  "1/3": "col-span-12 md:col-span-4",
}

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
            className={cn(
              "bg-secondary/50 border-border/50 focus:border-primary",
              error && "border-destructive"
            )}
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
            className={cn(
              "bg-secondary/50 border-border/50 focus:border-primary",
              error && "border-destructive"
            )}
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
              "bg-secondary/50 border-border/50 focus:border-primary resize-none",
              error && "border-destructive"
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
                "w-full bg-secondary/50 border-border/50 focus:border-primary",
                error && "border-destructive"
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
          <div className="flex items-center justify-between gap-3 pt-2">
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
              "flex gap-4 pt-2",
              field.layout === "vertical" ? "flex-col" : "flex-row flex-wrap"
            )}
          >
            {field.options.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name={field.name}
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => onChange(option.value)}
                  disabled={field.disabled || option.disabled}
                  className="w-4 h-4 text-primary bg-secondary/50 border-border focus:ring-primary"
                />
                <span className="text-sm text-foreground">{option.label}</span>
              </label>
            ))}
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
            className={cn(
              "bg-secondary/50 border-border/50 focus:border-primary",
              error && "border-destructive"
            )}
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
              "bg-secondary/50 border-border/50 focus:border-primary file:bg-primary file:text-primary-foreground file:border-0 file:rounded-md file:px-3 file:py-1 file:mr-3",
              error && "border-destructive"
            )}
          />
        )

      case "hidden":
        return (
          <input type="hidden" name={field.name} value={(value as string) || ""} />
        )

      case "custom":
        const CustomComponent = field.component
        return (
          <CustomComponent
            field={field}
            value={value}
            onChange={onChange}
            error={error}
          />
        )

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
    <div className={cn(widthClasses[width], "space-y-2", field.className)}>
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
