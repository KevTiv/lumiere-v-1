"use client"

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react"
import {
  BookOpen,
  Boxes,
  Calendar,
  FileText,
  FolderKanban,
  Package,
  Receipt,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Factory,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import { useSaleOrders } from "@lumiere/query-hooks/hooks/sales"
import { usePurchaseOrders } from "@lumiere/query-hooks/hooks/purchasing"
import { useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import { useProducts, useStockPickings } from "@lumiere/query-hooks/hooks/inventory"
import { useSubscriptions } from "@lumiere/query-hooks/hooks/subscriptions"
import { useDocuments } from "@lumiere/query-hooks/hooks/documents"
import { useFleetVehicles } from "@lumiere/query-hooks/hooks/fleet"
import { useCalendarEvents } from "@lumiere/query-hooks/hooks/calendar"
import { usePosSessions } from "@lumiere/query-hooks/hooks/pos"
import { useMrpProductions } from "@lumiere/query-hooks/hooks/manufacturing"
import { useExpenseSheets } from "@lumiere/query-hooks/hooks/expenses"
import { useProjects } from "@lumiere/query-hooks/hooks/projects"
import { CommandGroup, CommandItem } from "../components/command"
import { readRowField, searchRecords } from "../lib/record-search"

type Row = Record<string, unknown>
type RowsQuery = { data?: unknown; isLoading?: boolean }

const RECORDS_PER_MODEL = 5

interface RecordModelSpec {
  model: string
  /** Same resource the module's navigation entry is gated on. */
  resource: string
  headingKey: string
  heading: string
  icon: ComponentType<{ className?: string }>
  useRows: (organizationId: bigint) => RowsQuery
  /** Row fields (camelCase) searched besides the partner name. */
  fields: readonly string[]
  /** Fields tried in order for the result title. */
  titleFields: readonly string[]
  /** Fields that hold a partner/contact id. */
  partnerField?: string
  /** Module tab for models without a record page. */
  fallbackHref?: (id: string) => string
}

export const RECORD_MODEL_SPECS: readonly RecordModelSpec[] = [
  { model: "sale_order", resource: "module:sales", headingKey: "commandPalette.records.saleOrders", heading: "Sales orders", icon: TrendingUp, useRows: useSaleOrders, fields: ["name", "reference", "origin", "clientOrderRef"], titleFields: ["name", "reference"], partnerField: "partnerId" },
  { model: "purchase_order", resource: "module:purchasing", headingKey: "commandPalette.records.purchaseOrders", heading: "Purchase orders", icon: ShoppingCart, useRows: usePurchaseOrders, fields: ["name", "partnerRef", "origin"], titleFields: ["name", "partnerRef"], partnerField: "partnerId" },
  { model: "account_move", resource: "module:accounting", headingKey: "commandPalette.records.invoices", heading: "Invoices and bills", icon: BookOpen, useRows: useAccountMoves, fields: ["name", "ref", "invoiceOrigin", "paymentReference"], titleFields: ["name", "ref"], partnerField: "partnerId" },
  { model: "contact", resource: "module:crm", headingKey: "commandPalette.records.contacts", heading: "Contacts", icon: Users, useRows: useContacts, fields: ["displayName", "name", "email", "phone"], titleFields: ["displayName", "name", "email"], fallbackHref: (id) => `/crm?tab=contacts&filter=${encodeURIComponent(`id:${id}`)}` },
  { model: "product", resource: "module:inventory", headingKey: "commandPalette.records.products", heading: "Products", icon: Package, useRows: useProducts, fields: ["displayName", "name", "defaultCode", "code", "barcode"], titleFields: ["displayName", "name", "defaultCode"], fallbackHref: (id) => `/inventory?tab=products&filter=${encodeURIComponent(`id:${id}`)}` },
  { model: "stock_picking", resource: "module:inventory", headingKey: "commandPalette.records.transfers", heading: "Transfers", icon: Boxes, useRows: useStockPickings, fields: ["name", "origin"], titleFields: ["name"], partnerField: "partnerId" },
  { model: "subscription", resource: "module:subscriptions", headingKey: "commandPalette.records.subscriptions", heading: "Subscriptions", icon: RefreshCw, useRows: useSubscriptions, fields: ["code", "name", "description"], titleFields: ["code", "name"], partnerField: "partnerId" },
  { model: "document", resource: "module:documents", headingKey: "commandPalette.records.documents", heading: "Documents", icon: FileText, useRows: useDocuments, fields: ["name", "description"], titleFields: ["name"], partnerField: "partnerId" },
  { model: "fleet_vehicle", resource: "module:fleet", headingKey: "commandPalette.records.vehicles", heading: "Vehicles", icon: Truck, useRows: useFleetVehicles, fields: ["name", "licensePlate"], titleFields: ["name", "licensePlate"] },
  { model: "calendar_event", resource: "module:calendar", headingKey: "commandPalette.records.events", heading: "Calendar events", icon: Calendar, useRows: useCalendarEvents, fields: ["name", "description"], titleFields: ["name"] },
  { model: "pos_session", resource: "module:pos", headingKey: "commandPalette.records.posSessions", heading: "POS sessions", icon: ShoppingCart, useRows: usePosSessions, fields: ["name"], titleFields: ["name"] },
  { model: "mrp_production", resource: "module:manufacturing", headingKey: "commandPalette.records.manufacturingOrders", heading: "Manufacturing orders", icon: Factory, useRows: useMrpProductions, fields: ["name", "origin"], titleFields: ["name", "origin"] },
  { model: "hr_expense_sheet", resource: "module:expenses", headingKey: "commandPalette.records.expenseReports", heading: "Expense reports", icon: Receipt, useRows: useExpenseSheets, fields: ["name", "description"], titleFields: ["name"] },
  { model: "project_project", resource: "module:projects", headingKey: "commandPalette.records.projects", heading: "Projects", icon: FolderKanban, useRows: useProjects, fields: ["name", "description", "partnerEmail"], titleFields: ["name"] },
]

function firstText(row: Row, keys: readonly string[]): string {
  for (const key of keys) {
    const value = readRowField(row, key)
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ""
}

function asRows(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : []
}

export interface RecordSearchSummary {
  loading: boolean
  count: number
}

interface RecordSearchResultsProps {
  organizationId: bigint
  query: string
  /** Resources the user may read (module navigation entries already admitted). */
  allowedResources: ReadonlySet<string>
  /** Record page of a model, injected by the app (`recordPageHref`). */
  recordHref: (model: string, id: string) => string | undefined
  onNavigate: (href: string) => void
  onSummary: (summary: RecordSearchSummary) => void
}

/** Contacts double as the partner-name lookup for every other model. */
function PartnerLabels({
  organizationId,
  enabled,
  children,
}: {
  organizationId: bigint
  enabled: boolean
  children: (labels: ReadonlyMap<string, string>) => ReactNode
}) {
  return enabled ? (
    <PartnerLabelsLoaded organizationId={organizationId}>{children}</PartnerLabelsLoaded>
  ) : (
    <>{children(new Map())}</>
  )
}

function PartnerLabelsLoaded({
  organizationId,
  children,
}: {
  organizationId: bigint
  children: (labels: ReadonlyMap<string, string>) => ReactNode
}) {
  const { data } = useContacts(organizationId)
  const labels = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of asRows(data)) {
      const label = firstText(row, ["displayName", "name"])
      if (label) map.set(String(row.id), label)
    }
    return map
  }, [data])
  return <>{children(labels)}</>
}

