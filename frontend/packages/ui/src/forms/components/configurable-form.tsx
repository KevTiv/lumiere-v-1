"use client"

import * as React from "react"
import { useTranslation } from "@lumiere/i18n"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { FormFieldRenderer } from "./form-field-renderer"
import type { ParsedFormField, MergedFormConfiguration } from "../config/types"
import { isCustomField } from "../config/types"
import { Loader2 } from "lucide-react"

// ═════════════════════════════════════════════════════════════════════════════
// CONFIGURABLE FORM COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

interface ConfigurableFormProps {
  config: MergedFormConfiguration | null
  isLoading?: boolean
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
  defaultValues?: Record<string, unknown>
  submitLabel?: string
  cancelLabel?: string
  disabled?: boolean
  className?: string
  layout?: "vertical" | "horizontal" | "sections"
  showDescription?: boolean
}

export function ConfigurableForm({
  config,
  isLoading = false,
  onSubmit,
  onCancel,
  defaultValues = {},
  submitLabel,
  cancelLabel,
  disabled = false,
  className,
  layout = "vertical",
  showDescription = true,
}: ConfigurableFormProps) {
  const { t } = useTranslation()
  const resolvedSubmitLabel = submitLabel ?? t("common.submit")
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel")
  // Build Zod schema from field validation rules
  const formSchema = React.useMemo(() => {
    if (!config) return z.object({})

    const schemaFields: Record<string, z.ZodType<unknown>> = {}

    config.fields.forEach((field) => {
      let fieldSchema: z.ZodType<unknown>

      switch (field.type) {
        case "Text":
        case "Email":
        case "Password":
        case "Tel":
        case "Url":
        case "Textarea":
          fieldSchema = z.string()
          if (field.validation?.minLength) {
            fieldSchema = (fieldSchema as z.ZodString).min(
              field.validation.minLength,
              t("common.validation.minLength", { min: field.validation.minLength })
            )
          }
          if (field.validation?.maxLength) {
            fieldSchema = (fieldSchema as z.ZodString).max(
              field.validation.maxLength,
              t("common.validation.maxLength", { max: field.validation.maxLength })
            )
          }
          if (field.type === "Email") {
            fieldSchema = (fieldSchema as z.ZodString).email(t("common.validation.invalidEmail"))
          }
          break

        case "Number":
          fieldSchema = z.number().or(z.string().transform((v) => (v === "" ? undefined : Number(v))))
          if (field.validation?.min !== undefined) {
            fieldSchema = (fieldSchema as z.ZodNumber).min(field.validation.min)
          }
          if (field.validation?.max !== undefined) {
            fieldSchema = (fieldSchema as z.ZodNumber).max(field.validation.max)
          }
          break

        case "Checkbox":
        case "Switch":
          fieldSchema = z.boolean()
          break

        case "Select":
        case "Radio":
          fieldSchema = z.string()
          break

        case "MultiSelect":
        case "Tags":
          fieldSchema = z.array(z.string())
          break

        case "Date":
        case "DateTime":
          fieldSchema = z.string()
          break

        case "Rating":
        case "Slider":
          fieldSchema = z.number()
          break

        case "File":
          fieldSchema = z.any()
          break

        default:
          fieldSchema = z.any()
      }

      // Make optional if not required
      if (!field.validation?.required) {
        fieldSchema = fieldSchema.optional()
      } else {
        if (fieldSchema instanceof z.ZodString) {
          fieldSchema = fieldSchema.min(1, t("common.validation.required"))
        } else if (fieldSchema instanceof z.ZodNumber) {
          fieldSchema = fieldSchema.refine((v) => v !== undefined, t("common.validation.required"))
        }
      }

      schemaFields[field.fieldId] = fieldSchema
    })

    return z.object(schemaFields)
  }, [config, t])

  // Initialize form with react-hook-form
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: buildDefaultValues(config?.fields || [], defaultValues),
  })

  // Reset form when config or defaultValues change
  React.useEffect(() => {
    if (config) {
      form.reset(buildDefaultValues(config.fields, defaultValues))
    }
  }, [config, defaultValues, form])

  // Group fields by section if using sections layout
  const groupedFields = React.useMemo(() => {
    if (!config) return {}

    if (layout !== "sections") {
      return { default: config.fields }
    }

    const groups: Record<string, ParsedFormField[]> = {}
    config.fields.forEach((field) => {
      const sectionId = field.sectionId || "default"
      if (!groups[sectionId]) {
        groups[sectionId] = []
      }
      groups[sectionId].push(field)
    })
    return groups
  }, [config, layout])

  const handleSubmit = async (data: Record<string, unknown>) => {
    // Separate custom fields
    const standardData: Record<string, unknown> = {}
    const customData: Record<string, unknown> = {}

    Object.entries(data).forEach(([key, value]) => {
      if (isCustomField(key)) {
        customData[key] = value
      } else {
        standardData[key] = value
      }
    })

    // Merge with metadata key for custom fields
    const finalData = {
      ...standardData,
      ...(Object.keys(customData).length > 0 ? { metadata: customData } : {}),
    }

    await onSubmit(finalData)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        {t("common.noData")}
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className={cn("space-y-6", className)}>
        {showDescription && config.config.description && (
          <p className="text-sm text-muted-foreground">{config.config.description}</p>
        )}

        {layout === "sections" ? (
          // Sections layout
          Object.entries(groupedFields).map(([sectionId, fields]) => (
            <Card key={sectionId}>
              <CardHeader>
                <CardTitle className="text-base capitalize">{sectionId.replace(/-/g, " ")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormFieldsGrid fields={fields} form={form} disabled={disabled} />
              </CardContent>
            </Card>
          ))
        ) : (
          // Vertical or horizontal layout
          <FormFieldsGrid
            fields={config.fields}
            form={form}
            disabled={disabled}
            layout={layout}
          />
        )}

        {/* Form Actions */}
        <div className="flex justify-end gap-4 pt-4">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={disabled}>
              {resolvedCancelLabel}
            </Button>
          )}
          <Button type="submit" disabled={disabled || form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {resolvedSubmitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// FORM FIELDS GRID
// ═════════════════════════════════════════════════════════════════════════════

interface FormFieldsGridProps {
  fields: ParsedFormField[]
  form: ReturnType<typeof useForm>
  disabled?: boolean
  layout?: "vertical" | "horizontal"
}

const FormFieldsGrid = React.memo(function FormFieldsGrid({ 
  fields, 
  form, 
  disabled, 
  layout = "vertical" 
}: FormFieldsGridProps) {
  const getWidthClass = React.useCallback((width: string): string => {
    switch (width) {
      case "Full":
        return "col-span-12"
      case "Half":
        return "col-span-12 md:col-span-6"
      case "Third":
        return "col-span-12 md:col-span-4"
      case "TwoThirds":
        return "col-span-12 md:col-span-8"
      case "Quarter":
        return "col-span-12 md:col-span-3"
      default:
        return "col-span-12"
    }
  }, [])

  return (
    <div className="grid grid-cols-12 gap-4">
      {fields.map((field) => (
        <div key={field.fieldId} className={getWidthClass(field.width)}>
          <FormField
            control={form.control}
            name={field.fieldId}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel>
                  {field.label}
                  {field.validation?.required && <span className="text-red-500 ml-1">*</span>}
                </FormLabel>
                <FormControl>
                  <FormFieldRenderer
                    field={field}
                    value={formField.value}
                    onChange={formField.onChange}
                    onBlur={formField.onBlur}
                    error={form.formState.errors[field.fieldId]?.message as string}
                    disabled={disabled}
                  />
                </FormControl>
                {field.description && <FormDescription>{field.description}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      ))}
    </div>
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function buildDefaultValues(
  fields: ParsedFormField[],
  providedValues: Record<string, unknown>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}

  fields.forEach((field) => {
    // Use provided value if available
    if (providedValues[field.fieldId] !== undefined) {
      defaults[field.fieldId] = providedValues[field.fieldId]
      return
    }

    // Otherwise use field default or type-specific default
    if (field.defaultValue !== undefined) {
      defaults[field.fieldId] = field.defaultValue
      return
    }

    // Type-specific defaults
    switch (field.type) {
      case "Checkbox":
      case "Switch":
        defaults[field.fieldId] = false
        break
      case "MultiSelect":
      case "Tags":
        defaults[field.fieldId] = []
        break
      case "Number":
      case "Rating":
      case "Slider":
        defaults[field.fieldId] = field.validation?.min || 0
        break
      default:
        defaults[field.fieldId] = ""
    }
  })

  return defaults
}
