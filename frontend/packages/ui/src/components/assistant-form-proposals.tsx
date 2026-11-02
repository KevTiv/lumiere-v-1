"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useAiFormSuggest,
  type AiFormFieldSchema,
  type AiFormSuggestResponse,
} from "@lumiere/query-hooks/hooks/ai-forms"
import { decodeAiFormSuggestions } from "@lumiere/query-hooks/hooks/ai-form-suggestions"
import { Button } from "./button"
import { Textarea } from "./textarea"

/** Advisory header proposals for native editors that do not use ModularForm. */
export function AssistantFormProposals({
  companyId,
  entityType,
  formId,
  prompt,
  scopeKey,
  fields,
  blocked,
  onApply,
}: {
  companyId: number
  entityType: string
  formId: string
  prompt: string
  scopeKey: string
  fields: AiFormFieldSchema[]
  blocked?: boolean
  onApply: (values: Record<string, string | number | boolean>) => void
}) {
  const { t } = useTranslation()
  const suggest = useAiFormSuggest()
  const [draft, setDraft] = useState({ scopeKey, prompt, text: prompt })
  const text =
    draft.scopeKey === scopeKey && draft.prompt === prompt ? draft.text : prompt
  const [reply, setReply] = useState<{
    key: string
    value: AiFormSuggestResponse
  } | null>(null)
  const [error, setError] = useState(false)
  const sequence = useRef(0)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      sequence.current++
    }
  }, [])
  const key = JSON.stringify([
    scopeKey,
    companyId,
    entityType,
    formId,
    fields,
    text,
  ])
  const currentKey = useRef(key)
  currentKey.current = key
  const visible = reply?.key === key ? reply.value : null
  const canSuggest =
    Number.isSafeInteger(companyId) &&
    companyId > 0 &&
    text.trim().length > 0 &&
    text.length <= 4000 &&
    !blocked &&
    !suggest.isPending
  const prepare = async () => {
    if (!canSuggest || inFlight.current) return
    inFlight.current = true
    const attempt = ++sequence.current,
      requestKey = key
    setReply(null)
    setError(false)
    try {
      const value = await suggest.mutateAsync({
        companyId,
        entityType,
        formId,
        fields,
        rawText: text,
      })
      if (
        !mounted.current ||
        currentKey.current !== requestKey ||
        sequence.current !== attempt
      )
        return
      setReply({
        key: requestKey,
        value: decodeAiFormSuggestions(value, fields),
      })
    } catch {
      if (
        mounted.current &&
        currentKey.current === requestKey &&
        sequence.current === attempt
      )
        setError(true)
    } finally {
      if (sequence.current === attempt) inFlight.current = false
    }
  }
  const apply = () => {
    if (!visible || blocked || inFlight.current) return
    // Current choices remain the owner of reference eligibility, including when
    // a lookup changed after generation. No proposal can write hidden context.
    try {
      const validated = decodeAiFormSuggestions(visible, fields)
      const values: Record<string, string | number | boolean> = {}
      for (const [name, item] of Object.entries(validated.suggestions)) {
        if (typeof item.value !== "string" && typeof item.value !== "number" && typeof item.value !== "boolean") throw new Error("Invalid form proposal")
        values[name] = item.value
      }
      onApply(values)
      setReply(null)
    } catch {
      setError(true)
    }
  }
  return (
    <section
      className="mb-4 space-y-3 rounded-lg border p-4"
      aria-label={t("common.assistantForm.title", {
        defaultValue: "Prepare values with AI",
      })}
    >
      <p className="text-sm text-muted-foreground">
        {t("common.assistantForm.review", {
          defaultValue:
            "Review suggested header values before applying them. Saving remains a separate action.",
        })}
      </p>
      <Textarea
        variant="plain"
        aria-label={t("common.assistantForm.request", {
          defaultValue: "Original request",
        })}
        value={text}
        maxLength={4000}
        disabled={blocked || suggest.isPending}
        onChange={(event) =>
          setDraft({ scopeKey, prompt, text: event.target.value })
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("common.assistantForm.unavailable", {
            defaultValue:
              "Suggestions could not be verified. Your current entries are unchanged.",
          })}
        </p>
      ) : null}
      {visible ? (
        <dl className="space-y-2 text-sm">
          {Object.entries(visible.suggestions).map(([name, item]) => (
            <div key={name}>
              <dt className="font-medium">
                {fields.find((field) => field.name === name)?.label ?? name}
              </dt>
              <dd className="whitespace-pre-wrap break-words">
                {fields
                  .find((field) => field.name === name)
                  ?.options?.find((option) => option.value === item.value)
                  ?.label ?? String(item.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!canSuggest}
          onClick={() => void prepare()}
        >
          {t("common.assistantForm.suggest", {
            defaultValue: "Suggest values",
          })}
        </Button>
        <Button
          type="button"
          disabled={
            blocked || !visible || Object.keys(visible.suggestions).length === 0
          }
          onClick={apply}
        >
          {t("common.assistantForm.apply", {
            defaultValue: "Apply suggestions",
          })}
        </Button>
      </div>
    </section>
  )
}
