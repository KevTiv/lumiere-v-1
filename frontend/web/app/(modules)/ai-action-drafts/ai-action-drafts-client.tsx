"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { DashboardHeader, MissingOrganization, AiActionDraftCard } from "@lumiere/ui"
import {
  aiActionDraftRowToPayload,
  useAiActionDraftInbox,
  useAiActionDraftNotifications,
  useApproveAiActionDraft,
  useExpireAiActionDrafts,
  useRejectAiActionDraft,
  useUpdateAiActionDraftParams,
} from "@lumiere/query-hooks/hooks/ai-action-drafts"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import type { ChatActionDraftPayload } from "@lumiere/ui"
import { GitBranch, Loader2 } from "lucide-react"

function hasValidOrganizationId(value?: number): value is number {
  return value != null && value > 0
}

export function AiActionDraftsClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <AiActionDraftsLoaded organizationId={organizationId} />
}

function AiActionDraftsLoaded({ organizationId }: { organizationId: number }) {
  const operatingCompanyId = useOperatingCompanyId(organizationId)

  const inboxQuery = useAiActionDraftInbox(organizationId, operatingCompanyId != null)
  const notificationsQuery = useAiActionDraftNotifications(organizationId, operatingCompanyId != null)
  const expireDrafts = useExpireAiActionDrafts(organizationId, operatingCompanyId ?? 0)
  const approveDraft = useApproveAiActionDraft(organizationId, operatingCompanyId ?? 0)
  const rejectDraft = useRejectAiActionDraft(organizationId, operatingCompanyId ?? 0)
  const updateDraft = useUpdateAiActionDraftParams(organizationId, operatingCompanyId ?? 0)

  const [draftStates, setDraftStates] = useState<Record<number, ChatActionDraftPayload>>({})

  useEffect(() => {
    if (operatingCompanyId == null || operatingCompanyId <= 0) return
    void expireDrafts.mutate()
  }, [operatingCompanyId, organizationId])

  useEffect(() => {
    const next: Record<number, ChatActionDraftPayload> = {}
    for (const row of inboxQuery.data ?? []) {
      const payload = aiActionDraftRowToPayload(row)
      next[payload.draftId] = payload
    }
    setDraftStates(next)
  }, [inboxQuery.data])

  const pendingDrafts = useMemo(
    () =>
      Object.values(draftStates).sort((a, b) => {
        if (a.elevated !== b.elevated) return a.elevated ? -1 : 1
        return b.draftId - a.draftId
      }),
    [draftStates],
  )

  const patchDraft = (draftId: number, patch: Partial<ChatActionDraftPayload>) => {
    setDraftStates((prev) => {
      const current = prev[draftId]
      if (!current) return prev
      return { ...prev, [draftId]: { ...current, ...patch } }
    })
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="AI Action Approvals"
        description="Review pending AI-proposed ERP mutations before they execute. Elevated drafts require a different approver than the proposer."
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {pendingDrafts.length} pending draft{pendingDrafts.length === 1 ? "" : "s"}
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

      {!inboxQuery.isLoading && pendingDrafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No pending AI action drafts. Ask the ERP Assistant to propose a task or order, then return
          here to approve it.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {pendingDrafts.map((draft) => (
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
            onApprove={async (nextDraft) => {
              await approveDraft.mutateAsync({
                draftId: nextDraft.draftId,
                companyId: nextDraft.companyId ?? draft.companyId,
              })
              patchDraft(nextDraft.draftId, { status: "approved" })
            }}
            onReject={async (nextDraft, reason) => {
              await rejectDraft.mutateAsync({
                draftId: nextDraft.draftId,
                reason,
                companyId: nextDraft.companyId ?? draft.companyId,
              })
              patchDraft(nextDraft.draftId, { status: "rejected" })
            }}
            onUpdateDraft={async (nextDraft) => {
              await updateDraft.mutateAsync({
                draftId: nextDraft.draftId,
                paramsJson: JSON.stringify(nextDraft.paramsJson),
                summary: nextDraft.summary,
                companyId: nextDraft.companyId ?? draft.companyId,
              })
              patchDraft(nextDraft.draftId, {
                paramsJson: nextDraft.paramsJson,
                summary: nextDraft.summary,
              })
            }}
          />
          </div>
        ))}
      </div>
    </div>
  )
}
