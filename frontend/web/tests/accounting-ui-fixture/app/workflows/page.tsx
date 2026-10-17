"use client"

import { useEffect, useRef, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider, useTheme } from "../../../../../packages/ui/src/components/theme-provider"
import { Button } from "../../../../../packages/ui/src/components/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../packages/ui/src/components/tabs"
import { InvoiceListView } from "../../../../../packages/ui/src/accounting-components/invoice-list-view"
import { BillsListView } from "../../../../../packages/ui/src/accounting-components/bills-list-view"
import { ReconciliationWorkbench, type ReconciliationOutcome } from "../../../../../packages/ui/src/accounting-components/reconciliation-workbench"
import type { ReconciliationRequest } from "../../../../../packages/ui/src/accounting-components/reconciliation-workbench-model"
import { InvoiceEmailReviewDialog } from "../../../../../packages/ui/src/accounting-components/invoice-email-review-dialog"
import { invoiceEmailContext, invoiceEmailDocumentKey, invoiceEmailScope, type InvoiceEmailDocument, type InvoiceEmailQueueOutcome, type InvoiceEmailSubmission, type InvoiceEmailTemplate } from "../../../../../packages/ui/src/accounting-components/invoice-email-review"
import { InvoiceDocument, resolveDraftInvoiceDocument } from "../../../../../packages/ui/src/accounting-components/invoice-document"
import type { ModuleDataState } from "../../../../../packages/ui/src/lib/module-data-state"
import { capturedBuyerSnapshot, legacyBuyerSnapshot, reconciliationFixture, workflowBills, workflowCurrencies, workflowInvoices } from "../../workflow-fixtures"

const templates: InvoiceEmailTemplate[] = [
  { id: 101n, organizationId: 7n, companyId: 11n, name: "Synthetic company invoice notice for international customer operations", model: "account_move", subject: "Synthetic invoice ready for review", bodyHtml: "<strong>Synthetic literal message</strong>\nPlease review the invoice separately. This fixture does not send an email.", attachDocument: false, isDefault: true, isActive: true },
  { id: 102n, organizationId: 7n, companyId: undefined, name: "Synthetic organization notice", model: "account_move", subject: "Synthetic organization subject", bodyHtml: "Synthetic organization body", attachDocument: false, isDefault: false, isActive: true },
  { id: 103n, organizationId: 7n, companyId: 11n, name: "Unsupported attachment template", model: "account_move", subject: "Synthetic attachment", bodyHtml: "Synthetic attachment body", attachDocument: true, isDefault: false, isActive: true },
  { id: 104n, organizationId: 7n, companyId: 11n, name: "Unsupported placeholder template", model: "account_move", subject: "Hello {{customer}}", bodyHtml: "Synthetic placeholder body", attachDocument: false, isDefault: false, isActive: true },
  { id: 199n, organizationId: 7n, companyId: 22n, name: "FOREIGN COMPANY EMAIL TEMPLATE", model: "account_move", subject: "Other company", bodyHtml: "Other company body", attachDocument: false, isDefault: true, isActive: true },
]
const documentFor = (companyId: string): InvoiceEmailDocument => ({ organizationId: 7n, companyId: BigInt(companyId), moveId: companyId === "11" ? 9007199254740993n : 999n, reference: companyId === "11" ? "INV/SYNTHETIC/9007199254740993" : "COMPANY B INVOICE", partner: "Synthetic international customer with a deliberately long legal display name", companyName: `Synthetic Company ${companyId}`, totalLabel: "EUR 1,000.00", pdfFilename: "INV-SYNTHETIC-9007199254740993.pdf", posted: true, revision: "synthetic-revision-1" })

