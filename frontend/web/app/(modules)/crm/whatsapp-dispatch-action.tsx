"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  canReviewWhatsApp,
  renderWhatsAppTemplate,
  whatsappOptionsSchema,
  whatsappRequest,
  whatsappReviewSchema,
  whatsappSendSchema,
  whatsappStatusSchema,
  type WhatsAppChoice,
  type WhatsAppOptions,
  type WhatsAppReview,
  type WhatsAppStatus,
} from "@/lib/whatsapp-dispatch"

interface Props {
  companyId: string
  messageId: string
  onUseTemplate: (body: string) => void
}

export function WhatsAppDispatchAction({ companyId, messageId, onUseTemplate }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<WhatsAppOptions | null>(null)
  const [review, setReview] = useState<WhatsAppReview | null>(null)
  const [status, setStatus] = useState<WhatsAppStatus | null>(null)
  const [templateId, setTemplateId] = useState("")
  const [parameters, setParameters] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const base = `/api/whatsapp/messages/${encodeURIComponent(messageId)}`

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setOptions(null)
    setError(null)
    void whatsappRequest(
      `${base}/options?companyId=${encodeURIComponent(companyId)}`,
      whatsappOptionsSchema,
      {
        signal: controller.signal,
      },
    )
      .then((value) => {
        if (!controller.signal.aborted) setOptions(value)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "WhatsApp is unavailable")
      })
    return () => controller.abort()
  }, [open, base, companyId])

  const template = options?.templates.find((item) => item.id === templateId)
  const rendered = template ? renderWhatsAppTemplate(template.body, parameters) : null
  const choice: WhatsAppChoice = template
    ? { mode: "template", templateId: template.id, parameters }
    : { mode: "reply" }
  const matching = template ? rendered === options?.body : options?.replyWindowOpen === true
  const eligible = options !== null && canReviewWhatsApp(options) && matching && !attempted

  async function refreshStatus() {
    try {
      const next = await whatsappRequest(
        `${base}/status?companyId=${encodeURIComponent(companyId)}`,
        whatsappStatusSchema,
      )
      if (mounted.current) {
        setStatus(next)
        setResult(next.transport.state)
        setError(null)
        // Even a not-attempted response does not automatically submit a send.
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Status is unconfirmed; do not resend")
    }
  }

  async function preview() {
    if (busyRef.current || !eligible) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const next = await whatsappRequest(`${base}/preview`, whatsappReviewSchema, {
        method: "POST",
        body: JSON.stringify({ companyId, choice }),
      })
      if (mounted.current) setReview(next)
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Message review failed")
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function confirm() {
    if (busyRef.current || !review || attempted) return
    busyRef.current = true
    setBusy(true)
    setAttempted(true)
    setResult("unknown")
    setError(null)
    try {
      const next = await whatsappRequest(`${base}/dispatch`, whatsappSendSchema, {
        method: "POST",
        body: JSON.stringify({ companyId, reviewId: review.reviewId }),
      })
      if (mounted.current) setResult(next.state)
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Send outcome is unknown")
    } finally {
      busyRef.current = false
      if (mounted.current) {
        setReview(null)
        setBusy(false)
        void refreshStatus()
      }
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("crm.whatsapp.reviewAndSend", "Review and send via WhatsApp")}
      </Button>
    )
  }

  return (
    <section
      className="mt-2 min-w-0 space-y-3 rounded-md border p-3"
      aria-label={t("crm.whatsapp.review", "WhatsApp send review")}
    >
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      )}
      {!options && !error && <p role="status">{t("common.loading", "Loading…")}</p>}
      {options && (
        <>
          <p className="text-sm">
            {options.senderName} → {options.recipient}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "crm.whatsapp.queuedNotSent",
              "Queued does not mean sent. Confirm the exact message below.",
            )}
          </p>
          {!canReviewWhatsApp(options) && (
            <p role="status" className="text-sm">
              {options.optedOut
                ? t("crm.whatsapp.stopped", "This recipient has opted out. Sending is blocked.")
                : !options.quietHoursAllow
                  ? t(
                      "crm.whatsapp.quietHours",
                      "Sending is blocked during the recipient’s quiet hours.",
                    )
                  : t(
                      "crm.whatsapp.existingAttempt",
                      "This message already has an attempt. Check its status; do not resend.",
                    )}
            </p>
          )}
          {!attempted && !review && canReviewWhatsApp(options) && (
            <>
              <Label htmlFor={`wa-mode-${messageId}`}>
                {t("crm.whatsapp.mode", "Message type")}
              </Label>
              <select
                id={`wa-mode-${messageId}`}
                className="w-full min-w-0 rounded-md border bg-background p-2 text-sm"
                value={templateId}
                disabled={busy}
                onChange={(event) => {
                  setTemplateId(event.target.value)
                  setParameters(
                    Array.from(
                      {
                        length:
                          options.templates.find((item) => item.id === event.target.value)
                            ?.parameterCount ?? 0,
                      },
                      () => "",
                    ),
                  )
                  setReview(null)
                }}
              >
                <option value="">
                  {t("crm.whatsapp.reply", "Reply within the customer service window")}
                </option>
                {options.templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.language}
                  </option>
                ))}
              </select>
              {!template && !options.replyWindowOpen && (
                <p className="text-sm">
                  {t(
                    "crm.whatsapp.windowClosed",
                    "The reply window is closed. Use an approved utility template.",
                  )}
                </p>
              )}
              {template &&
                parameters.map((value, index) => (
                  <div key={index} className="space-y-1">
                    <Label htmlFor={`wa-param-${messageId}-${index}`}>
                      {t("crm.whatsapp.parameter", "Template parameter")} {index + 1}
                    </Label>
                    <Input
                      id={`wa-param-${messageId}-${index}`}
                      value={value}
                      disabled={busy}
                      maxLength={4000}
                      onChange={(event) =>
                        setParameters((current) =>
                          current.map((item, at) => (at === index ? event.target.value : item)),
                        )
                      }
                    />
                  </div>
                ))}
              {template && (
                <p className="whitespace-pre-wrap break-words rounded bg-muted p-2 text-sm">
                  {rendered ?? template.body}
                </p>
              )}
              {template && rendered && !matching && (
                <div className="space-y-2">
                  <p className="text-sm">
                    {t(
                      "crm.whatsapp.templateMismatch",
                      "This template differs from the queued message. Copy its text to the composer and queue a new message; this one remains unsent.",
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      onUseTemplate(rendered)
                      setOpen(false)
                    }}
                  >
                    {t("crm.whatsapp.useTemplate", "Use this text in the composer")}
                  </Button>
                </div>
              )}
              <Button size="sm" disabled={!eligible || busy} onClick={() => void preview()}>
                {t("crm.whatsapp.preview", "Preview exact message")}
              </Button>
            </>
          )}
          {review && (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap break-words rounded bg-muted p-3">{review.body}</p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "crm.whatsapp.expires",
                  "This review expires after 10 minutes. Permission, consent and template approval are checked again when sending.",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || attempted} onClick={() => void confirm()}>
                  {t("crm.whatsapp.confirm", "Confirm and send once")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setReview(null)}>
                  {t("common.cancel", "Cancel")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {(attempted ||
        status !== null ||
        (options && options.transport.state !== "not_attempted")) && (
        <div className="space-y-2" role="status">
          <p>
            {t("crm.whatsapp.transport", "Provider request")}: {result ?? options?.transport.state}
          </p>
          {status && (
            <p>
              {t("crm.whatsapp.delivery", "Recipient delivery")}: {status.deliveryState}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t(
              "crm.whatsapp.noRetry",
              "Acceptance is not delivery. Unknown outcomes are not resent automatically.",
            )}
          </p>
        </div>
      )}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void refreshStatus()}>
        {t("crm.whatsapp.refreshStatus", "Refresh status without resending")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setReview(null)
          setOpen(false)
        }}
      >
        {t("common.close", "Close")}
      </Button>
    </section>
  )
}
