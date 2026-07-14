"use client"

import { useMemo, type ReactNode } from "react"
import Link from "next/link"
import { BoxesIcon, CircleDollarSignIcon, PackageIcon, ReceiptTextIcon, StoreIcon } from "lucide-react"

import { useErpSession } from "@lumiere/erp-session"
import { useAccountMoves, usePaymentTransactions } from "@lumiere/query-hooks/hooks/accounting"
import { useStockQuants } from "@lumiere/query-hooks/hooks/inventory"
import { useCompanyVerticalPacks, useSetCompanyVerticalPack } from "@lumiere/query-hooks/hooks/organization-company"
import { useSaleOrders } from "@lumiere/query-hooks/hooks/sales"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { MissingOrganization } from "@lumiere/ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

  if (!organizationId) return <MissingOrganization />
  const toggle = () => void setPack.mutate({ companyId, organizationId, packKey: "distributor_wholesaler", enabled: !enabled })

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
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
    </main>
  )
}

function MetricCard({ title, value, description, icon, href, destructive = false }: { title: string; value: number; description: string; icon: ReactNode; href: string; destructive?: boolean }) {
  return <Card><CardHeader><div className="flex items-center gap-2"><span className="text-muted-foreground">{icon}</span><CardTitle className="text-base">{title}</CardTitle></div></CardHeader><CardContent className="flex flex-col gap-3"><p className={destructive ? "text-3xl font-semibold text-destructive" : "text-3xl font-semibold"}>{value}</p><CardDescription>{description}</CardDescription><Link href={href}><Button size="sm" variant="outline">Open workflow</Button></Link></CardContent></Card>
}
