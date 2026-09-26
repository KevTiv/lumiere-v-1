"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

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
  mergeSelectOptionsForFields,
  convertOpportunityToOrderForm,
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
  useApproveProposal,
  useConvertProposalToSaleOrder,
} from "@lumiere/query-hooks/hooks/proposals"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useWarehouses } from "@lumiere/query-hooks/hooks/inventory"
import type { Proposal } from "@lumiere/query-hooks/hooks/proposals"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { fetchQueryList, rqBigIntKey } from "@lumiere/query-hooks/http"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { currencyOptionsFromRows } from "@/lib/form-lookup"
import {
  Archive,
  Award,
  ExternalLink,
  Eye,
  FileOutput,
  Pencil,
  Send,
  ThumbsDown,
} from "lucide-react"

interface ProposalsClientProps {
  initialProposals?: Proposal[]
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
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null)
  const [convertProposalId, setConvertProposalId] = useState<string | number | null>(null)
  const [activeTab, setActiveTab] = useState<string>("dashboard")

  const { data: proposals = [] } = useProposals(orgId, initialProposals)
  const { data: currencies = [] } = useCurrencies()
  const createProposal = useCreateProposal(orgId, operatingCompanyId)
  const updateProposal = useUpdateProposal(orgId, operatingCompanyId)
  const updateProposalStatus = useUpdateProposalStatus(orgId, operatingCompanyId)
  const approveProposal = useApproveProposal(orgId, operatingCompanyId)
  const convertProposal = useConvertProposalToSaleOrder(orgId, operatingCompanyId)
  const { data: pricelists = [] } = usePricelists(orgId)
  const { data: warehouses = [] } = useWarehouses(orgId)

  const isPending =
    createProposal.isPending ||
    updateProposal.isPending ||
    updateProposalStatus.isPending ||
    approveProposal.isPending ||
    convertProposal.isPending

  const convertFormConfig = useMemo((): FormConfig => {
    const options = (rows: unknown[]) =>
      rows.map((value) => {
        const row = value as { id?: unknown; name?: unknown }
        return { value: String(row.id ?? ""), label: String(row.name ?? row.id ?? "") }
      })
    const pricelistOptions = options(pricelists)
    const warehouseOptions = options(warehouses)
    const base = mergeSelectOptionsForFields(
      { ...convertOpportunityToOrderForm(t), id: "convert-proposal-order" },
      { pricelistId: pricelistOptions, warehouseId: warehouseOptions },
    )
    const defaults: { pricelistId?: string; warehouseId?: string } = {}
    if (pricelistOptions[0]) defaults.pricelistId = pricelistOptions[0].value
    if (warehouseOptions[0]) defaults.warehouseId = warehouseOptions[0].value
    return mergeFieldDefaultValues(base, defaults)
  }, [t, pricelists, warehouses])

  const currencyOptions = useMemo(() => currencyOptionsFromRows(currencies), [currencies])
  const proposalCreateForm = useMemo(
    () => mergeSelectOptionsForFields(newProposalForm(t), { currencyId: currencyOptions }),
    [t, currencyOptions],
  )

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
  const pipelineValueLabel =
    pipelineValue > 0 ? `${(pipelineValue / 1000).toFixed(0)}k` : "…"

  const setStatus = useCallback(
    async (proposalId: string | number | bigint, status: string) => {
      await updateProposalStatus.mutateAsync({ proposalId, status })
    },
    [updateProposalStatus],
  )

  const proposalRowActions = useMemo((): EntityAction[] => {
    return [
      {
        id: "open-proposal",
        label: t("proposals.actions.open"),
        icon: ExternalLink,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row?.id) return
          const title = encodeURIComponent(String(row.title ?? ""))
          router.push(`/proposals/${row.id}?title=${title}&orgId=${organizationId}`)
        },
      },
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
          void setStatus(row.id as string | number, "review")
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
          void setStatus(row.id as string | number, "submitted")
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
          void (async () => {
            await approveProposal.mutateAsync(row.id as string | number)
            await setStatus(row.id as string | number, "awarded")
          })()
        },
      },
      {
        id: "convert-proposal-order",
        label: t("proposals.actions.convertToSaleOrder"),
        icon: FileOutput,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row?.id || normalizeProposalStatus(row.status) !== "Awarded") return
          if (row.saleOrderId != null || row.sale_order_id != null) return
          setConvertProposalId(row.id as string | number)
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
          void setStatus(row.id as string | number, "rejected")
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
          void setStatus(row.id as string | number, "archived")
        },
      },
    ]
  }, [t, setStatus, approveProposal, router, organizationId])

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
    return mapDashboardWidgets(moduleConfig, (w) => {
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
                  value: pipelineValueLabel,
                  icon: "TrendingUp",
                },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_proposal: () => setQuickActionForm({ form: proposalCreateForm, action: "createProposal" }),
            use_template: () => setActiveTab("templates"),
            // Label is "Import RFP (coming soon)" — still opens create form as a create-only shortcut
            import_rfp: () => setQuickActionForm({ form: proposalCreateForm, action: "createProposal" }),
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
          })
  }, [activeCount, submittedCount, awardedCount, pipelineValueLabel, proposals, router, moduleConfig, proposalCreateForm])

  const config = useMemo(
    (): ModuleConfig => ({
      ...moduleConfig,
      tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
        if (tab.id === "proposals" && tab.entityConfig) {
          return {
            ...tab,
            createForm: proposalCreateForm,
            entityConfig: proposalsTableConfig(t, {
              formatProposalDisplayName: proposalPrimaryLabel,
              actions: proposalRowActions,
            }),
          }
        }
        return tab
      }),
    }),
    [liveSections, moduleConfig, proposalCreateForm, proposalRowActions, t],
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
      const typeRaw = formData.type != null ? String(formData.type).trim() : ""
      const partnerRaw = formData.partnerId ?? formData.partner_id
      const currencyId = Number(formData.currencyId)
      if (!Number.isSafeInteger(currencyId) || currencyId <= 0) return
      await createProposal.mutateAsync({
        title,
        clientName: String(formData.clientName ?? "").trim(),
        currencyId,
        value: Number(formData.value ?? 0),
        deadline: formData.deadline ? new Date(String(formData.deadline)) : undefined,
        description: descriptionRaw || undefined,
        partnerId:
          partnerRaw != null && String(partnerRaw).trim() !== ""
            ? BigInt(String(partnerRaw))
            : undefined,
        metadata: typeRaw ? JSON.stringify({ type: typeRaw }) : undefined,
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

  return (
    <>
      {currencyOptions.length > 0 ? (
        <span className="sr-only" data-testid="proposal-currencies-ready">
          Currency options ready
        </span>
      ) : null}
      <ModuleView
        config={config}
        data={data}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        isPending={isPending}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? proposalCreateForm}
        isPending={isPending}
        onSubmit={async (formData) => {
          if (quickActionForm) await handleFormSubmit("dashboard", quickActionForm.action, formData)
        }}
      />
      {convertProposalId != null ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setConvertProposalId(null)}
          config={convertFormConfig}
          isPending={isPending}
          onSubmit={async (formData) => {
            await convertProposal.mutateAsync({
              proposalId: convertProposalId,
              pricelistId: String(formData.pricelistId ?? ""),
              warehouseId: String(formData.warehouseId ?? ""),
            })
            setConvertProposalId(null)
          }}
        />
      ) : null}
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
