"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LumiereApiProvider } from "@lumiere/api-client"
import { I18nProvider } from "@lumiere/i18n"
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { Button } from "../../../../../packages/ui/src/components/button"
import { CollectionsWorkspace } from "../../../../../packages/ui/src/accounting-components/collections-workspace"
import { BillIntakeReview } from "../../../../../packages/ui/src/accounting-components/bill-intake-review"
import { CsvImportModal } from "../../../../../packages/ui/src/components/csv-import-modal"
import { ReconciliationWorkbench, type ReconciliationOutcome } from "../../../../../packages/ui/src/accounting-components/reconciliation-workbench"
import type { ReconciliationRequest, ReconciliationSource } from "../../../../../packages/ui/src/accounting-components/reconciliation-workbench-model"
import { InvoiceEmailReviewDialog } from "../../../../../packages/ui/src/accounting-components/invoice-email-review-dialog"
import { invoiceEmailDocumentKey, invoiceEmailScope, type InvoiceEmailDocument } from "../../../../../packages/ui/src/accounting-components/invoice-email-review"
import type { AccountMove } from "../../../../../packages/ui/src/lib/accounting-types"
import type { ModuleDataState } from "../../../../../packages/ui/src/lib/module-data-state"
import { webApi } from "../../../../lib/lumiere-web-http"
import { BankLifecycleFixture } from "./bank-lifecycle-fixture"
const PaymentOperationsPanel = dynamic(() => import("../../../../app/(modules)/accounting/payment-operations-panel").then((module) => module.PaymentOperationsPanel), { ssr: false, loading: () => <p role="status">Loading actual payment operations…</p> })

