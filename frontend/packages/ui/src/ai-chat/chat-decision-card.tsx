"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Badge } from "../components/badge"
import { Button } from "../components/button"
import { RadioGroup, RadioGroupItem } from "../components/radio-group"
import { Textarea } from "../components/textarea"
import { cn } from "../lib/utils"
import { CHAT_DECISION_MAX_OTHER_TEXT, CHAT_DECISION_OTHER_OPTION_ID, type ChatDecisionAnswer, type ChatDecisionRequest } from "../lib/chat-decision-types"

export type ChatDecisionCardProps = {
  request: ChatDecisionRequest
  onSubmit: (answer: ChatDecisionAnswer) => Promise<void>
  disabled?: boolean
  scopeKey?: string
  /** Action labels can make the selected approval explicit without changing its identity. */
  submitLabels?: Readonly<Record<string, string>>
}

/** A request revision owns one explicit answer. The host owns durable answer history. */
export function ChatDecisionCard(props: ChatDecisionCardProps) {
  return <ScopedChatDecisionCard key={JSON.stringify([props.scopeKey, props.request.id, props.request.revision])} {...props} />
}

function ScopedChatDecisionCard({ request, onSubmit, disabled = false, submitLabels }: ChatDecisionCardProps) {
  const { t } = useTranslation()
  const id = useId()
  const [optionId, setOptionId] = useState<string | null>(null)
  const [otherText, setOtherText] = useState("")
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dispatching = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const unavailable = disabled || pending || submitted
  const otherSelected = optionId === CHAT_DECISION_OTHER_OPTION_ID
  const validOther = otherText.trim().length > 0 && otherText.length <= CHAT_DECISION_MAX_OTHER_TEXT
  const validRequest = !!request.id.trim() && Number.isSafeInteger(request.revision) && request.revision >= 0 && !!request.question.trim()
    && request.options.length >= 2 && request.options.length <= 3
    && new Set(request.options.map(option => option.id)).size === request.options.length
    && request.options.every(option => !!option.id.trim() && option.id !== CHAT_DECISION_OTHER_OPTION_ID && !!option.label.trim())
  const selectedOptionExists = otherSelected ? request.allowOther : request.options.some(option => option.id === optionId)
  const canSubmit = validRequest && selectedOptionExists && (!otherSelected || validOther) && !unavailable

  const submit = async () => {
    if (!canSubmit || !optionId || dispatching.current) return
    dispatching.current = true
    setPending(true)
    setError(null)
    try {
      await onSubmit({ requestId: request.id, expectedRevision: request.revision, optionId, ...(otherSelected ? { otherText: otherText.trim() } : {}) })
      if (mounted.current) setSubmitted(true)
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : t("aiChat.decision.failed", { defaultValue: "Your answer could not be confirmed. Check the request and try again." }))
    } finally {
      dispatching.current = false
      if (mounted.current) setPending(false)
    }
  }

  return <form className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="chat-decision-card" aria-labelledby={`${id}-question`} onSubmit={event => { event.preventDefault(); void submit() }}>
    <h3 id={`${id}-question`} className="text-sm font-semibold leading-6">{request.question}</h3>
    {!validRequest ? <p role="alert" className="text-sm text-destructive">{t("aiChat.decision.unavailable", { defaultValue: "This decision request is unavailable. Refresh to check its current state." })}</p> : <>
      <RadioGroup value={optionId ?? ""} onValueChange={value => { if (typeof value === "string" && !unavailable) { setOptionId(value); setError(null) } }} disabled={unavailable} aria-labelledby={`${id}-question`} className="gap-2">
        {request.options.map((option, index) => <label key={option.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted/40", optionId === option.id && "border-ring bg-muted/30", unavailable && "cursor-default opacity-70")}>
          <RadioGroupItem id={`${id}-option-${index}`} value={option.id} className="mt-1" aria-labelledby={`${id}-label-${index}`} aria-describedby={option.description ? `${id}-description-${index}` : undefined} />
          <span className="min-w-0 space-y-1">
            <span className="flex flex-wrap items-center gap-2"><span id={`${id}-label-${index}`} className="font-medium">{option.label}</span>{option.recommended ? <Badge variant="secondary" className="text-[10px]">{t("aiChat.decision.recommended", { defaultValue: "Recommended" })}</Badge> : null}</span>
            {option.description ? <span id={`${id}-description-${index}`} className="block text-xs leading-5 text-muted-foreground">{option.description}</span> : null}
          </span>
        </label>)}
        {request.allowOther ? <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted/40", otherSelected && "border-ring bg-muted/30", unavailable && "cursor-default opacity-70")}><RadioGroupItem value={CHAT_DECISION_OTHER_OPTION_ID} id={`${id}-other`} className="mt-0.5" aria-labelledby={`${id}-other-label`} /><span id={`${id}-other-label`} className="font-medium">{request.otherLabel ?? t("aiChat.decision.other", { defaultValue: "Other" })}</span></label> : null}
      </RadioGroup>
      {otherSelected ? <div className="space-y-1.5"><label htmlFor={`${id}-other-text`} className="text-sm font-medium">{t("aiChat.decision.otherText", { defaultValue: "Tell us what you want to do" })}</label><Textarea variant="plain" id={`${id}-other-text`} value={otherText} disabled={unavailable} maxLength={CHAT_DECISION_MAX_OTHER_TEXT} rows={3} onChange={event => setOtherText(event.target.value)} aria-describedby={`${id}-other-hint`} aria-invalid={otherText.length > CHAT_DECISION_MAX_OTHER_TEXT} /><p id={`${id}-other-hint`} className="text-xs text-muted-foreground">{t("aiChat.decision.otherHint", { defaultValue: "Describe your choice in up to 2,000 characters." })}</p></div> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      {submitted ? <p role="status" className="text-sm text-muted-foreground">{t("aiChat.decision.saved", { defaultValue: "Answer saved." })}</p> : null}
      <Button type="submit" disabled={!canSubmit} className="min-h-10">{pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{pending ? t("aiChat.decision.submitting", { defaultValue: "Saving answer…" }) : (optionId && submitLabels?.[optionId]) || t("aiChat.decision.submit", { defaultValue: "Submit answer" })}</Button>
    </>}
  </form>
}
