"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  getAssistantCapability,
  type AssistantAction,
} from "@lumiere/query-hooks/assistant-actions"
import { Button } from "../components/button"
import type { ChatNativeActionOutcome } from "../lib/ai-chat-types"
import { AssistantActionCard } from "./assistant-action-card"

const destinationLabels: Record<string, string> = {
  approvals: "aiChat.native.approvals",
  products: "inventory.products.title",
  warehouse: "modules.tabGroups.warehouse",
}

const descriptionKeys: Record<AssistantAction["kind"], string> = {
  navigate: "aiChat.native.viewHint",
  open_record: "aiChat.native.recordHint",
  open_form: "aiChat.native.formHint",
  prepare_workflow: "aiChat.native.workflowHint",
  edit_page: "aiChat.native.editorHint",
  add_widget: "aiChat.native.widgetHint",
}

export type NativeActionPresentation =
  | Exclude<ChatNativeActionOutcome, "requested">
  | "opening"
  | "failed"

/** Opens an existing ERP surface. The host revalidates scope and native permissions. */
export function AiNativeActionCard({
  action,
  label,
  onOpen,
  presentation,
}: {
  action: AssistantAction
  label: string
  onOpen?: (
    action: AssistantAction,
  ) => ChatNativeActionOutcome | void | Promise<ChatNativeActionOutcome | void>
  presentation?: {
    state?: NativeActionPresentation
    onChange: (state?: NativeActionPresentation) => void
  }
}) {
  const { t } = useTranslation()
  const inFlight = useRef(false)
  const [localState, setLocalState] = useState<NativeActionPresentation>()
  const outcome = presentation ? presentation.state : localState
  const busy = outcome === "opening"
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
    setLocalState(undefined)
  }, [actionKey])

  const open = async () => {
    if (!onOpen || busy || inFlight.current) return
    const update = (state?: NativeActionPresentation) => {
      if (presentation) presentation.onChange(state)
      else if (mounted.current && currentActionKey.current === actionKey)
        setLocalState(state)
    }
    inFlight.current = true
    update("opening")
    try {
      const result = await onOpen(action)
      update(result === "requested" ? undefined : result || undefined)
    } catch {
      update("failed")
    } finally {
      if (currentActionKey.current === actionKey) inFlight.current = false
    }
  }

  const capability = getAssistantCapability(action.capabilityKey)
  const destination =
    capability &&
    t(destinationLabels[capability.module] ?? `nav.${capability.module}`, {
      defaultValue:
        capability.module.charAt(0).toUpperCase() + capability.module.slice(1),
    })
  const status = busy
    ? { label: t("aiChat.native.opening"), tone: "working" as const }
    : outcome === "opened" || outcome === "editor_opened"
      ? {
          label: t(
            outcome === "opened"
              ? "aiChat.native.formOpenedStatus"
              : "aiChat.native.editorOpenedStatus",
          ),
          tone: "success" as const,
        }
      : outcome === "cancelled"
        ? {
            label: t("aiChat.native.openCancelled", {
              defaultValue: "Opening cancelled",
            }),
          }
        : undefined
  const errorKey =
    outcome === "busy"
      ? action.kind === "open_form"
        ? "aiChat.native.formBusy"
        : "aiChat.native.pageBusy"
      : outcome === "denied"
        ? "aiChat.native.denied"
        : outcome === "scope_changed"
          ? "aiChat.native.scopeChanged"
          : outcome === "unavailable" || outcome === "failed"
            ? "aiChat.native.openFailed"
            : undefined

  return (
    <AssistantActionCard
      title={destination ?? t("aiChat.native.proposed")}
      status={status}
      description={t(descriptionKeys[action.kind])}
      busy={busy}
      testId="assistant-native-action"
      primaryAction={
        <Button
          type="button"
          variant="outline"
          disabled={!onOpen || busy}
          onClick={() => void open()}
          className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left"
        >
          {label}
        </Button>
      }
    >
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey)}
        </p>
      ) : null}
    </AssistantActionCard>
  )
}