const NOW = new Date("2026-10-18T12:00:00Z")
const date = (value: string) => ({ microsSinceUnixEpoch: BigInt(Date.parse(`${value}T00:00:00Z`)) * 1000n })
const scope = { organizationId: "7", companyId: "11" }
const currencies = [{ value: "1", label: "Euro (EUR)", code: "EUR" }, { value: "2", label: "US dollar (USD)", code: "USD" }]
const invoices: AccountMove[] = [
  { ...scope, id: "9007199254740993", name: "INV/EUR/RECENT", moveType: "OutInvoice", state: "Posted", partnerId: "601", invoicePartnerDisplayName: "Kigali design customer", currencyId: "1", amountTotal: 150, amountResidual: 100, invoiceDateDue: date("2026-10-10") },
  { ...scope, id: "902", name: "INV/USD/OLDER", moveType: "OutInvoice", state: "Posted", partnerId: "601", invoicePartnerDisplayName: "Regional USD customer", currencyId: "2", amountTotal: 220, amountResidual: 200, invoiceDateDue: date("2026-08-10") },
  { ...scope, id: "903", name: "INV/EUR/OLDEST", moveType: "OutInvoice", state: "Posted", partnerId: "601", invoicePartnerDisplayName: "Older EUR customer", currencyId: "1", amountTotal: 50, amountResidual: 50, invoiceDateDue: date("2026-06-01") },
  { ...scope, companyId: "22", id: "999", name: "OTHER COMPANY COLLECTION", moveType: "OutInvoice", state: "Posted", currencyId: "1", amountTotal: 99999, amountResidual: 99999, invoiceDateDue: date("2026-01-01") },
  { ...scope, organizationId: "8", id: "998", name: "OTHER ORGANIZATION COLLECTION", moveType: "OutInvoice", state: "Posted", currencyId: "1", amountTotal: 88888, amountResidual: 88888, invoiceDateDue: date("2026-01-01") },
]
const bills: AccountMove[] = [
  { ...scope, id: "801", name: "BILL/NEEDS/REVIEW", moveType: "InInvoice", state: "Draft", currencyId: "1", amountTotal: 0 },
  { ...scope, id: "802", name: "BILL/READY/DETAILS", moveType: "InInvoice", state: "Draft", partnerId: "602", invoicePartnerDisplayName: "Canonical supplier", ref: "SUPPLIER-802", invoiceDate: date("2026-10-17"), currencyId: "1", amountTotal: 120 },
  { ...scope, companyId: "22", id: "899", name: "OTHER COMPANY BILL", moveType: "InInvoice", state: "Draft", amountTotal: 99999 },
]
const billLines = [{ ...scope, id: "811", moveId: "802", accountId: "401", debit: 120, credit: 0 }, { ...scope, id: "812", moveId: "802", accountId: "402", debit: 0, credit: 120 }]
const bankLine = { id: "301", organizationId: "7", statementId: "201", journalId: "5", amount: 100, date: date("2026-10-18"), amountCurrency: null, currencyId: null, journalCurrencyId: "1", foreignCurrencyId: null, isReconciled: false, moveIds: [], transactionType: "Synthetic exact invoice payment" }
const bankSource: ReconciliationSource = {
  ...scope, companyCurrencyId: "1", state: { status: "ready" },
  statement: { ...scope, id: "201", name: "EUR statement for bank recovery", state: "Open", journalId: "5", currencyId: "1" },
  line: bankLine, bankLines: [bankLine],
  currencies: [{ id: "1", code: "EUR", name: "Euro", decimalPlaces: 2, roundingFactor: 0.01 }],
  accounts: [{ ...scope, id: "401", code: "1200", name: "Receivables", internalType: "receivable", reconcile: true, deprecated: false }],
  moves: [{ ...scope, id: "91", name: "INV/BANK/91", partnerId: "601", moveType: "OutInvoice", state: "Posted", invoicePartnerDisplayName: "Canonical customer" }],
  moveLines: [{ ...scope, id: "501", moveId: "91", accountId: "401", partnerId: "601", parentState: "Posted", name: "Open customer invoice", companyCurrencyId: "1", currencyId: "1", balance: 100, debit: 100, credit: 0, amountResidual: 100, blocked: false }],
}
const paymentRows: Record<string, Record<string, unknown>[]> = {
  "payment-accounts": [{ ...scope, id: "1", name: "Synthetic EUR bank", active: true, currencyId: "1", providerCode: "Bank", accountJournalId: "5" }],
  "payment-transactions": [{ ...scope, id: "301", paymentAccountId: "1", accountPaymentId: "1", partnerId: "601", status: "Posted", direction: "Inbound", currencyId: "1", settlementAmount: 100, externalReference: "SYNTHETIC-PAYMENT-301" }],
  "account-payments": [{ ...scope, id: "1", moveId: "101", partnerId: "601", state: "Paid", paymentType: "Inbound", currencyId: "1", amount: 100 }],
  "account-moves": [{ ...scope, id: "101", state: "Posted", currencyId: "1" }],
  "account-move-lines": [{ ...scope, id: "201", moveId: "101", paymentId: "1", partnerId: "601", parentState: "Posted", accountInternalType: "receivable", companyCurrencyId: "1", currencyId: "1", balance: -100, amountResidual: 60 }],
  "payment-reconciliations": [], "payment-reversals": [], "payment-fees": [],
}
const openInvoiceLines = [{ ...scope, id: "501", moveId: "91", partnerId: "601", currencyId: "1", accountInternalType: "receivable", parentState: "Posted", name: "Customer invoice INV/BANK/91", amountResidual: 100 }]
function queryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  for (const company of [11, 22]) {
    for (const [resource, rows] of Object.entries(paymentRows)) client.setQueryData(["typed-stdb", resource, "7", "company", company], company === 11 ? rows : [])
    client.setQueryData(["bank-statement-imports", "7", String(company)], { imports: [], lines: [] })
  }
  client.setQueryData(["currencies"], [{ id: "1", name: "EUR", code: "EUR", decimalPlaces: 2 }, { id: "2", name: "USD", code: "USD", decimalPlaces: 2 }])
  return client
}

