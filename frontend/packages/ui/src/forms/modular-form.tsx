"use client"


import React, { useState, useCallback, useEffect, useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useAiFormSuggest } from "@lumiere/query-hooks/hooks/ai-forms"
import { cn } from "../lib/utils"
import type { AiFormAssistConfig, FormConfig, FormField } from "../lib/form-types"
import { serializeAiFormSchema } from "../lib/ai-form-schema"
import { FormFieldRenderer } from "./forms-field-render"
import { Button } from "../components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Separator } from "../components/separator"
import { Textarea } from "../components/textarea"
import { Check, Loader2, Sparkles } from "lucide-react"
import * as Icons from "lucide-react"
import { toast } from "sonner"

interface ModularFormProps {
  config: FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
  className?: string
  /** Renders at the start of the footer row (e.g. destructive actions beside Cancel / Submit). */
  leadingActions?: React.ReactNode
  /** Called after any field change with the full values object (e.g. sync a parent select). */
  onValuesChange?: (values: Record<string, unknown>) => void
  /** External mutation in-flight (e.g. React Query) — disables actions and shows loading on submit. */
  isPending?: boolean
  /** Enables advisory AI suggestions that only update local form state when the user applies them. */
  aiAssist?: AiFormAssistConfig
}

export function ModularForm({
  config,
  onSubmit,
  onCancel,
  className,
  leadingActions,
  onValuesChange,
  isPending,
  aiAssist,
}: ModularFormProps) {
  const { t } = useTranslation()
  const aiSuggest = useAiFormSuggest()
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
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState(aiAssist?.initialPrompt ?? "")
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { value: unknown; confidence: number; note?: string }>>({})
  const [aiAppliedFields, setAiAppliedFields] = useState<Record<string, { confidence: number; note?: string }>>({})
  const [aiValidationNotes, setAiValidationNotes] = useState<string[]>([])
  const busy = isSubmitting || !!isPending
  const aiSchema = useMemo(() => serializeAiFormSchema(config), [config])
  const aiEnabled = aiAssist?.enabled !== false && !!aiAssist?.companyId && !!aiAssist?.entityType

  useEffect(() => {
    if (!aiEnabled) return

    const handleAiFormPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: unknown }>).detail
      if (typeof detail?.text !== "string" || !detail.text.trim()) return
      setAiPrompt(detail.text)
      setAiPanelOpen(true)
    }

    window.addEventListener("lumiere:ai-form-fill-prompt", handleAiFormPrompt)
    return () => window.removeEventListener("lumiere:ai-form-fill-prompt", handleAiFormPrompt)
  }, [aiEnabled])

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value }
      onValuesChange?.(next)
      return next
    })
    if (aiAppliedFields[name]) {
      setAiAppliedFields((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
    // Clear error when field is modified
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  const handleAiSuggest = async () => {
    if (!aiEnabled || !aiAssist?.companyId || !aiAssist.entityType) {
      toast.warning("AI form fill needs company context")
      return
    }

    if (!aiPrompt.trim()) {
      toast.warning("Add text for AI to use")
      return
    }

    try {
      const result = await aiSuggest.mutateAsync({
        companyId: aiAssist.companyId,
        formId: aiAssist.formId ?? config.id,
        entityType: aiAssist.entityType,
        fields: aiSchema,
        rawText: aiPrompt,
      })
      setAiSuggestions(result.suggestions)
      setAiValidationNotes(result.validation_notes.map((note) => note.message))
      const count = Object.keys(result.suggestions).length
      if (count === 0) {
        toast.info("AI did not find matching fields")
      } else {
        toast.success(`AI suggested ${count} field${count === 1 ? "" : "s"}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI form suggestion failed"
      toast.error(message)
    }
  }

  const handleApplyAiSuggestions = () => {
    const entries = Object.entries(aiSuggestions)
    if (entries.length === 0) {
      toast.warning("No AI suggestions to apply")
      return
    }

    const applied: Record<string, { confidence: number; note?: string }> = {}
    setValues((prev) => {
      const next = { ...prev }
      for (const [fieldName, suggestion] of entries) {
        next[fieldName] = suggestion.value
        applied[fieldName] = {
          confidence: suggestion.confidence,
          note: suggestion.note,
        }
      }
      onValuesChange?.(next)
      return next
    })
    setAiAppliedFields(applied)
    setErrors((prev) => {
      const next = { ...prev }
      for (const fieldName of Object.keys(applied)) {
        delete next[fieldName]
      }
      return next
    })
    toast.success("AI suggestions applied for review")
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

    if (busy) {
      toast.warning(t("common.formSubmit.busy"))
      return
    }

    if (!validateForm()) {
      toast.warning(t("common.formSubmit.validationFailed"))
      return
    }

    setIsSubmitting(true)
    try {
      const submitHandler = onSubmit || config.onSubmit
      if (submitHandler) {
        await submitHandler(values)
      } else {
        toast.warning(t("common.formSubmit.noHandler"))
      }
    } catch (error) {
      console.error("Form submission error:", error)
      const message =
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : t("common.formSubmit.failed")
      toast.error(message)
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
    <form noValidate onSubmit={handleSubmit} className="space-y-6">
      {aiEnabled ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Fill with AI</p>
              <p className="text-xs text-muted-foreground">
                Suggestions only update this form after you apply them.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAiPanelOpen((open) => !open)}
              disabled={busy}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {aiPanelOpen ? "Hide AI" : "Fill with AI"}
            </Button>
          </div>

          {aiPanelOpen ? (
            <div className="space-y-3">
              <Textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Paste notes, an email, invoice text, or describe what this form should contain..."
                rows={4}
                className="bg-background"
              />
              {aiValidationNotes.length > 0 ? (
                <div className="space-y-1">
                  {aiValidationNotes.map((note, index) => (
                    <p key={`${note}-${index}`} className="text-xs text-muted-foreground">
                      {note}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAiSuggest}
                  disabled={busy || aiSuggest.isPending}
                >
                  {aiSuggest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Suggest values
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyAiSuggestions}
                  disabled={busy || Object.keys(aiSuggestions).length === 0}
                >
                  Apply suggestions
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

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
                    aiSuggestion={aiAppliedFields[field.name]}
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
                disabled={busy}
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
                disabled={busy}
              >
                {config.cancelLabel || t("common.cancel")}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={busy} data-testid={`form-submit-${config.id}`}>
              {busy
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
