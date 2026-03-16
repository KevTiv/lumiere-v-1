"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import type { FormField } from "@/lib/form-types"
import type { EntryData } from "@/lib/entry-table-types"
import { FormFieldRenderer } from "@/components/forms/forms-field-render"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Pencil, Save, X, ImageIcon } from "lucide-react"

interface EntryDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: EntryData
  fields: FormField[]
  mode: "view" | "edit"
  onModeChange: (mode: "view" | "edit") => void
  onSave?: (data: EntryData) => void
  title?: string
  description?: string
}

export function EntryDetailModal({
  open,
  onOpenChange,
  entry,
  fields,
  mode,
  onModeChange,
  onSave,
  title,
  description,
}: EntryDetailModalProps) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Initialize values when entry changes
  useEffect(() => {
    if (entry) {
      const initialValues: Record<string, unknown> = {}
      fields.forEach((field) => {
        initialValues[field.name] = entry[field.name] ?? field.defaultValue ?? ""
      })
      setValues(initialValues)
      setErrors({})
    }
  }, [entry, fields])

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  const handleSave = () => {
    // Basic validation
    const newErrors: Record<string, string> = {}
    fields.forEach((field) => {
      if (field.required && !values[field.name]) {
        newErrors[field.name] = `${field.label || field.name} is required`
      }
    })

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSave?.({ ...entry, ...values })
  }

  const handleCancel = () => {
    if (mode === "edit") {
      // Reset to original values
      const initialValues: Record<string, unknown> = {}
      fields.forEach((field) => {
        initialValues[field.name] = entry[field.name] ?? field.defaultValue ?? ""
      })
      setValues(initialValues)
      setErrors({})
      onModeChange("view")
    } else {
      onOpenChange(false)
    }
  }

  const renderViewField = (field: FormField) => {
    const value = values[field.name]
    
    // Handle image fields specially
    if (field.type === "file" || field.name.toLowerCase().includes("image") || field.name.toLowerCase().includes("avatar")) {
      const src = String(value || "")
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            {field.label || field.name}
          </label>
          {src ? (
            <div className="relative h-32 w-32 rounded-lg overflow-hidden bg-secondary/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={field.label || "Image"}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="h-32 w-32 rounded-lg bg-secondary/50 flex items-center justify-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>
      )
    }

    // Handle different field types in view mode
    let displayValue: string | React.ReactNode = "-"

    if (value !== null && value !== undefined && value !== "") {
      switch (field.type) {
        case "checkbox":
        case "switch":
          displayValue = value ? "Yes" : "No"
          break
        case "select": {
          const selectField = field as { options?: Array<{ value: string; label: string }> }
          const option = selectField.options?.find((o) => o.value === String(value))
          displayValue = option?.label || String(value)
          break
        }
        case "date":
          displayValue = new Date(String(value)).toLocaleDateString()
          break
        case "datetime":
          displayValue = new Date(String(value)).toLocaleString()
          break
        case "textarea":
          displayValue = (
            <p className="text-foreground whitespace-pre-wrap">{String(value)}</p>
          )
          break
        default:
          displayValue = String(value)
      }
    }

    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          {field.label || field.name}
        </label>
        <div className="text-foreground">
          {displayValue}
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle>{title || (mode === "view" ? "View Entry" : "Edit Entry")}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
            {mode === "view" && onSave && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onModeChange("edit")}
                className="gap-2"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {mode === "view" ? (
            <div className="grid grid-cols-12 gap-4">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className={cn(
                    "col-span-12",
                    field.width === "1/2" && "md:col-span-6",
                    field.width === "1/3" && "md:col-span-4",
                    field.width === "2/3" && "md:col-span-8"
                  )}
                >
                  {renderViewField(field)}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-4">
              {fields.map((field) => (
                <FormFieldRenderer
                  key={field.id}
                  field={field}
                  value={values[field.name]}
                  onChange={(value) => handleChange(field.name, value)}
                  error={errors[field.name]}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4 mr-2" />
            {mode === "edit" ? "Cancel" : "Close"}
          </Button>
          {mode === "edit" && (
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