function RecordModelResults({
  spec,
  organizationId,
  query,
  partnerLabels,
  recordHref,
  onNavigate,
  onStatus,
}: {
  spec: RecordModelSpec
  organizationId: bigint
  query: string
  partnerLabels: ReadonlyMap<string, string>
  recordHref: RecordSearchResultsProps["recordHref"]
  onNavigate: (href: string) => void
  onStatus: (model: string, status: RecordSearchSummary) => void
}) {
  const { t } = useTranslation()
  const { data, isLoading } = spec.useRows(organizationId)
  const partnerOf = (row: Row): string =>
    spec.partnerField
      ? (partnerLabels.get(String(readRowField(row, spec.partnerField) ?? "")) ?? "")
      : ""
  const hits = useMemo(
    () =>
      searchRecords(
        asRows(data),
        query,
        (row) => [...spec.fields.map((key) => readRowField(row, key)), partnerOf(row)],
        RECORDS_PER_MODEL,
      ),
    // partnerOf closes over spec + partnerLabels only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, query, spec, partnerLabels],
  )
  const loading = Boolean(isLoading)
  const count = hits.length
  useEffect(() => {
    onStatus(spec.model, { loading, count })
  }, [onStatus, spec.model, loading, count])
  useEffect(() => () => onStatus(spec.model, { loading: false, count: 0 }), [onStatus, spec.model])

  if (count === 0) return null
  const Icon = spec.icon
  return (
    <CommandGroup
      forceMount
      heading={t(spec.headingKey, { defaultValue: spec.heading })}
      data-testid={`erp-command-palette-records-${spec.model}`}
    >
      {hits.map(({ row }) => {
        const id = String(row.id)
        const href = recordHref(spec.model, id) ?? spec.fallbackHref?.(id)
        const title = firstText(row, spec.titleFields) || `#${id}`
        const subtitle = partnerOf(row) || firstText(row, spec.fields.filter((f) => !spec.titleFields.includes(f)))
        return (
          <CommandItem
            key={id}
            forceMount
            value={`record:${spec.model}:${id}`}
            disabled={!href}
            data-testid={`erp-command-palette-record-${spec.model}-${id}`}
            onSelect={() => href && onNavigate(href)}
          >
            <Icon className="h-4 w-4" />
            <span className="truncate">{title}</span>
            {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

/**
 * Record results of the command palette. Mount it only while the palette is open and the
 * query is long enough: the model hooks cannot be gated, so mounting is what starts the reads.
 */
export function RecordSearchResults({
  organizationId,
  query,
  allowedResources,
  recordHref,
  onNavigate,
  onSummary,
}: RecordSearchResultsProps) {
  const { t } = useTranslation()
  const specs = useMemo(
    () => RECORD_MODEL_SPECS.filter((spec) => allowedResources.has(spec.resource)),
    [allowedResources],
  )
  const [statuses, setStatuses] = useState<Record<string, RecordSearchSummary>>({})
  const [onStatus] = useState(
    () => (model: string, status: RecordSearchSummary) =>
      setStatuses((prev) => {
        const current = prev[model]
        if (current && current.loading === status.loading && current.count === status.count) return prev
        return { ...prev, [model]: status }
      }),
  )
  const summary = useMemo<RecordSearchSummary>(() => {
    const values = specs.map((spec) => statuses[spec.model])
    return {
      // A model that has not reported yet is still loading.
      loading: values.some((status) => !status || status.loading),
      count: values.reduce((sum, status) => sum + (status?.count ?? 0), 0),
    }
  }, [specs, statuses])
  const { loading: summaryLoading, count: summaryCount } = summary
  useEffect(() => {
    onSummary({ loading: summaryLoading, count: summaryCount })
  }, [onSummary, summaryLoading, summaryCount])

  const canReadContacts = allowedResources.has("module:crm")
  return (
    <PartnerLabels organizationId={organizationId} enabled={canReadContacts}>
      {(partnerLabels) => (
        <>
          {specs.map((spec) => (
            <RecordModelResults
              key={spec.model}
              spec={spec}
              organizationId={organizationId}
              query={query}
              partnerLabels={partnerLabels}
              recordHref={recordHref}
              onNavigate={onNavigate}
              onStatus={onStatus}
            />
          ))}
          {summary.loading ? (
            <div
              role="status"
              className="px-2 py-2 text-xs text-muted-foreground"
              data-testid="erp-command-palette-records-loading"
            >
              {t("commandPalette.records.loading", { defaultValue: "Searching records..." })}
            </div>
          ) : null}
        </>
      )}
    </PartnerLabels>
  )
}
