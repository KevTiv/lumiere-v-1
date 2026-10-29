"use client"


import React, { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation, i18n } from "@lumiere/i18n"
import { useAiFormSuggest } from "@lumiere/query-hooks/hooks/ai-forms"
import { cn } from "../lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"
import type { AiFormAssistConfig, FormConfig, FormField, FormPreviewRenderer, FormValues } from "../lib/form-types"
import { isNumericField, numericFieldBounds } from "../lib/form-types"
import { storedNumericValue } from "../lib/numeric-format"
import { serializeAiFormSchema } from "../lib/ai-form-schema"
import { FormFieldRenderer } from "./forms-field-render"
import { formValuesDiffer } from "./use-unsaved-changes-guard"
import { toDraftValues, useFormDraft } from "./form-draft"
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
  const value = String(values[rule.field] ?? "")
  return "oneOf" in rule ? rule.oneOf.includes(value) : value === rule.equals
}

// Deliberately loose: catches typos (missing @ or domain) without rejecting unusual valid values.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_FORMAT = /^(https?:\/\/)?[^\s/.]+\.[^\s]+$/i

function formatError(field: FormField, value: unknown): "email" | "url" | null {
  if (typeof value !== "string" || value.trim() === "") return null
  if (field.type === "email" && !EMAIL_FORMAT.test(value.trim())) return "email"
  if (field.type === "url" && !URL_FORMAT.test(value.trim())) return "url"
  return null
}

function visibleSectionFields(
  fields: FormField[],
  values: Record<string, unknown>,
): FormField[] {
  return fields.filter((field) => isFieldVisible(field, values))
}

function clearHiddenFileSelections(config: FormConfig, values: FormValues): void {
  // A hidden file input is unmounted. Clear its selection so it cannot be submitted unseen.
  for (const section of config.sections) {
    for (const field of section.fields) {
      if (field.type === "file" && !isFieldVisible(field, values)) values[field.name] = undefined
    }
  }
}

interface ModularFormProps {
  config: FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  /** Submission feedback stays in the same scroll area as the fields it concerns. */
  submitError?: string | null
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
  /** Renders beside the controls using the current, unsaved form values. */
  renderPreview?: FormPreviewRenderer
  /** Keep actions outside the scrolling body when embedded in a constrained dialog. */
  scrollable?: boolean
  /**
   * Autosave unsaved values to this browser and restore them when the form
   * reopens. Set `false` for credential or otherwise sensitive forms.
   */
  draft?: boolean
  /** Distinguishes drafts of one config, e.g. the id of the record being edited. */
  draftKey?: string | number | null
}