function Operations() {
  const { setActiveCompanyId } = useErpSession()
  const [hydrated, setHydrated] = useState(false)
  const [companyId, setCompany] = useState("11")
  const [stage, setStage] = useState("collections")
  const [sourceStatus, setSourceStatus] = useState<"ready" | "error" | "denied">("ready")
  const [selected, setSelected] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [imports, setImports] = useState(0)
  const [bankLocked, setBankLocked] = useState(false)
  const [paymentLocked, setPaymentLocked] = useState(false)
  const [lifecycleLocked, setLifecycleLocked] = useState(false)
  const [lifecycleScenario, setLifecycleScenario] = useState<"closed" | "posted">("closed")
  const [actorKey, setActorKey] = useState("synthetic-accountant")
  const [bankDispatches, setBankDispatches] = useState(0)
  const [bankChecks, setBankChecks] = useState(0)
  const bankResolve = useRef<((outcome: ReconciliationOutcome) => void) | null>(null)
  const bankRequest = useRef<ReconciliationRequest | null>(null)
  const [reminder, setReminder] = useState<InvoiceEmailDocument | null>(null)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [queued, setQueued] = useState("")
  const switchCompany = (next: string) => { setCompany(next); setActiveCompanyId?.(Number(next)) }
  useEffect(() => {
    setHydrated(true)
    const control = new BroadcastChannel("synthetic-alpha-operations-controls")
    control.onmessage = (event) => {
      if (event.data === "11" || event.data === "22") switchCompany(event.data)
      else if (event.data === "actor-1" || event.data === "actor-2") setActorKey(event.data === "actor-1" ? "synthetic-accountant" : "other-accountant")
      else if (["collections", "bills", "import", "bank", "payments", "bank-lifecycle"].includes(event.data)) setStage(event.data)
    }
    return () => control.close()
  }, [setActiveCompanyId])
  const sourceState: ModuleDataState = sourceStatus === "ready" ? { status: "ready" } : { status: sourceStatus, message: `Synthetic ${sourceStatus} source. Refresh canonical records before continuing.`, onRetry: () => setSourceStatus("ready") }
  const activeDocument = reminder && String(reminder.companyId) === companyId ? reminder : null
  return <main className="mx-auto min-w-0 max-w-7xl space-y-6 p-4 sm:p-6">
    <p data-testid="operations-disclosure" data-hydrated={hydrated} className="text-xs text-muted-foreground">Synthetic operational acceptance fixture. Production components use fixed synthetic sources and controlled callbacks. Browser tests intercept every API request; no ERP writes, bank settlement, uploads or email delivery occur.</p>
    <h1 className="text-2xl font-semibold">Accounting operational reviews</h1>
    <div className="flex flex-wrap gap-2" aria-label="Synthetic operation controls">
      <Button onClick={() => switchCompany(companyId === "11" ? "22" : "11")}>Switch synthetic company</Button>
      <Button disabled={lifecycleLocked} onClick={() => { setLifecycleScenario("posted"); setStage("bank-lifecycle") }}>Load posted bank lifecycle</Button>
      <Button onClick={() => setSourceStatus("error")}>Set source error</Button><Button onClick={() => setSourceStatus("denied")}>Set source denied</Button><Button onClick={() => setSourceStatus("ready")}>Restore source</Button>
      <Button onClick={() => bankResolve.current?.({ status: "unknown", message: "Synthetic response lost; check the original settlement." })}>Resolve pending bank as unknown</Button>
    </div>
    <output className="block break-words text-sm" data-testid="operations-state">Company {companyId}; selected {selected || "none"}; imports {imports}; bank dispatches {bankDispatches}; bank checks {bankChecks}; bank lock {String(bankLocked)}; payment lock {String(paymentLocked)}; queued {queued || "none"}</output>
    <nav aria-label="Operational review workspaces" className="flex flex-wrap gap-2">{["collections", "bills", "import", "bank", "payments", "bank-lifecycle"].map((id) => <Button key={id} variant={stage === id ? "default" : "outline"} onClick={() => setStage(id)}>{id === "collections" ? "Collections" : id === "bills" ? "Bill intake" : id === "import" ? "Import source" : id === "bank" ? "Bank recovery" : id === "payments" ? "Payment allocation" : "Bank approval recovery"}</Button>)}</nav>
    {stage === "collections" ? <CollectionsWorkspace invoices={invoices} scope={{ organizationId: "7", companyId }} dataState={sourceState} currencyOptions={currencies} canReview now={NOW} onReviewReminder={(invoice) => {
      setSelected(String(invoice.id))
      setReminder({ organizationId: 7n, companyId: BigInt(companyId), moveId: BigInt(invoice.id), reference: invoice.name || "Invoice", partner: invoice.invoicePartnerDisplayName || "Customer", companyName: `Synthetic Company ${companyId}`, totalLabel: `Currency ${invoice.currencyId} ${invoice.amountResidual}`, pdfFilename: "synthetic-invoice.pdf", posted: true, revision: "synthetic-1" }); setReminderOpen(true)
    }} /> : null}
    {stage === "bills" ? <BillIntakeReview organizationId="7" companyId={companyId} bills={bills} lines={billLines} sourceState={sourceState} onOpenBill={(bill) => setSelected(String(bill.id))} /> : null}
    {stage === "import" ? <section className="space-y-3"><p>Review source totals before invoking the synthetic import boundary.</p><Button onClick={() => setImportOpen(true)}>Open source import review</Button></section> : null}
    {importOpen ? <CsvImportModal organizationId={7n} companyId={BigInt(companyId)} tableName="account_move_line" config={{ id: "synthetic-accounting-import", title: "Review accounting source import", submitLabel: "Import reviewed source", cancelLabel: "Close import review", sections: [] }} onClose={() => setImportOpen(false)} onImport={() => { setImports((count) => count + 1); setImportOpen(false) }} /> : null}
    {stage === "bank" || bankLocked ? <section className="space-y-3" aria-label="Retained bank recovery">
      {stage !== "bank" ? <p role="status">Original bank recovery remains mounted while its result is pending or unknown.</p> : null}
      <ReconciliationWorkbench actorKey="synthetic-accountant" source={{ ...bankSource, companyId, state: sourceState }} canReconcile onOperationLockChange={setBankLocked} onConfirm={(request) => { bankRequest.current = request; setBankDispatches((count) => count + 1); return new Promise((resolve) => { bankResolve.current = resolve }) }} onCheckStatus={async (request) => {
        if (JSON.stringify(request) !== JSON.stringify(bankRequest.current)) throw new Error("Original settlement request changed")
        setBankChecks((count) => count + 1); return companyId === request.companyId ? "confirmed" : "unconfirmed"
      }} />
    </section> : null}
    {stage === "payments" || paymentLocked ? <section className="space-y-3" aria-label="Retained payment allocation">
      {stage !== "payments" ? <p role="status">Original payment allocation remains mounted while its result is pending or unknown.</p> : null}
      <PaymentOperationsPanel organizationId={7} companyId={BigInt(companyId)} defaultCurrencyId={1n} currencyOptions={currencies} journalOptions={[{ value: "5", label: "EUR bank" }]} glAccountOptions={[{ value: "401", label: "Receivables" }]} partnerOptions={[{ value: "601", label: "Canonical customer" }]} moveLines={openInvoiceLines} onRecoveryLockChange={setPaymentLocked} />
    </section> : null}
    {stage === "bank-lifecycle" || lifecycleLocked ? <section className="space-y-3" aria-label="Retained bank lifecycle recovery">
      {stage !== "bank-lifecycle" ? <p role="status">Original bank approval recovery remains mounted while pending or awaiting approval.</p> : null}
      <BankLifecycleFixture key={lifecycleScenario} scenario={lifecycleScenario} actorKey={actorKey} source={{ ...bankSource, companyId, state: sourceState }} onLockChange={setLifecycleLocked} />
    </section> : null}
    {reminder ? <InvoiceEmailReviewDialog open={reminderOpen} purpose="reminder" document={reminder} currentScopeKey={activeDocument ? invoiceEmailScope(activeDocument) : "other-company"} currentDocumentKey={activeDocument ? invoiceEmailDocumentKey(activeDocument) : null} templates={[{ id: 101n, organizationId: 7n, companyId: 11n, name: "Synthetic reminder base", model: "account_move", subject: "Invoice reminder", bodyHtml: "Please review your outstanding invoice.", isDefault: true, isActive: true, attachDocument: false }]} templateState={sourceState} canQueue canCheck onQueue={async (submission, mayDispatch) => { if (!mayDispatch()) return { status: "rejected", message: "Synthetic scope changed" }; setQueued(`${submission.document.moveId}:${submission.recipient}`); return { status: "queued", messageId: 701n, submission } }} onCheck={async (submission) => ({ status: "queued", messageId: 701n, submission })} onReviewPdf={async () => {}} onReloadTemplates={() => setSourceStatus("ready")} onClose={() => setReminderOpen(false)} /> : null}
  </main>
}
export default function OperationsFixture() {
  const [client] = useState(queryClient)
  return <LumiereApiProvider client={webApi}><QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: null, connected: false, organizationId: 7, companyIds: [11, 22] }}><ThemeProvider defaultTheme="light"><Operations /></ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider></LumiereApiProvider>
}
