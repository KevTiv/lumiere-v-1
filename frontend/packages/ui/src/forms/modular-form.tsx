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
  /** Renders at the start of the footer row (e.g. destructive actions beside Cancel / Submit). */
  leadingActions?: React.ReactNode
  /** Called after any field change with the full values object (e.g. sync a parent select). */
  onValuesChange?: (values: Record<string, unknown>) => void
}

export function ModularForm({
  config,
  onSubmit,
  onCancel,
  className,
  leadingActions,
  onValuesChange,
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
            case "file":
              values[field.name] = undefined
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
    setValues((prev) => {
      const next = { ...prev, [name]: value }
      onValuesChange?.(next)
      return next
    })
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
    if (field.required) {
      if (field.type === "file") {
        const fl = value as FileList | null | undefined
        if (!fl || fl.length === 0) return t("common.validation.required")
      } else if (value === "" || value === null || value === undefined) {
        return t("common.validation.required")
      }
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

      {config.showActions !== false ? (
        <div
          className={cn(
            "flex items-center gap-3 bg-muted/20 rounded-b-lg px-4 py-3 -mx-1 mt-6 border-t border-border/50",
            leadingActions ? "justify-between" : "justify-end",
          )}
        >
          {leadingActions ? <div className="flex items-center gap-2">{leadingActions}</div> : null}
          <div className="flex items-center gap-3">
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
        </div>
      ) : null}
    </form>
  )

  if (config.layout === "card") {
    return (
      <Card className={cn("bg-card border-border/50", className)}>
        {!config.hideTitle && (config.title || config.description) ? (
          <CardHeader>
            {config.title ? <CardTitle>{config.title}</CardTitle> : null}
            {config.description ? <CardDescription>{config.description}</CardDescription> : null}
          </CardHeader>
        ) : null}
        <CardContent>{formContent}</CardContent>
      </Card>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      {!config.hideTitle && (config.title || config.description) ? (
        <div className="space-y-1">
          {config.title ? (
            <h2 className="text-xl font-semibold text-foreground">{config.title}</h2>
          ) : null}
          {config.description ? (
            <p className="text-sm text-muted-foreground">{config.description}</p>
          ) : null}
        </div>
      ) : null}
      {formContent}
    </div>
  )
}