export function ModularForm({
  config,
  onSubmit,
  submitError,
  onCancel,
  className,
  leadingActions,
  onValuesChange,
  isPending,
  submissionDisabled = false,
  aiAssist,
  onDirtyChange,
  renderPreview,
  scrollable = false,
  draft = true,
  draftKey,
}: ModularFormProps) {
  const { t } = useTranslation()
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const visibleSubmitError = submitError || submissionError
  const formBodyRef = useRef<HTMLDivElement>(null)
  const invalidFieldRef = useRef<string | null>(null)
  useEffect(() => {
    // Scroll only the field owner; scrolling ancestors can move the dialog header and close control.
    if (visibleSubmitError && formBodyRef.current) formBodyRef.current.scrollTop = 0
  }, [visibleSubmitError])
  useEffect(() => { setSubmissionError(null) }, [config.id])
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
            case "money":
            case "percent":
            case "quantity":
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
  const formDraft = useFormDraft({
    enabled: draft,
    config,
    draftKey,
    values: toDraftValues(config, (name) => values[name]),
    initialValues: toDraftValues(config, (name) => baselineRef.current[name]),
    dirty,
    onRestore: (restored) => {
      setValues((prev) => {
        const next = { ...prev, ...restored }
        onValuesChange?.(next)
        return next
      })
    },
    onRevert: () => {
      const baseline = baselineRef.current
      setValues(baseline)
      onValuesChange?.(baseline)
      setErrors({})
    },
  })
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
      clearHiddenFileSelections(config, next)
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
      toast.warning(i18n.t("ui.forms.modularForm.aiFormFillNeedsCompanyContext"))
      return
    }

    if (!aiPrompt.trim()) {
      toast.warning(i18n.t("ui.forms.modularForm.addTextForAIToUse"))
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
        toast.info(i18n.t("ui.forms.modularForm.aiDidNotFindMatchingFields"))
      } else {
        toast.success(i18n.t("ui.forms.modularForm.suggestedFields", { count }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : i18n.t("ui.forms.modularForm.aiFormSuggestionFailed")
      toast.error(message)
    }
  }

  const handleApplyAiSuggestions = () => {
    const entries = Object.entries(aiSuggestions)
    if (entries.length === 0) {
      toast.warning(i18n.t("ui.forms.modularForm.noAISuggestionsToApply"))
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
      clearHiddenFileSelections(config, next)
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
    toast.success(i18n.t("ui.forms.modularForm.aiSuggestionsAppliedForReview"))
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

    // Only values the user typed are checked, so an old stored value never blocks an unrelated edit.
    const format = value !== baselineRef.current[field.name] ? formatError(field, value) : null
    if (format === "email") {
      return t("common.validation.invalidEmail")
    }
    if (format === "url") {
      return t("common.validation.invalidUrl")
    }

    if (isNumericField(field)) {
      // Unparseable text stays in the value so the field can say so instead of submitting it.
      const numeric = storedNumericValue(value)
      if (numeric === null) return t("common.validation.invalidNumber")
      const { min, max } = numericFieldBounds(field)
      if (numeric !== undefined) {
        if (min !== undefined && numeric < min) return t("common.validation.min", { min })
        if (max !== undefined && numeric > max) return t("common.validation.max", { max })
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

  useEffect(() => {
    const name = invalidFieldRef.current
    invalidFieldRef.current = null
    const body = formBodyRef.current
    if (!name || !body) return
    const field = Array.from(body.querySelectorAll<HTMLElement>("[data-form-field]"))
      .find((element) => element.dataset.formField === name)
    if (!field) return
    field.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled), input:not(:disabled), textarea:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true })
    if (scrollable) {
      const fieldRect = field.getBoundingClientRect()
      const bodyRect = body.getBoundingClientRect()
      if (fieldRect.top < bodyRect.top || fieldRect.bottom > bodyRect.bottom) {
        body.scrollTop += fieldRect.top - bodyRect.top - 16
      }
    } else {
      field.scrollIntoView?.({ block: "nearest" })
    }
  }, [errors, scrollable])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    for (const section of config.sections) {
      for (const field of visibleSectionFields(section.fields, values)) {
        const error = validateField(field, values[field.name])
        if (error) newErrors[field.name] = error
      }
    }

    invalidFieldRef.current = Object.keys(newErrors)[0] ?? null
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

    setSubmissionError(null)
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
        formDraft.clear()
      } else {
        toast.warning(t("common.formSubmit.noHandler"))
      }
    } catch (error) {
      console.error("Form submission error:", error)
      const message =
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : t("common.formSubmit.failed")
      setSubmissionError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Cmd/Ctrl+Enter submits from any field, so long forms do not need a trip to the footer.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing) return
    if ((e.target as HTMLElement).closest("[data-form-ai-panel]")) return
    e.preventDefault()
    e.currentTarget.requestSubmit()
  }

  const handleReset = () => {
    formDraft.clear()
    const initial = getInitialValues()
    setValues(initial)
    onValuesChange?.(initial)
    setErrors({})
    setSubmissionError(null)
  }

  const handleCancel = () => {
    const cancelHandler = onCancel || config.onCancel
    if (cancelHandler) {
      cancelHandler()
    }
  }

  const fieldsContent = (
    <>
      {formDraft.banner}
      {aiEnabled ? (
        <div data-form-ai-panel className={cn(workspaceStyles.surface, "space-y-3 bg-muted/30 p-4")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={workspaceStyles.sectionTitle}>{i18n.t("ui.forms.modularForm.fillWithAI")}</p>
              <p className={cn(workspaceStyles.sectionDescription, "mt-0.5")}>
                {i18n.t("ui.forms.modularForm.suggestionsOnlyUpdateThisFormAfterYouApplyThem")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAiPanelOpen((open) => !open)}
              disabled={busy}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {aiPanelOpen ? i18n.t("ui.forms.modularForm.hideAI") : i18n.t("ui.forms.modularForm.fillWithAI")}
            </Button>
          </div>

          {aiPanelOpen ? (
            <div className="space-y-3">
              <Textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder={i18n.t("ui.forms.modularForm.pasteNotesAnEmailInvoiceTextOrDescribeWhatThisFormShouldContain")}
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
                  {i18n.t("ui.forms.modularForm.suggestValues")}</Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyAiSuggestions}
                  disabled={busy || Object.keys(aiSuggestions).length === 0}
                >
                  {i18n.t("ui.forms.modularForm.applySuggestions")}</Button>
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

        const fields = (
          <div className="grid min-w-0 grid-cols-12 gap-x-4 gap-y-5 [&>div]:min-w-0">
            {visibleSectionFields(section.fields, values).map((field) => (
              <FormFieldRenderer
                key={field.id}
                field={field}
                values={values}
                value={values[field.name]}
                onChange={(value) => handleChange(field.name, value)}
                error={errors[field.name]}
                aiSuggestion={aiAppliedFields[field.name]}
              />
            ))}
          </div>
        )

        if (section.collapsible) return (
          <details key={section.id} open={section.fields.some((field) => errors[field.name]) || undefined}
            className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
              {section.title}
            </summary>
            <div className="pt-4">
              {section.description && <p className="mb-4 text-sm text-muted-foreground">{section.description}</p>}
              {fields}
            </div>
          </details>
        )

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
              {fields}
            </div>
          </div>
        )
      })}

    </>
  )
  const preview = renderPreview?.(values)
  const hasPreview = preview != null && preview !== false

  const formContent = (
    <form noValidate onSubmit={handleSubmit} onKeyDown={handleKeyDown} className={cn("flex flex-col", scrollable ? "min-h-0 flex-1 overflow-hidden" : "gap-6")}>
      <div
        ref={formBodyRef}
        data-form-body={scrollable ? "" : undefined}
        className={cn(
          scrollable && "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5",
          hasPreview && "grid items-start gap-6 lg:grid-cols-2",
        )}
      >
        <div className="flex min-w-0 flex-col gap-6">
          {visibleSubmitError ? (
            <p tabIndex={-1} className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
              {visibleSubmitError}
            </p>
          ) : null}
          {fieldsContent}
        </div>
        {hasPreview ? (
          <aside
            data-form-preview
            data-testid={`form-preview-${config.id}`}
            aria-label={t("common.formPreview.label", { defaultValue: "Preview" })}
            className="min-w-0 lg:sticky lg:top-0"
            onKeyDown={(event) => {
              // Editing a local example must not implicitly submit the record form.
              if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault()
            }}
          >
            {preview}
          </aside>
        ) : null}
      </div>

      {config.showActions !== false ? (
        <div
          data-form-actions
          className={cn(
            workspaceStyles.formActions,
            scrollable && "mt-0 shrink-0 bg-card",
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
    <div className={cn(scrollable ? "flex min-h-0 flex-1 flex-col" : "space-y-6", className)}>
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
