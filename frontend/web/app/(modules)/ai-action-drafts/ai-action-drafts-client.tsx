"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { DashboardHeader, MissingOrganization, AiActionDraftCard } from "@lumiere/ui"
import {
  aiActionDraftRowToPayload,
  fetchAiActionDraftPayload,
  useAiActionDraftInbox,
  useAiActionDraftNotifications,
  useApproveAiActionDraft,
  useExpireAiActionDrafts,
  useRejectAiActionDraft,
  useUpdateAiActionDraftParams,
} from "@lumiere/query-hooks/hooks/ai-action-drafts"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import type { ChatActionDraftPayload } from "@lumiere/ui"
import { phCapture } from "@/lib/posthog-browser"
import { GitBranch, Loader2 } from "lucide-react"

function hasValidOrganizationId(value?: number): value is number {
  return value != null && value > 0
}

export function AiActionDraftsClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <AiActionDraftsLoaded organizationId={organizationId} />
}

function AiActionDraftsLoaded({ organizationId }: { organizationId: number }) {
  const { identity } = useErpSession()
  const operatingCompanyId = useOperatingCompanyId(organizationId)

  const scopeKey = JSON.stringify([identity, organizationId, operatingCompanyId])
  const inboxQuery = useAiActionDraftInbox(organizationId, Boolean(identity) && operatingCompanyId != null, scopeKey)
  const notificationsQuery = useAiActionDraftNotifications(organizationId, operatingCompanyId != null)
  const expireDrafts = useExpireAiActionDrafts(organizationId, operatingCompanyId ?? 0)
  const approveDraft = useApproveAiActionDraft(organizationId, operatingCompanyId ?? 0)
  const rejectDraft = useRejectAiActionDraft(organizationId, operatingCompanyId ?? 0)
  const updateDraft = useUpdateAiActionDraftParams(organizationId, operatingCompanyId ?? 0)

  const currentScope = useRef(scopeKey)
  currentScope.current = scopeKey
  const [draftState, setDraftState] = useState<{ scopeKey: string; rows: Record<number, ChatActionDraftPayload> }>({ scopeKey, rows: {} })

  useEffect(() => {
    if (operatingCompanyId == null || operatingCompanyId <= 0) return
    expireDrafts.mutate()
  }, [operatingCompanyId, organizationId])

  useEffect(() => {
    const next: Record<number, ChatActionDraftPayload> = {}
    for (const row of inboxQuery.data ?? []) {
      if (String(row.companyId) !== String(operatingCompanyId)) continue
      const payload = aiActionDraftRowToPayload(row)
      next[payload.draftId] = payload
    }
    setDraftState(previous => ({
      scopeKey,
      rows: {
        ...next,
        ...(previous.scopeKey === scopeKey ? Object.fromEntries(Object.entries(previous.rows).filter(([, draft]) => draft.companyId === operatingCompanyId && draft.status !== "pending")) : {}),
      },
    }))
  }, [inboxQuery.data, operatingCompanyId, scopeKey])

  const displayDrafts = useMemo(
    () =>
      (draftState.scopeKey === scopeKey ? Object.values(draftState.rows) : []).sort((a, b) => {
        if (a.elevated !== b.elevated) return a.elevated ? -1 : 1
        return b.draftId - a.draftId
      }),
    [draftState, scopeKey],
  )

  const pendingCount = displayDrafts.filter(draft => draft.status === "pending").length

  const patchDraft = (draftId: number, patch: Partial<ChatActionDraftPayload>) => {
    if (currentScope.current !== scopeKey) return
    setDraftState((prev) => {
      const current = prev.rows[draftId]
      if (prev.scopeKey !== scopeKey || !current) return prev
      return { ...prev, rows: { ...prev.rows, [draftId]: { ...current, ...patch } } }
    })
  }

  return (
    <div className="space-y-6" data-testid="module-view-ai-action-drafts">
      <DashboardHeader
        title="AI Action Approvals"
        description="Review pending AI-proposed ERP mutations before they execute. Elevated drafts require a different approver than the proposer."
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {pendingCount} pending draft{pendingCount === 1 ? "" : "s"}
        </span>
        {inboxQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <Link
          href="/workflows"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <GitBranch className="h-3.5 w-3.5" />
          Workflow definitions
        </Link>
        <Link href="/messages" className="text-primary hover:underline">
          Messages ({notificationsQuery.data?.length ?? 0} draft alerts)
        </Link>
      </div>

      {(notificationsQuery.data?.length ?? 0) > 0 ? (
        <p className="text-sm text-muted-foreground">
          In-app and email notifications were posted to the Messages feed for pending drafts.
        </p>
      ) : null}

      {inboxQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading approval inbox…
        </div>
      ) : null}

      {inboxQuery.isError ? (
        <p className="text-sm text-destructive">
          {inboxQuery.error instanceof Error
            ? inboxQuery.error.message
            : "Unable to load approval inbox"}
        </p>
      ) : null}

      {expireDrafts.isError ? (
        <p className="text-sm text-destructive">
          {expireDrafts.error instanceof Error
            ? expireDrafts.error.message
            : "Unable to expire stale drafts"}
        </p>
      ) : null}

      {!inboxQuery.isLoading && displayDrafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No pending AI action drafts. Ask the ERP Assistant to propose a task or order, then return
          here to approve it.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {displayDrafts.map((draft) => (
          <div key={draft.draftId} className="space-y-2">
            {draft.workflowInstanceId ? (
              <Link
                href={`/workflows?tab=instances&instance=${draft.workflowInstanceId}`}
                className="inline-flex text-xs text-primary hover:underline"
              >
                Workflow instance #{draft.workflowInstanceId}
              </Link>
            ) : null}
            <AiActionDraftCard
            draft={draft}
            scopeKey={identity ? scopeKey : undefined}
            onRefresh={async (nextDraft) => {
              if (!operatingCompanyId) throw new Error("Choose a company before checking the draft")
              const observed = await fetchAiActionDraftPayload(organizationId, operatingCompanyId, nextDraft.draftId)
              if (currentScope.current !== scopeKey) throw new Error("The company changed. Reopen the draft.")
              patchDraft(nextDraft.draftId, observed)
              return observed
            }}
            onApprove={async (nextDraft) => {
              const observed = await approveDraft.mutateAsync({
                draftId: nextDraft.draftId,
                companyId: nextDraft.companyId ?? draft.companyId,
              })
              if (currentScope.current !== scopeKey) return
              if (observed.status === "approved") phCapture("ai_action_draft_approved", {
                reducer: nextDraft.reducerName,
              })
              patchDraft(nextDraft.draftId, observed)
            }}
            onReject={async (nextDraft, reason) => {
              const observed = await rejectDraft.mutateAsync({
                draftId: nextDraft.draftId,
                reason,
                companyId: nextDraft.companyId ?? draft.companyId,
              })
              patchDraft(nextDraft.draftId, observed)
            }}
            onUpdateDraft={async (nextDraft) => {
              const observed = await updateDraft.mutateAsync({
                draftId: nextDraft.draftId,
                paramsJson: JSON.stringify(nextDraft.paramsJson),
                summary: nextDraft.summary,
                companyId: nextDraft.companyId ?? draft.companyId,
              })
              patchDraft(nextDraft.draftId, observed)
            }}
          />
          </div>
        ))}
      </div>
    </div>
  )
}
