"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newProposalForm,
  editProposalForm,
  proposalsTableConfig,
  MissingOrganization,
  mergeFieldDefaultValues,
} from "@lumiere/ui"
import type { EntityAction, FormConfig, ModuleConfig } from "@lumiere/ui"
import { proposalsModuleConfig } from "@/lib/module-dashboard-configs"
import { useProposalsModuleSubscription } from "@/lib/module-subscription-hooks"
import { proposalPrimaryLabel } from "@lumiere/stdb/read-models"
import {
  useProposals,
  useCreateProposal,
  useUpdateProposal,
  useUpdateProposalStatus,
} from "@lumiere/query-hooks/hooks/proposals"
import { fetchQueryList, rqBigIntKey } from "@lumiere/query-hooks/http"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  Archive,
  Award,
  Eye,
  Pencil,
  Send,
  ThumbsDown,
} from "lucide-react"

interface ProposalsClientProps {
  initialProposals?: Record<string, unknown>[]
  organizationId?: number
}

type ProposalsClientLoadedProps = Omit<ProposalsClientProps, "organizationId"> & {
  organizationId: number
}

const BUILTIN_PROPOSAL_TEMPLATES: Record<string, unknown>[] = [
  {
    id: "tpl-commercial",
    name: "Commercial Proposal",
    category: "Commercial",
    sectionCount: 5,
    description: "Executive summary, scope, timeline, pricing, and terms",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-tender",
    name: "Tender Response",
    category: "Tender",
    sectionCount: 7,
    description: "Compliance matrix, methodology, team, and bid pricing",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-grant",
    name: "Grant Application",
    category: "Grant",
    sectionCount: 6,
    description: "Need statement, outcomes, budget, and evaluation criteria",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
]

function normalizeProposalStatus(raw: unknown): string {
  const s = String(raw ?? "")
  if (s.includes("Draft") || s === "draft") return "Draft"
  if (s.includes("Review") || s === "review") return "Review"
  if (s.includes("Submitted") || s === "submitted") return "Submitted"
  if (s.includes("Awarded") || s === "awarded") return "Awarded"
  if (s.includes("Rejected") || s === "rejected") return "Rejected"
  if (s.includes("Archived") || s === "archived") return "Archived"
  return s || "Draft"
}

function proposalFieldValue(row: Record<string, unknown>, fieldName: string): unknown {
  switch (fieldName) {
    case "title":
      return row.title ?? ""
    case "clientName":
      return row.clientName ?? row.client_name ?? ""
    case "value":
      return row.value ?? 0
    case "deadline":
      if (row.deadline == null) return ""
      if (typeof row.deadline === "string") return row.deadline.split("T")[0]
      return new Date(Number(row.deadline) / 1000).toISOString().split("T")[0]
    case "description":
      return row.description ?? ""
    default:
      return ""
  }
}

export function ProposalsClient(props: ProposalsClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <ProposalsClientLoaded {...props} organizationId={props.organizationId} />
}

function ProposalsClientLoaded({ initialProposals, organizationId }: ProposalsClientLoadedProps) {
  useProposalsModuleSubscription()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => proposalsModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null)
  const [activeTab, setActiveTab] = useState<string>("dashboard")

  const { data: proposals = [] } = useProposals(orgId, initialProposals)
  const createProposal = useCreateProposal()
  const updateProposal = useUpdateProposal()
  const updateProposalStatus = useUpdateProposalStatus()

  const isPending =
    createProposal.isPending || updateProposal.isPending || updateProposalStatus.isPending

  const activeCount = proposals.filter((p) => {
    const s = normalizeProposalStatus(p.status)
    return s === "Draft" || s === "Review" || s === "Submitted"
  }).length
  const awardedCount = proposals.filter((p) => normalizeProposalStatus(p.status) === "Awarded").length
  const submittedCount = proposals.filter((p) => normalizeProposalStatus(p.status) === "Submitted").length
  const pipelineValue = proposals
    .filter((p) => {
      const s = normalizeProposalStatus(p.status)
      return s !== "Rejected" && s !== "Archived"
    })
    .reduce((sum, p) => sum + Number(p.value ?? 0), 0)

  const setStatus = useCallback(
    async (proposalId: string | number | bigint, status: string) => {
      await updateProposalStatus.mutateAsync({ proposalId, status })
    },
    [updateProposalStatus],
  )

  const proposalRowActions = useMemo((): EntityAction[] => {
    return [
      {
        id: "edit-proposal",
        label: t("proposals.actions.edit"),
        icon: Pencil,
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (row) setEditRow(row)
        },
      },
      {
        id: "submit-review",
        label: t("proposals.actions.submitForReview"),
        icon: Eye,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row?.id || normalizeProposalStatus(row.status) !== "Draft") return
          void setStatus(row.id as string | number, "Review")
        },
      },
      {
        id: "submit-proposal",
        label: t("proposals.actions.submit"),
        icon: Send,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row?.id || normalizeProposalStatus(row.status) !== "Review") return
          void setStatus(row.id as string | number, "Submitted")
        },
      },
      {
        id: "award-proposal",
        label: t("proposals.actions.award"),
        icon: Award,
        variant: "default",
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row?.id || normalizeProposalStatus(row.status) !== "Submitted") return
          void setStatus(row.id as string | number, "Awarded")
        },
      },
      {
        id: "reject-proposal",
        label: t("proposals.actions.reject"),
        icon: ThumbsDown,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row?.id) return
          const s = normalizeProposalStatus(row.status)
          if (s === "Rejected" || s === "Archived") return
          void setStatus(row.id as string | number, "Rejected")
        },
      },
      {
        id: "archive-proposal",
        label: t("proposals.actions.archive"),
        icon: Archive,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row?.id) return
          const s = normalizeProposalStatus(row.status)
          if (s === "Archived") return
          if (s !== "Awarded" && s !== "Rejected") return
          void setStatus(row.id as string | number, "Archived")
        },
      },
    ]
  }, [t, setStatus])

  const editFormConfig = useMemo((): FormConfig | null => {
    if (!editRow) return null
    const base = editProposalForm(t)
    const defaults: Record<string, unknown> = {}
    for (const section of base.sections) {
      for (const field of section.fields) {
        defaults[field.name] = proposalFieldValue(editRow, field.name)
      }
    }
    return mergeFieldDefaultValues(base, defaults)
  }, [editRow, t])

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
            use_template: () => setActiveTab("templates"),
            import_rfp: () => setQuickActionForm({ form: newProposalForm(t), action: "createProposal" }),
            review_pending: () => {
              const pending = proposals.find((p) => normalizeProposalStatus(p.status) === "Review")
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
    (): ModuleConfig => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) => {
        if (tab.id === "dashboard") return { ...tab, sections: liveSections }
        if (tab.id === "proposals" && tab.type === "entity") {
          return {
            ...tab,
            entityConfig: proposalsTableConfig(t, {
              formatProposalDisplayName: proposalPrimaryLabel,
              actions: proposalRowActions,
            }),
          }
        }
        return tab
      }),
    }),
    [liveSections, moduleConfig, proposalRowActions, t],
  )

  const data = useMemo(
    () => ({
      proposals: proposals as unknown as Record<string, unknown>[],
      templates: BUILTIN_PROPOSAL_TEMPLATES,
    }),
    [proposals],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createProposal") {
      const title = String(formData.title ?? "").trim()
      if (!title) return
      const descriptionRaw = formData.description != null ? String(formData.description).trim() : ""
      await createProposal.mutateAsync({
        organizationId: orgId,
        title,
        clientName: String(formData.clientName ?? "").trim(),
        type: String(formData.type ?? ""),
        value: Number(formData.value ?? 0),
        deadline: formData.deadline ? new Date(String(formData.deadline)) : undefined,
        description: descriptionRaw || undefined,
      })

      let created: Record<string, unknown> | undefined
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const rows = await queryClient.fetchQuery({
          queryKey: ["proposals", rqBigIntKey(orgId)],
          queryFn: () => fetchQueryList("/api/query/proposals", "Failed to fetch proposals"),
        })
        created = [...rows]
          .filter((row) => String(row.title ?? "") === title)
          .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0]
        if (created?.id != null) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      if (created?.id == null) {
        throw new Error(`Proposal "${title}" was created but did not appear in the proposals query`)
      }

      router.push(
        `/proposals/${String(created.id)}?title=${encodeURIComponent(title)}&orgId=${organizationId}`,
      )
      return
    }
    if (action === "updateProposal" && editRow?.id != null) {
      await updateProposal.mutateAsync({
        proposalId: editRow.id as string | number,
        title: String(formData.title ?? "").trim(),
        clientName: String(formData.clientName ?? "").trim(),
        value: Number(formData.value ?? 0),
        deadline: formData.deadline ? String(formData.deadline) : null,
        description: formData.description != null ? String(formData.description) : null,
      })
      setEditRow(null)
    }
  }

  const handleRowClick = (_tabId: string, row: Record<string, unknown>) => {
    const title = encodeURIComponent(String(row.title ?? ""))
    router.push(`/proposals/${row.id}?title=${title}&orgId=${organizationId}`)
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        isPending={isPending}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleRowClick}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newProposalForm(t)}
        isPending={isPending}
        onSubmit={async (formData) => {
          if (quickActionForm) await handleFormSubmit("dashboard", quickActionForm.action, formData)
        }}
      />
      {editFormConfig ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setEditRow(null)}
          config={editFormConfig}
          isPending={isPending}
          onSubmit={async (formData) => handleFormSubmit("proposals", "updateProposal", formData)}
        />
      ) : null}
    </>
  )
}
