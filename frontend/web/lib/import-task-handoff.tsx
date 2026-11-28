"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { apiFetch } from "./api-fetch"
import type { ChatImportTask } from "./chat-import-task"
import {
  ImportHandoffRecipientPicker,
  useImportHandoffRecipients,
} from "./import-handoff-recipient-picker"
import { importTaskHref } from "./import-task-navigation"
import type { SavedImportScope } from "./use-saved-import-task"

export function ImportTaskHandoff({
  scope,
  taskId,
  handoff,
  onChange,
  disabled,
}: {
  scope: SavedImportScope
  taskId: string
  handoff: NonNullable<ChatImportTask["handoff"]>
  onChange: () => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [recipient, setRecipient] = useState(handoff.recipient ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const href = importTaskHref({
    taskId,
    companyId: scope.companyId,
    view: "sources",
  })
  const directory = useImportHandoffRecipients(scope, taskId, handoff.canManage)
  const validRecipient = directory.selected(recipient)
  const update = async (next: string | null) => {
    if (disabled || request.current) return
    const current = new AbortController()
    request.current = current
    setBusy(true)
    setError(false)
    try {
      const result = await apiFetch(`/api/import-tasks/${taskId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: scope.companyId,
          recipient: next,
          expectedRevision: handoff.revision,
        }),
        signal: current.signal,
      })
      if (!result.ok) throw new Error("handoff rejected")
      if (!current.signal.aborted) onChange()
    } catch {
      if (!current.signal.aborted) setError(true)
    } finally {
      if (!current.signal.aborted) {
        request.current = null
        setBusy(false)
      }
    }
  }
  const share = (event: FormEvent) => {
    event.preventDefault()
    if (validRecipient && validRecipient !== scope.identity)
      void update(validRecipient)
  }

  return (
    <section
      className="space-y-2 rounded-lg border p-3 text-sm"
      aria-label={t("settings.importHandoff.title")}
    >
      <h3 className="font-medium">{t("settings.importHandoff.title")}</h3>
      {!handoff.canManage ? (
        <p>{t("settings.importHandoff.received")}</p>
      ) : (
        <>
          <p>{t("settings.importHandoff.description")}</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={share}>
            <div className="min-w-0 flex-1 basis-60">
              <ImportHandoffRecipientPicker
                directory={directory}
                value={recipient}
                onValueChange={setRecipient}
                disabled={busy || disabled}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={
                disabled ||
                busy ||
                !validRecipient ||
                validRecipient === scope.identity ||
                validRecipient === handoff.recipient
              }
            >
              {t("settings.importHandoff.share")}
            </Button>
          </form>
          {handoff.recipient && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(new URL(href, window.location.origin).href)
                    .then(() => setCopied(true))
                    .catch(() => setError(true))
                }}
              >
                {t(
                  copied
                    ? "settings.importHandoff.copied"
                    : "settings.importHandoff.copyLink",
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || disabled}
                onClick={() => void update(null)}
              >
                {t("settings.importHandoff.revoke")}
              </Button>
            </div>
          )}
          {error ? (
            <p role="alert" className="text-destructive">
              {t("settings.importHandoff.error")}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
