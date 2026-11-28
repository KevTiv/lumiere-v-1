"use client"

import { useId } from "react"
import { useQuery } from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Label } from "@lumiere/ui/components/label"
import { RecordPicker } from "@lumiere/ui/components/record-picker"

import { apiFetch } from "./api-fetch"
import { personIdentity, selectedPerson, type PersonOption } from "./authorized-people"
import type { SavedImportScope } from "./use-saved-import-task"

export function parseImportHandoffRecipients(value: unknown, actor: string): readonly PersonOption[] {
  if (!value || typeof value !== "object" || !("recipients" in value) || !Array.isArray(value.recipients)) {
    throw new Error("Incomplete handoff recipient directory")
  }

  const actorIdentity = personIdentity(actor)
  if (!actorIdentity) throw new Error("Invalid handoff actor")
  const recipients = new Map<string, PersonOption>()
  for (const row of value.recipients as unknown[]) {
    if (!row || typeof row !== "object" || !("value" in row) || !("label" in row)) {
      throw new Error("Invalid handoff recipient")
    }
    const identity = personIdentity(row.value)
    const label = typeof row.label === "string" ? row.label.trim() : ""
    if (!identity || !label || personIdentity(label) || identity === actorIdentity || recipients.has(identity)) {
      throw new Error("Invalid handoff recipient")
    }
    recipients.set(identity, { value: identity, label })
  }
  return [...recipients.values()]
}

type RecipientStatus = "loading" | "denied" | "error" | "ready"

export function useImportHandoffRecipients(scope: SavedImportScope, taskId: string, enabled: boolean) {
  const session = useErpSession()
  const inScope = session.activeCompanyReady === true && Boolean(personIdentity(scope.identity))
    && personIdentity(session.identity) === personIdentity(scope.identity)
    && session.organizationId === scope.organizationId && session.activeCompanyId === scope.companyId
    && /^[0-9a-f]{32}$/.test(taskId)

  const query = useQuery({
    queryKey: ["import-handoff-recipients", scope.identity, scope.organizationId, scope.companyId, taskId],
    enabled: enabled && inScope,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(
        `/api/import-tasks/${encodeURIComponent(taskId)}/handoff?companyId=${scope.companyId}`,
        { signal, cache: "no-store" },
      )
      if (response.status === 401 || response.status === 403 || response.status === 404) return null
      if (!response.ok) throw new Error("Handoff recipients could not be loaded")
      return parseImportHandoffRecipients(await response.json(), scope.identity)
    },
  })
  const status: RecipientStatus = !enabled || !inScope || query.data === null ? "denied"
    : query.isError ? "error"
      : query.isFetching || query.isPending ? "loading"
        : "ready"
  const options = status === "ready" ? query.data ?? [] : []
  return {
    status,
    options,
    selected: (value: unknown) => selectedPerson(value, options),
    retry: () => {
      if (enabled && inScope) void query.refetch()
    },
  }
}

export function ImportHandoffRecipientPicker({
  directory,
  value,
  onValueChange,
  disabled,
}: {
  directory: ReturnType<typeof useImportHandoffRecipients>
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const hintId = `${id}-status`
  const { status, options } = directory
  const hint = status === "loading" ? t("settings.importHandoff.recipientsLoading")
    : status === "denied" ? t("settings.importHandoff.recipientsDenied")
      : status === "error" ? t("settings.importHandoff.recipientsError")
        : !options.length ? t("settings.importHandoff.noRecipients") : null

  return (
    <div className="min-w-0 flex-1 basis-60 space-y-2">
      <Label htmlFor={id}>{t("settings.importHandoff.recipient")}</Label>
      <RecordPicker
        id={id}
        data-testid="import-handoff-recipient"
        aria-describedby={hint ? hintId : undefined}
        value={directory.selected(value) ?? ""}
        onChange={(next) => {
          const recipient = directory.selected(next)
          if (recipient) onValueChange(recipient)
        }}
        options={options}
        placeholder={t("settings.importHandoff.chooseRecipient")}
        searchPlaceholder={t("settings.importHandoff.searchRecipients")}
        emptyText={t("settings.importHandoff.noRecipients")}
        disabled={disabled || status !== "ready" || options.length === 0}
      />
      {hint && <p id={hintId} role={status === "error" ? "alert" : "status"} className="text-muted-foreground">{hint}</p>}
      {status === "error" && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={directory.retry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  )
}