function Workflows() {
  const { setTheme } = useTheme()
  const [hydrated, setHydrated] = useState(false)
  const [stage, setStage] = useState("invoices")
  const [companyId, setCompanyId] = useState("11")
  const [stateStatus, setStateStatus] = useState<"ready" | "loading" | "error" | "denied">("ready")
  const [canAct, setCanAct] = useState(true)
  const [selectedRecord, setSelectedRecord] = useState("")
  const [urlFilters, setUrlFilters] = useState<{ queue: string } | null>(null)
  const [bankMode, setBankMode] = useState<"confirmed" | "rejected" | "unknown">("confirmed")
  const [bankDispatches, setBankDispatches] = useState(0)
  const [bankChecks, setBankChecks] = useState(0)
  const [bankMatched, setBankMatched] = useState(false)
  const bankRequest = useRef<ReconciliationRequest | null>(null)
  const [emailMode, setEmailMode] = useState<"queued" | "rejected" | "unknown">("queued")
  const [emailDispatches, setEmailDispatches] = useState(0)
  const [emailChecks, setEmailChecks] = useState(0)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailDocument, setEmailDocument] = useState(() => documentFor("11"))
  const emailSubmission = useRef<InvoiceEmailSubmission | null>(null)
  const [pdfReview, setPdfReview] = useState("")
  const [liveContact, setLiveContact] = useState("Current CRM legal name must not replace captured buyer")
  const channel = useRef<BroadcastChannel | null>(null)
  useEffect(() => {
    setHydrated(true)
    const control = new BroadcastChannel("synthetic-accounting-workflow-controls")
    channel.current = control
    control.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "11" || event.data === "22") setCompanyId(event.data)
    }
    return () => { channel.current = null; control.close() }
  }, [])
  const switchCompany = () => { const next = companyId === "11" ? "22" : "11"; setCompanyId(next); channel.current?.postMessage(next) }
  const sourceState: ModuleDataState = stateStatus === "ready" || stateStatus === "loading" ? { status: stateStatus } : { status: stateStatus, message: `Synthetic ${stateStatus} source — cached rows must not become available records` }
  const clearFilter = (key: string) => { if (key === "*" || key === "queue") setUrlFilters(null) }
  const source = { ...reconciliationFixture, companyId, state: sourceState, bankLines: reconciliationFixture.bankLines.map((line) => bankMatched ? { ...line, isReconciled: true, moveIds: ["501", "502"] } : line) }
  const confirmBank = async (request: ReconciliationRequest): Promise<ReconciliationOutcome> => {
    setBankDispatches((value) => value + 1)
    if (request.organizationId !== "7" || request.companyId !== "11" || request.statementId !== "201" || request.lineId !== "301" || [...request.moveLineIds].sort().join(",") !== "501,502") throw new Error("Synthetic reconciliation received the wrong exact scope or records")
    bankRequest.current = request
    if (bankMode === "rejected") return { status: "rejected", message: "Synthetic bank-link rejection; selection retained" }
    if (bankMode === "unknown") return { status: "unknown", message: "Synthetic response lost. Check the original action, never resubmit." }
    setBankMatched(true)
    return { status: "confirmed" }
  }
  const checkBank = async (request: ReconciliationRequest): Promise<"confirmed" | "unconfirmed"> => {
    if (JSON.stringify(request) !== JSON.stringify(bankRequest.current)) throw new Error("Synthetic bank check changed the original request")
    setBankChecks((value) => value + 1)
    if (bankChecks === 0) return "unconfirmed"
    setBankMatched(true)
    return "confirmed"
  }
  const queueEmail = async (submission: InvoiceEmailSubmission, mayDispatch: () => boolean): Promise<InvoiceEmailQueueOutcome> => {
    if (!mayDispatch()) return { status: "rejected", message: "Synthetic access changed before queueing" }
    setEmailDispatches((value) => value + 1)
    emailSubmission.current = submission
    if (emailMode === "rejected") return { status: "rejected", message: "Synthetic queue rejection; recipient retained" }
    if (emailMode === "unknown") return { status: "unknown", submission, message: "Synthetic queue response lost. No automatic replay is permitted." }
    return { status: "queued", submission, messageId: 701n }
  }
  const checkEmail = async (submission: InvoiceEmailSubmission): Promise<InvoiceEmailQueueOutcome> => {
    if (!emailSubmission.current || invoiceEmailContext(submission) !== invoiceEmailContext(emailSubmission.current) || submission.recipient !== emailSubmission.current.recipient) throw new Error("Synthetic email check changed the original review")
    setEmailChecks((value) => value + 1)
    return emailChecks === 0 ? { status: "unknown", submission, message: "Synthetic original queue request still unconfirmed" } : { status: "queued", submission, messageId: 701n }
  }
  return <main className="mx-auto min-w-0 max-w-7xl space-y-6 p-4 sm:p-6">
    <p data-testid="workflow-fixture-disclosure" data-hydrated={hydrated} className="text-xs text-muted-foreground">Synthetic workflow UI — no ERP backend, bank settlement, sent email or delivered attachment. Callbacks and company changes are controlled fixture boundaries.</p>
    <h1 className="break-words text-2xl font-semibold">Accounting workflow reviews for international company operations</h1>
    <section aria-label="Synthetic workflow controls" className="flex flex-wrap gap-2">
      <Button onClick={switchCompany}>Switch synthetic company</Button>
      <Button onClick={() => setStateStatus((value) => value === "ready" ? "loading" : value === "loading" ? "error" : value === "error" ? "denied" : "ready")}>Cycle synthetic source state</Button>
      <Button onClick={() => setCanAct((value) => !value)}>Toggle synthetic action permission</Button>
      <Button onClick={() => setUrlFilters({ queue: "overdue" })}>Apply linked overdue filter</Button>
      <Button onClick={() => setBankMode("unknown")}>Lose synthetic bank response</Button>
      <Button onClick={() => setBankMode("rejected")}>Reject synthetic bank action</Button>
      <Button onClick={() => setEmailMode("unknown")}>Lose synthetic email response</Button>
      <Button onClick={() => setEmailMode("rejected")}>Reject synthetic email action</Button>
      <Button onClick={() => setLiveContact("Changed CRM legal identity and address must not replace the stored buyer")}>Change synthetic live CRM contact</Button>
      <Button onClick={() => setTheme("dark")}>Dark workspace</Button>
    </section>
    <output data-testid="workflow-fixture-state" className="block break-words text-sm">Company {companyId}; source {stateStatus}; selected {selectedRecord || "none"}; bank dispatches {bankDispatches}; bank checks {bankChecks}; email dispatches {emailDispatches}; email checks {emailChecks}; PDF review {pdfReview || "none"}</output>
    <Tabs value={stage} onValueChange={setStage} className="min-w-0 flex-col [&>[data-slot=tabs-content]]:min-w-0">
      <div className="max-w-full overflow-x-auto"><TabsList aria-label="Synthetic accounting workflows"><TabsTrigger value="invoices">Invoice worklist</TabsTrigger><TabsTrigger value="bills">Bill worklist</TabsTrigger><TabsTrigger value="bank">Bank matching</TabsTrigger><TabsTrigger value="email">Email review</TabsTrigger><TabsTrigger value="buyer">Buyer snapshots</TabsTrigger></TabsList></div>
      <TabsContent value="invoices"><InvoiceListView invoices={workflowInvoices} currencyOptions={workflowCurrencies} worklistScope={{ organizationId: "7", companyId, userId: "synthetic-accountant" }} sourceState={sourceState} initialFilters={urlFilters ?? {}} onInitialFilterClear={clearFilter} onSelectInvoice={(row) => setSelectedRecord(String(row.id))} /></TabsContent>
      <TabsContent value="bills"><BillsListView bills={workflowBills} currencyOptions={workflowCurrencies} worklistScope={{ organizationId: "7", companyId, userId: "synthetic-accountant" }} sourceState={sourceState} initialFilters={urlFilters ?? {}} onInitialFilterClear={clearFilter} onSelectBill={(row) => setSelectedRecord(String(row.id))} /></TabsContent>
      <TabsContent value="bank"><ReconciliationWorkbench source={source} canReconcile={canAct} onConfirm={confirmBank} onCheckStatus={checkBank} /></TabsContent>
      <TabsContent value="email"><section className="min-w-0 space-y-3 rounded-xl border bg-card p-5"><h2 className="text-xl font-semibold">Synthetic invoice email boundary</h2><p className="text-sm text-muted-foreground">Review and queue only. There is no dispatch, email delivery or PDF attachment capability in this fixture.</p><Button onClick={() => { setEmailDocument(documentFor(companyId)); setEmailOpen(true) }}>Review synthetic invoice email</Button></section></TabsContent>
      <TabsContent value="buyer"><div className="min-w-0 space-y-6"><p data-testid="synthetic-live-contact" className="break-words text-sm">{liveContact}</p><section aria-label="Legacy buyer snapshot"><h2 className="mb-3 text-xl font-semibold">Legacy V1 document</h2><InvoiceDocument title="Invoice" reference="SYNTHETIC-V1" partnerLabel="Customer" partner="Historical customer display name" currency={{ code: "EUR" }} subtotal={100} tax={0} total={100} personalization={legacyBuyerSnapshot} /></section><section aria-label="Captured buyer snapshot"><h2 className="mb-3 text-xl font-semibold">Captured V2 document</h2><InvoiceDocument title="Invoice" reference="SYNTHETIC-V2" partnerLabel="Customer" partner={liveContact} currency={{ code: "EUR" }} subtotal={100} tax={0} total={100} personalization={capturedBuyerSnapshot} /></section><section aria-label="Draft captured buyer snapshot"><h2 className="mb-3 text-xl font-semibold">Draft V2 document</h2><InvoiceDocument draft title="Invoice" reference="SYNTHETIC-DRAFT-V2" partnerLabel="Customer" partner={liveContact} currency={{ code: "EUR" }} subtotal={100} tax={0} total={100} personalization={resolveDraftInvoiceDocument({ invoiceDocument: capturedBuyerSnapshot }, capturedBuyerSnapshot.profile, capturedBuyerSnapshot.profileVersionIds, capturedBuyerSnapshot.seller).personalization} /></section></div></TabsContent>
    </Tabs>
    <InvoiceEmailReviewDialog open={emailOpen} document={emailDocument} currentScopeKey={invoiceEmailScope(documentFor(companyId))} currentDocumentKey={invoiceEmailDocumentKey(documentFor(companyId))} templates={templates} templateState={sourceState} canQueue={canAct} canCheck onQueue={queueEmail} onCheck={checkEmail} onReviewPdf={async (document) => setPdfReview(String(document.moveId))} onReloadTemplates={() => setStateStatus("ready")} onClose={() => setEmailOpen(false)} />
  </main>
}

export default function WorkflowFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: null, connected: false }}><ThemeProvider defaultTheme="light"><Workflows /></ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
