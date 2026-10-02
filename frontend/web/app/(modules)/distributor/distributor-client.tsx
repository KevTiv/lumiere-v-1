"use client"

import { useMemo, type ReactNode } from "react"
import Link from "next/link"
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
  to_deliver: "To deliver",
  to_invoice: "To invoice",
  to_collect: "To collect",
  settled: "Settled",
}

const EXCEPTION_LABELS: Record<OrderToCashException, string> = {
  no_delivery: "No delivery",
  delivery_incomplete: "Delivery incomplete",
  not_invoiced: "Not invoiced",
  collection_overdue: "Overdue",
  credit_hold: "Credit hold",
}

export function DistributorClient() {
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
  const partnerNames = useMemo(
    () => new Map((contacts as Row[]).map((contact) => [String(contact.id), String(contact.name ?? contact.displayName ?? contact.display_name ?? "")])),
    [contacts],
  )

  if (!organizationId) return <MissingOrganization />
  const toggle = () => void setPack.mutate({ companyId, organizationId, packKey: "distributor_wholesaler", enabled: !enabled })

  return (
    <main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6"
      data-testid="module-view-distributor"
      data-hydrated={packs.isSuccess ? "true" : "false"}
    >
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2"><CardTitle>Distributor workspace</CardTitle><Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Enabled" : "Not enabled"}</Badge></div>
            <CardDescription>Company-scoped cash, credit, order, and stock control built on the shared ERP workflows.</CardDescription>
          </div>
          <CardAction><Button size="sm" variant={enabled ? "outline" : "default"} disabled={companyId <= 0n || setPack.isPending} onClick={toggle}>{enabled ? "Disable pack" : "Enable pack"}</Button></CardAction>
        </CardHeader>
        {!enabled ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><StoreIcon /></EmptyMedia><EmptyTitle>Enable this company’s distributor pack</EmptyTitle><EmptyDescription>Enabling exposes the distributor control workspace without changing any operational records.</EmptyDescription></EmptyHeader><EmptyContent><Button disabled={companyId <= 0n || setPack.isPending} onClick={toggle}>Enable distributor pack</Button></EmptyContent></Empty></CardContent> : null}
      </Card>
      {enabled ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Open sales orders" value={metrics.openOrders} description="Orders requiring fulfilment or payment follow-up." icon={<ReceiptTextIcon />} href="/sales" />
        <MetricCard title="Open customer balances" value={metrics.openInvoices} description="Posted customer invoices with a remaining balance." icon={<CircleDollarSignIcon />} href="/reports" />
        <MetricCard title="Posted payments" value={metrics.postedPayments} description="Operational payments available for reconciliation." icon={<BoxesIcon />} href="/accounting" />
        <MetricCard title="Low-stock alerts" value={metrics.lowStock} description="Current quants at or below zero, or marked outdated." icon={<PackageIcon />} href="/reports" destructive={metrics.lowStock > 0} />
      </div> : null}
      {enabled ? <Card data-testid="distributor-o2c">
        <CardHeader>
          <CardTitle>Order-to-cash exceptions</CardTitle>
          <CardDescription>Confirmed orders with a missing or unfinished delivery, no invoice, an overdue balance, or a customer on credit hold. Each links to the record that owns it.</CardDescription>
        </CardHeader>
        <CardContent>
          {exceptionRows.length === 0
            ? <p className="text-sm text-muted-foreground" data-testid="distributor-o2c-empty">No order-to-cash exceptions.</p>
            : <table className="w-full text-sm" data-testid="distributor-o2c-table">
              <thead><tr className="text-left text-muted-foreground"><th className="pb-2">Order</th><th className="pb-2">Customer</th><th className="pb-2">Stage</th><th className="pb-2">Exceptions</th><th className="pb-2">Deliveries &amp; invoices</th><th className="pb-2 text-right">Open balance</th></tr></thead>
              <tbody>
                {exceptionRows.map((row) => <tr key={String(row.orderId)} className="border-t align-top" data-testid={`distributor-o2c-row-${row.orderId}`}>
                  <td className="py-2"><Link className="underline underline-offset-2" href={orderHref(row.orderId)} data-testid={`distributor-o2c-order-${row.orderId}`}>{row.reference || `Order #${row.orderId}`}</Link></td>
                  <td className="py-2">{row.partnerId == null ? "—" : partnerNames.get(String(row.partnerId)) || `Partner ${row.partnerId}`}</td>
                  <td className="py-2" data-testid={`distributor-o2c-stage-${row.orderId}`}>{STAGE_LABELS[row.stage]}</td>
                  <td className="py-2"><div className="flex flex-wrap gap-1">{row.exceptions.map((exception) => <Badge key={exception} variant="destructive" data-testid={`distributor-o2c-exception-${row.orderId}-${exception}`}>{EXCEPTION_LABELS[exception]}</Badge>)}</div></td>
                  <td className="py-2"><OrderHandoffLinks handoffs={row.handoffs} testIdPrefix={`distributor-o2c-${row.orderId}`} /></td>
                  <td className="py-2 text-right">{row.openBalance > 0 ? row.openBalance.toFixed(2) : "—"}</td>
                </tr>)}
              </tbody>
            </table>}
        </CardContent>
      </Card> : null}
    </main>
  )
}

function MetricCard({ title, value, description, icon, href, destructive = false }: { title: string; value: number; description: string; icon: ReactNode; href: string; destructive?: boolean }) {
  return <Card><CardHeader><div className="flex items-center gap-2"><span className="text-muted-foreground">{icon}</span><CardTitle className="text-base">{title}</CardTitle></div></CardHeader><CardContent className="flex flex-col gap-3"><p className={destructive ? "text-3xl font-semibold text-destructive" : "text-3xl font-semibold"}>{value}</p><CardDescription>{description}</CardDescription><Link href={href}><Button size="sm" variant="outline">Open workflow</Button></Link></CardContent></Card>
}
