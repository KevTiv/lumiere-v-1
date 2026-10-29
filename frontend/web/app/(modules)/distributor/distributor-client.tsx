"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useMemo, type ReactNode } from "react"
import Link from "next/link"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { DashboardHeader } from "@lumiere/ui"
import { BoxesIcon, CircleDollarSignIcon, PackageIcon, ReceiptTextIcon, StoreIcon } from "lucide-react"

import { useErpSession } from "@lumiere/erp-session"
import { useAccountMoves, usePartnerCreditHolds, usePaymentTransactions } from "@lumiere/query-hooks/hooks/accounting"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import { useStockPickings, useStockQuants } from "@lumiere/query-hooks/hooks/inventory"
import { orderToCashRows, type OrderToCashException, type OrderToCashStage } from "@lumiere/query-hooks/hooks/order-to-cash"
import { useCompanyVerticalPacks, useSetCompanyVerticalPack } from "@lumiere/query-hooks/hooks/organization-company"
import { useSaleOrders } from "@lumiere/query-hooks/hooks/sales"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { MissingOrganization, usePermission } from "@lumiere/ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OrderHandoffLinks, orderHref } from "../../../components/order-handoff-links"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { TablePager, usePagedRows } from "@lumiere/ui/components/table-pager"

type Row = Record<string, unknown>

function enumName(value: unknown): string {
  return value != null && typeof value === "object" && "tag" in value
    ? String((value as { tag: unknown }).tag)
    : String(value ?? "")
}

function sameCompany(row: Row, companyId: bigint): boolean {
  const value = row.companyId ?? row.company_id
  return value != null && String(value) === String(companyId)
}

const STAGE_LABELS: Record<OrderToCashStage, string> = {
  get to_deliver() { return i18n.t("distributor.orderToCash.to_deliver") },
  get to_invoice() { return i18n.t("distributor.orderToCash.to_invoice") },
  get to_collect() { return i18n.t("distributor.orderToCash.to_collect") },
  get settled() { return i18n.t("distributor.orderToCash.settled") },
}

const EXCEPTION_LABELS: Record<OrderToCashException, string> = {
  get no_delivery() { return i18n.t("distributor.orderToCash.no_delivery") },
  get delivery_incomplete() { return i18n.t("distributor.orderToCash.delivery_incomplete") },
  get not_invoiced() { return i18n.t("distributor.orderToCash.not_invoiced") },
  get collection_overdue() { return i18n.t("distributor.orderToCash.collection_overdue") },
  get credit_hold() { return i18n.t("distributor.orderToCash.credit_hold") },
}

