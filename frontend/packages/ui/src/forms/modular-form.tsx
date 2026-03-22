"use client"


import React, { useState, useCallback } from "react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "../lib/utils"
import type { FormConfig, FormField } from "../lib/form-types"
import { FormFieldRenderer } from "./forms-field-render"
import { Button } from "../components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Separator } from "../components/separator"
import { Check, Loader2 } from "lucide-react"
import * as Icons from "lucide-react"

interface ModularFormProps {
  config: FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
  className?: string
}

export function ModularForm({
  config,
  onSubmit,
  onCancel,
  className,
}: ModularFormProps) {
  const { t } = useTranslation()
  // Initialize form state with default values
  const getInitialValues = useCallback(() => {
    const values: Record<string, unknown> = {}
    config.sections.forEach((section) => {
      section.fields.forEach((field) => {
        if (field.defaultValue !== undefined) {
          values[field.name] = field.defaultValue
        } else {
          // Set default empty values based on type
          switch (field.type) {
            case "checkbox":
            case "switch":
              values[field.name] = false
              break
            case "number":
              values[field.name] = ""
              break
            default:
              values[field.name] = ""
          }
        }
      })
    })
    return values
  }, [config])

  const [values, setValues] = useState<Record<string, unknown>>(getInitialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    // Clear error when field is modified
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  const validateField = (field: FormField, value: unknown): string | null => {
    if (field.required && (value === "" || value === null || value === undefined)) {
      return t("common.validation.required")
    }

    if (field.validation) {
      const v = field.validation

      if (typeof value === "string") {
        if (v.minLength && value.length < v.minLength) {
          return t("common.validation.minLength", { min: v.minLength })
        }
        if (v.maxLength && value.length > v.maxLength) {
          return t("common.validation.maxLength", { max: v.maxLength })
        }
        if (v.pattern && !new RegExp(v.pattern).test(value)) {
          return t("common.validation.invalidFormat")
        }
      }

      if (typeof value === "number") {
        if (v.min !== undefined && value < v.min) {
          return t("common.validation.min", { min: v.min })
        }
        if (v.max !== undefined && value > v.max) {
          return t("common.validation.max", { max: v.max })
        }
      }

      if (v.custom) {
        const customError = v.custom(value)
        if (customError) return customError
      }
    }

    return null
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    config.sections.forEach((section) => {
      section.fields.forEach((field) => {
        const error = validateField(field, values[field.name])
        if (error) {
          newErrors[field.name] = error
        }
      })
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsSubmitting(true)
    try {
      const submitHandler = onSubmit || config.onSubmit
      if (submitHandler) {
        await submitHandler(values)
      }
    } catch (error) {
      console.error("Form submission error:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setValues(getInitialValues())
    setErrors({})
  }

  const handleCancel = () => {
    const cancelHandler = onCancel || config.onCancel
    if (cancelHandler) {
      cancelHandler()
    }
  }

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-6">
      {config.sections.map((section, idx) => {
        // Resolve optional section icon
        const SectionIcon = section.icon
          ? (Icons as Record<string, unknown>)[section.icon] as React.ComponentType<{ className?: string }> | undefined
          : undefined

        return (
          <div key={section.id}>
            {idx > 0 && <Separator className="mb-6" />}
            <div className="space-y-4">
              {(section.title || section.description) && (
                <div className="flex items-start gap-3 bg-muted/40 rounded-lg px-4 py-3 mb-4">
                  {SectionIcon && (
                    <SectionIcon className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="space-y-0.5">
                    {section.title && (
                      <h3 className="text-sm font-semibold text-foreground">
                        {section.title}
                      </h3>
                    )}
                    {section.description && (
                      <p className="text-xs text-muted-foreground">
                        {section.description}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-12 gap-4">
                {section.fields.map((field) => (
                  <FormFieldRenderer
                    key={field.id}
                    field={field}
                    value={values[field.name]}
                    onChange={(value) => handleChange(field.name, value)}
                    error={errors[field.name]}
                  />
                ))}
              </div>
            </div>
          </div>
        )
      })}

      <div className="flex items-center justify-end gap-3 bg-muted/20 rounded-b-lg px-4 py-3 -mx-1 mt-6 border-t border-border/50">
        {config.showReset && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isSubmitting}
          >
            {t("common.reset")}
          </Button>
        )}
        {(onCancel || config.onCancel) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {config.cancelLabel || t("common.cancel")}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <Check className="mr-2 h-4 w-4" />
          }
          {config.submitLabel || t("common.submit")}
        </Button>
      </div>
    </form>
  )

  if (config.layout === "card") {
    return (
      <Card className={cn("bg-card border-border/50", className)}>
        <CardHeader>
          <CardTitle>{config.title}</CardTitle>
          {config.description && (
            <CardDescription>{config.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>{formContent}</CardContent>
      </Card>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-foreground">{config.title}</h2>
        {config.description && (
          <p className="text-sm text-muted-foreground">{config.description}</p>
        )}
      </div>
      {formContent}
    </div>
  )
}
