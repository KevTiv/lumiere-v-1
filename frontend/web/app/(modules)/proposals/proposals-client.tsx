"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newProposalForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { proposalsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useProposals,
  useCreateProposal,
  useStdbConnection,
  getStdbConnection,
  proposalsSubscriptions,
} from "@lumiere/stdb"
import type { CreateProposalParams } from "@lumiere/stdb"

interface ProposalsClientProps {
  initialProposals?: Record<string, unknown>[]
  organizationId?: number
}

export function ProposalsClient({ initialProposals, organizationId }: ProposalsClientProps) {
  const router = useRouter()
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => proposalsModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] proposals subscription error", err))
      .subscribe(proposalsSubscriptions(orgId))
  }, [connected, orgId])

  const { data: proposals = [] } = useProposals(orgId, initialProposals)
  const createProposal = useCreateProposal()

  const activeCount = proposals.filter((p) => {
    const s = String(p.status ?? "")
    return s === "Draft" || s === "Review" || s === "Submitted" || s === "draft" || s === "review" || s === "submitted"
  }).length
  const awardedCount = proposals.filter((p) => String(p.status ?? "") === "Awarded" || String(p.status ?? "") === "awarded").length
  const submittedCount = proposals.filter((p) => String(p.status ?? "") === "Submitted" || String(p.status ?? "") === "submitted").length
  const pipelineValue = proposals
    .filter((p) => {
      const s = String(p.status ?? "")
      return s !== "Rejected" && s !== "Archived" && s !== "rejected" && s !== "archived"
    })
    .reduce((sum, p) => sum + Number(p.value ?? 0), 0)

  const liveSections = useMemo(() => {
    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Active Proposals", value: String(activeCount), icon: "ClipboardList" },
                { label: "Submitted", value: String(submittedCount), icon: "Send" },
                { label: "Awarded", value: String(awardedCount), icon: "Award" },
                {
                  label: "Pipeline Value",
                  value: `$${(pipelineValue / 1000).toFixed(0)}k`,
                  icon: "TrendingUp",
                },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_proposal: () => setQuickActionForm({ form: newProposalForm(t), action: "createProposal" }),
            use_template: () => setQuickActionForm({ form: newProposalForm(t), action: "createProposal" }),
            import_rfp: () => setQuickActionForm({ form: newProposalForm(t), action: "createProposal" }),
            review_pending: () => {
              const pending = proposals.find((p) => {
                const s = String(p.status ?? "")
                return s === "Review" || s === "review"
              })
              if (pending) router.push(`/proposals/${pending.id}`)
            },
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
      }),
    }))
  }, [activeCount, submittedCount, awardedCount, pipelineValue, proposals, router, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections, moduleConfig],
  )

  const data = useMemo(
    () => ({
      proposals: proposals as unknown as Record<string, unknown>[],
      templates: [] as Record<string, unknown>[],
    }),
    [proposals],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createProposal") {
      createProposal.mutate({
        organizationId: orgId,
        title: formData.title as string,
        clientName: (formData.clientName as string) ?? "",
        value: Number(formData.value ?? 0),
        deadline: formData.deadline ? new Date(formData.deadline as string) : undefined,
        description: formData.description as string | undefined,
      } as CreateProposalParams, {
        onSuccess: (_, variables) => {
          // Navigate to the new proposal — find it by title after creation
          const newId = `new-${Date.now()}`
          router.push(`/proposals/${newId}?title=${encodeURIComponent(String(variables.title ?? "New Proposal"))}`)
        },
      })
    }
  }

  const handleRowClick = (_tabId: string, row: Record<string, unknown>) => {
    router.push(`/proposals/${row.id}`)
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleRowClick}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newProposalForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
