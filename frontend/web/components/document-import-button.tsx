"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { apiFetch } from "../lib/api-fetch"
import {
  openDocumentImportTask,
  type DocumentImportSource,
} from "../lib/document-import-source"
import { importTaskHref } from "../lib/import-task-navigation"

export function DocumentImportButton({
  companyId,
  source,
  onOpenTask,
}: {
  companyId: number
  source: DocumentImportSource
  onOpenTask?: (requestId: string) => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const attempt = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => attempt.current?.abort(), [])

  const open = async () => {
    if (attempt.current) return
    const controller = new AbortController()
    attempt.current = controller
    setBusy(true)
    setError(null)
    try {
      const task = await openDocumentImportTask(
        apiFetch,
        companyId,
        source,
        controller.signal,
      )
      if (!controller.signal.aborted) {
        if (onOpenTask) {
          onOpenTask(task.requestId)
          return
        }
        router.push(
          importTaskHref({
            companyId,
            taskId: task.requestId,
            view: "sources",
          }),
        )
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (!controller.signal.aborted) {
        attempt.current = null
        setBusy(false)
      }
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void open()}
      >
        {busy
          ? t("documents.page.openingImport", {
              defaultValue: "Opening import…",
            })
          : t("documents.page.openImport", { defaultValue: "Open import" })}
      </Button>
      {error ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
