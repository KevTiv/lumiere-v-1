"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { FileUploadField } from "@lumiere/ui/components/file-upload-field"
import { Button } from "@lumiere/ui/components/button"
import { apiFetch } from "./api-fetch"
import {
  recoverChatImportPointer,
  submitChatImportFiles,
  type ChatImportPointer,
  type ChatImportScope,
} from "./chat-import-task"
import type { SavedImportScope } from "./use-saved-import-task"
import type { ImportPreparation } from "./import-preparation"

/** The Settings entry point saves the same original-file task as chat before any interpretation. */
export function SavedImportTaskIntake({
  scope,
  onSaved,
  available,
  preparation,
}: {
  scope: SavedImportScope
  onSaved: (id: string) => void
  available: boolean
  preparation?: ImportPreparation
}) {
  const { t } = useTranslation()
  const limitsId = useId()
  const taskScope = useMemo<ChatImportScope>(
    () => ({ ...scope, conversationKey: "imports-workspace" }),
    [scope],
  )
  const mounted = useRef(false)
  const running = useRef(false)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pointer, setPointer] = useState<ChatImportPointer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useCallback(() => mounted.current, [])
  const check = useCallback(async () => {
    if (!current() || running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const recovered = await recoverChatImportPointer({
        scope: taskScope,
        storage: window.localStorage,
        fetcher: apiFetch,
        isCurrent: current,
      })
      if (!current()) return
      setPointer(recovered.pointer)
      setReady(true)
      if (recovered.task) onSavedRef.current(recovered.task.requestId)
    } catch (failure) {
      if (current()) {
        setReady(false)
        setError(
          failure instanceof Error
            ? failure.message
            : "The previous upload could not be checked.",
        )
      }
    } finally {
      running.current = false
      if (current()) setBusy(false)
    }
  }, [taskScope, current])
  useEffect(() => {
    mounted.current = true
    if (available) void check()
    return () => {
      mounted.current = false
    }
  }, [available, check])
  const upload = async (files: File[]) => {
    if (!available || !ready || !current() || running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const task = await submitChatImportFiles({
        files,
        scope: taskScope,
        storage: window.localStorage,
        fetcher: apiFetch,
        isCurrent: current,
        preparation,
      })
      if (current()) {
        setPointer(null)
        onSavedRef.current(task.requestId)
      }
    } catch (failure) {
      if (current())
        setError(
          failure instanceof Error
            ? failure.message
            : "The upload could not be saved.",
        )
    } finally {
      running.current = false
      if (current()) setBusy(false)
    }
  }
  return (
    <section
      id="start-import"
      tabIndex={-1}
      className="min-w-0 scroll-mt-6 space-y-3 rounded-lg border p-4"
      aria-busy={busy}
    >
      <h2 className="font-semibold">
        {t("settings.importTask.start", {
          defaultValue: "Start a saved import",
        })}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("settings.importTask.startHint", {
          defaultValue:
            "Save your original CSV or Excel files, then choose inspection or import preparation. You can return to the same task from any device.",
        })}
      </p>
      <FileUploadField
        multiple
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={!available || busy || !ready}
        chooseLabel={t("settings.importTask.chooseFiles", {
          defaultValue: "Upload source files",
        })}
        aria-describedby={limitsId}
        onSelect={(files) => {
          if (files.length) void upload(files)
        }}
      />
      <p id={limitsId} className="text-sm text-muted-foreground">
        {t("settings.importTask.uploadLimits", {
          defaultValue:
            "Up to 20 files, 5 MB each and 20 MB combined. Original files stay attached to the saved task.",
        })}
      </p>
      {busy ? (
        <p role="status" className="text-sm">
          {t("settings.importTask.saving", {
            defaultValue: "Saving files or checking their saved receipt…",
          })}
        </p>
      ) : null}
      {pointer ? (
        <p className="text-sm">
          {t("aiChat.import.uncertain", {
            defaultValue:
              "An upload has no confirmed result yet. Check again, or select the same original files in the same order to retry its saved request.",
          })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {pointer || error ? (
        <Button
          type="button"
          variant="outline"
          disabled={!available || busy}
          onClick={() => void check()}
        >
          {t("aiChat.import.check", { defaultValue: "Check saved imports" })}
        </Button>
      ) : null}
    </section>
  )
}