export function DistributorClient() {
  const { t } = useTranslation()
  const { organizationId } = useErpSession()
  const companyId = useDefaultOperatingCompanyBigInt(organizationId ?? 0) ?? 0n
  const organization = BigInt(organizationId ?? 0)
  const packs = useCompanyVerticalPacks(companyId, companyId > 0n)
  const setPack = useSetCompanyVerticalPack()
  const { data: quants = [] } = useStockQuants(organization)
  const { data: orders = [] } = useSaleOrders(organization)
  const { data: transactions = [] } = usePaymentTransactions(organization)
  const { data: moves = [] } = useAccountMoves(organization)
  const { data: pickings = [] } = useStockPickings(organization)
  const { data: holds = [] } = usePartnerCreditHolds(organization)
  const { data: contacts = [] } = useContacts(organization)
  const canReadOrders = usePermission("sale_order", "read").allowed

  const enabled = useMemo(
    () => packs.data?.some((pack) => pack.packKey === "distributor_wholesaler" && pack.enabled) ?? false,
    [packs.data],
  )
  const metrics = useMemo(() => {
    const companyQuants = (quants as Row[]).filter((row) => sameCompany(row, companyId))
    const lowStock = companyQuants.filter((row) => Number(row.availableQuantity ?? row.available_quantity ?? 0) <= 0 || row.isOutdated === true).length
    const openOrders = (orders as Row[]).filter((row) => sameCompany(row, companyId) && !["Done", "Cancelled"].includes(enumName(row.state))).length
    const postedPayments = (transactions as Row[]).filter((row) => sameCompany(row, companyId) && enumName(row.status) === "Posted").length
    const openInvoices = (moves as Row[]).filter((row) => sameCompany(row, companyId) && enumName(row.state) === "Posted" && Number(row.amountResidual ?? row.amount_residual ?? 0) > 0).length
    return { lowStock, openOrders, postedPayments, openInvoices }
  }, [companyId, moves, orders, quants, transactions])

  // COV-24: order → delivery → invoice → collection exceptions, composed from the canonical
  // order, picking, invoice and credit-hold records by exact relation (no workspace-local state).
  const exceptionRows = useMemo(
    () =>
      orderToCashRows(
        canReadOrders ? orders as Row[] : [],
        pickings as unknown as Row[],
        moves as Row[],
        holds as unknown as Row[],
        { organizationId: organization, companyId },
        BigInt(Date.now()) * 1000n,
      ).filter((row) => row.exceptions.length > 0),
    [canReadOrders, companyId, holds, moves, orders, organization, pickings],
  )
  const exceptionsPager = usePagedRows(exceptionRows)
  const partnerNames = useMemo(
    () => new Map((contacts as Row[]).map((contact) => [String(contact.id), String(contact.name ?? contact.displayName ?? contact.display_name ?? "")])),
    [contacts],
  )

  if (!organizationId) return <MissingOrganization />
  const toggle = async () => {
    try {
      await setPack.mutateAsync({ companyId, organizationId, packKey: "distributor_wholesaler", enabled: !enabled })
    } catch (error) {
      showWorkflowToast({
        kind: "error",
        title: enabled ? t("distributor.distributorClient.disablePackFailed") : t("distributor.distributorClient.enablePackFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6"
      data-testid="module-view-distributor"
      data-hydrated={packs.isSuccess ? "true" : "false"}
    >
      <DashboardHeader
        title={t("nav.distributor")}
        description={t("distributor.distributorClient.cashCreditOrderToCashAndStockControlForDistributionCompanies")}
      />
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2"><CardTitle>{t("distributor.distributorClient.distributorWorkspace")}</CardTitle><Badge variant={enabled ? "default" : "secondary"}>{enabled ? t("settings.formConfig.fieldDialog.enabled") : t("distributor.distributorClient.notEnabled")}</Badge></div>
            <CardDescription>{t("distributor.distributorClient.companyScopedCashCreditOrderAndStockControlBuiltOnThe")}</CardDescription>
          </div>
          <CardAction><Button size="sm" variant={enabled ? "outline" : "default"} disabled={companyId <= 0n || setPack.isPending} onClick={toggle}>{enabled ? t("distributor.distributorClient.disablePack") : t("distributor.distributorClient.enablePack")}</Button></CardAction>
        </CardHeader>
        {!enabled ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><StoreIcon /></EmptyMedia><EmptyTitle>{t("distributor.distributorClient.enableThisCompanySDistributorPack")}</EmptyTitle><EmptyDescription>{t("distributor.distributorClient.enablingExposesTheDistributorControlWorkspaceWithoutChangingAnyOperationalRecords")}</EmptyDescription></EmptyHeader><EmptyContent><Button disabled={companyId <= 0n || setPack.isPending} onClick={toggle}>{t("distributor.distributorClient.enableDistributorPack")}</Button></EmptyContent></Empty></CardContent> : null}
      </Card>
      {enabled ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title={t("distributor.distributorClient.openSalesOrders")} value={metrics.openOrders} description={t("distributor.distributorClient.ordersRequiringFulfilmentOrPaymentFollowUp")} icon={<ReceiptTextIcon />} href="/sales" />
        <MetricCard title={t("distributor.distributorClient.openCustomerBalances")} value={metrics.openInvoices} description={t("distributor.distributorClient.postedCustomerInvoicesWithARemainingBalance")} icon={<CircleDollarSignIcon />} href="/reports" />
        <MetricCard title={t("distributor.distributorClient.postedPayments")} value={metrics.postedPayments} description={t("distributor.distributorClient.operationalPaymentsAvailableForReconciliation")} icon={<BoxesIcon />} href="/accounting" />
        <MetricCard title={t("financeReview.queues.lowStockProducts.title")} value={metrics.lowStock} description={t("distributor.distributorClient.currentQuantsAtOrBelowZeroOrMarkedOutdated")} icon={<PackageIcon />} href="/reports" destructive={metrics.lowStock > 0} />
      </div> : null}
      {enabled ? <Card data-testid="distributor-o2c">
        <CardHeader>
          <CardTitle>{t("distributor.distributorClient.orderToCashExceptions")}</CardTitle>
          <CardDescription>{t("distributor.distributorClient.confirmedOrdersWithAMissingOrUnfinishedDeliveryNoInvoiceAn")}</CardDescription>
        </CardHeader>
        <CardContent>
          {exceptionRows.length === 0
            ? <p className="text-sm text-muted-foreground" data-testid="distributor-o2c-empty">{t("distributor.distributorClient.noOrderToCashExceptions")}</p>
            : <table className="w-full text-sm" data-testid="distributor-o2c-table">
              <thead><tr className="text-left text-muted-foreground"><th className="pb-2">{t("helpdesk.stages.columns.sequence")}</th><th className="pb-2">{t("accounting.workflowGuide.customer")}</th><th className="pb-2">{t("crm.opportunities.columns.stageName")}</th><th className="pb-2">{t("workflows.dashboard.exceptions")}</th><th className="pb-2">{t("distributor.distributorClient.deliveriesAmpInvoices")}</th><th className="pb-2 text-right">{t("distributor.distributorClient.openBalance")}</th></tr></thead>
              <tbody>
                {exceptionsPager.pageRows.map((row) => <tr key={String(row.orderId)} className="border-t align-top" data-testid={`distributor-o2c-row-${row.orderId}`}>
                  <td className="py-2"><Link className="underline underline-offset-2" href={orderHref(row.orderId)} data-testid={`distributor-o2c-order-${row.orderId}`}>{row.reference || t("distributor.distributorClient.order", { value1: row.orderId })}</Link></td>
                  <td className="py-2">{row.partnerId == null ? "—" : partnerNames.get(String(row.partnerId)) || t("distributor.distributorClient.partner", { value1: row.partnerId })}</td>
                  <td className="py-2" data-testid={`distributor-o2c-stage-${row.orderId}`}>{STAGE_LABELS[row.stage]}</td>
                  <td className="py-2"><div className="flex flex-wrap gap-1">{row.exceptions.map((exception) => <Badge key={exception} variant="destructive" data-testid={`distributor-o2c-exception-${row.orderId}-${exception}`}>{EXCEPTION_LABELS[exception]}</Badge>)}</div></td>
                  <td className="py-2"><OrderHandoffLinks handoffs={row.handoffs} testIdPrefix={`distributor-o2c-${row.orderId}`} /></td>
                  <td className="py-2 text-right">{row.openBalance > 0 ? row.openBalance.toFixed(2) : "—"}</td>
                </tr>)}
              </tbody>
            </table>}
            <TablePager {...exceptionsPager} />
        </CardContent>
      </Card> : null}
    </main>
  )
}

function MetricCard({ title, value, description, icon, href, destructive = false }: { title: string; value: number; description: string; icon: ReactNode; href: string; destructive?: boolean }) {
  const { t } = useTranslation()
  return <Card><CardHeader><div className="flex items-center gap-2"><span className="text-muted-foreground">{icon}</span><CardTitle className="text-base">{title}</CardTitle></div></CardHeader><CardContent className="flex flex-col gap-3"><p className={destructive ? "text-3xl font-semibold text-destructive" : "text-3xl font-semibold"}>{value}</p><CardDescription>{description}</CardDescription><Link href={href}><Button size="sm" variant="outline">{t("distributor.distributorClient.openWorkflow")}</Button></Link></CardContent></Card>
}
