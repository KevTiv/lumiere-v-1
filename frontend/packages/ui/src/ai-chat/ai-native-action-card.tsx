"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { AssistantAction } from "@lumiere/query-hooks/assistant-actions"
import { Button } from "../components/button"

/** Opens an existing ERP surface. The host revalidates scope and native permissions. */
export function AiNativeActionCard({
  action,
  label,
  onOpen,
}: {
  action: AssistantAction
  label: string
  onOpen?: (action: AssistantAction) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const actionKey = JSON.stringify(action)
  const currentActionKey = useRef(actionKey)
  currentActionKey.current = actionKey
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    inFlight.current = false
    setBusy(false)
    setFailed(false)
  }, [actionKey])

  const open = async () => {
    if (!onOpen || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFailed(false)
    try {
      await onOpen(action)
    } catch {
      if (mounted.current && currentActionKey.current === actionKey)
        setFailed(true)
    } finally {
      if (mounted.current && currentActionKey.current === actionKey) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }

  return (
    <div
      className="min-w-0 rounded-lg border border-border p-3"
      data-testid="assistant-native-action"
    >
      <Button
        type="button"
        variant="outline"
        disabled={!onOpen || busy}
        onClick={() => void open()}
        className="max-w-full whitespace-normal text-left"
      >
        {busy ? t("aiChat.native.opening") : label}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("aiChat.native.reviewHint")}
      </p>
      {failed ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t("aiChat.native.openFailed")}
        </p>
      ) : null}
    </div>
  )
}
