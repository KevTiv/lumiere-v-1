"use client"


import React, { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useAiFormSuggest } from "@lumiere/query-hooks/hooks/ai-forms"
import { cn } from "../lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"
import type { AiFormAssistConfig, FormConfig, FormField } from "../lib/form-types"
import { serializeAiFormSchema } from "../lib/ai-form-schema"
import { FormFieldRenderer } from "./forms-field-render"
import { formValuesDiffer } from "./use-unsaved-changes-guard"
import { Button } from "../components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Separator } from "../components/separator"
import { Textarea } from "../components/textarea"
import { Check, Loader2, Sparkles } from "lucide-react"
import * as Icons from "lucide-react"
import { toast } from "sonner"

function isFieldVisible(field: FormField, values: Record<string, unknown>): boolean {
  const rule = field.visibleWhen
  if (!rule?.field) return true
  return String(values[rule.field] ?? "") === String(rule.equals ?? "")
}

function visibleSectionFields(
  fields: FormField[],
  values: Record<string, unknown>,
): FormField[] {
  return fields.filter((field) => isFieldVisible(field, values))
}

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
  /** Blocks submission without presenting a false in-progress state. */
  submissionDisabled?: boolean
  /** Enables advisory AI suggestions that only update local form state when the user applies them. */
  aiAssist?: AiFormAssistConfig
  /** Reports whether the fields differ from their initial (or last submitted) values. */
  onDirtyChange?: (dirty: boolean) => void
}

export function ModularForm({
  config,
  onSubmit,
  onCancel,
  className,
  leadingActions,
  onValuesChange,
  isPending,
  submissionDisabled = false,
  aiAssist,
  onDirtyChange,
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
            case "multiselect":
              values[field.name] = []
              break
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
  const baselineRef = useRef<Record<string, unknown>>(values)
  useEffect(() => {
    // Reference reads may finish after the dialog mounts. Bind a newly known
    // hidden context once, without resetting edits or replacing a reviewed ID.
    const empty = (value: unknown) => value === "" || value == null
    setValues((previous) => {
      let next = previous
      for (const section of config.sections) {
        for (const field of section.fields) {
          if (field.type !== "hidden" || empty(field.defaultValue)
            || !empty(previous[field.name]) || !empty(baselineRef.current[field.name])) continue
          if (next === previous) next = { ...previous }
          next[field.name] = field.defaultValue
          baselineRef.current = { ...baselineRef.current, [field.name]: field.defaultValue }
        }
      }
      return next
    })
  }, [config])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState(aiAssist?.initialPrompt ?? "")
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { value: unknown; confidence: number; note?: string }>>({})
  const [aiAppliedFields, setAiAppliedFields] = useState<Record<string, { confidence: number; note?: string }>>({})
  const [aiValidationNotes, setAiValidationNotes] = useState<string[]>([])
  const busy = isSubmitting || !!isPending
  const dirty = formValuesDiffer(values, baselineRef.current)
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty)
  }, [dirty])

  useEffect(() => () => onDirtyChangeRef.current?.(false), [])
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
    if (field.type === "multiselect" &&
        (!Array.isArray(value) || !value.every((item) => typeof item === "string"))) {
      return t("common.validation.invalidFormat")
    }
    if (field.required) {
      if (field.type === "multiselect") {
        if (!Array.isArray(value) || value.length === 0) return t("common.validation.required")
      } else if (field.type === "file") {
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

    for (const section of config.sections) {
      for (const field of visibleSectionFields(section.fields, values)) {
        const error = validateField(field, values[field.name])
        if (error) newErrors[field.name] = error
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (submissionDisabled) return

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
        // Saved: what is on screen is now the baseline, not unsaved work.
        baselineRef.current = values
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
        <div className={cn(workspaceStyles.surface, "space-y-3 bg-muted/30 p-4")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={workspaceStyles.sectionTitle}>Fill with AI</p>
              <p className={cn(workspaceStyles.sectionDescription, "mt-0.5")}>
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
              <div className={cn(workspaceStyles.actions, "justify-end")}>
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
            <div className={workspaceStyles.formSection}>
              {(section.title || section.description) && (
                <div className="mb-4 flex items-start gap-3">
                  {SectionIcon && (
                    <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                      <SectionIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {section.title && (
                      <h3 className={workspaceStyles.sectionTitle}>
                        {section.title}
                      </h3>
                    )}
                    {section.description && (
                      <p className={workspaceStyles.sectionDescription}>
                        {section.description}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="grid min-w-0 grid-cols-12 gap-x-4 gap-y-5 [&>div]:min-w-0">
                {visibleSectionFields(section.fields, values).map((field) => (
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
            workspaceStyles.formActions,
            leadingActions ? "justify-between" : "justify-end",
          )}
        >
          {leadingActions ? <div className={workspaceStyles.actions}>{leadingActions}</div> : null}
          <div className={workspaceStyles.actions}>
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
            <Button
              type="submit"
              size="sm"
              disabled={busy || submissionDisabled}
              data-testid={`form-submit-${config.id}`}
            >
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
      <Card className={cn(workspaceStyles.surface, className)}>
        {!config.hideTitle && (config.title || config.description) ? (
          <CardHeader className={cn(workspaceStyles.pageHeader, "md:flex-col md:items-start")}>
            {config.title ? <CardTitle className={workspaceStyles.pageTitle}>{config.title}</CardTitle> : null}
            {config.description ? <CardDescription className={workspaceStyles.pageDescription}>{config.description}</CardDescription> : null}
          </CardHeader>
        ) : null}
        <CardContent>{formContent}</CardContent>
      </Card>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      {!config.hideTitle && (config.title || config.description) ? (
        <div className={cn(workspaceStyles.pageHeader, "md:flex-col md:items-start")}>
          {config.title ? (
            <h2 className={workspaceStyles.pageTitle}>{config.title}</h2>
          ) : null}
          {config.description ? (
            <p className={workspaceStyles.pageDescription}>{config.description}</p>
          ) : null}
        </div>
      ) : null}
      {formContent}
    </div>
  )
}
