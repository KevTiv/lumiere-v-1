"use client"

import { useEffect, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { Button } from "@lumiere/ui/components/button"
import { InvoiceWorkflowGuide, type InvoiceWorkflowGuideProps } from "@lumiere/ui/accounting-components/invoice-workflow-guide"
import { ApplyPostedPaymentDialog } from "@lumiere/ui/accounting-components/apply-posted-payment-dialog"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"

function GuideFixture() {
  const [hydrated, setHydrated] = useState(false)
  const [stage, setStage] = useState<InvoiceWorkflowGuideProps["stage"]>("draft")
  const [isBill, setIsBill] = useState(false)
  const [allowed, setAllowed] = useState(true)
  const [open, setOpen] = useState(false)
  const [reject, setReject] = useState(false)
  const [source, setSource] = useState<ModuleDataState>({ status: "ready" })
  const [dispatches, setDispatches] = useState(0)
  const [lines, setLines] = useState(false)
  useEffect(() => setHydrated(true), [])
  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
    <p data-testid="guided-fixture-disclosure" data-hydrated={hydrated} className="text-xs text-muted-foreground">Synthetic accounting guidance. Production components with controlled callbacks; no financial operations.</p>
    <h1 className="text-2xl font-semibold">{isBill ? "Vendor bill BILL/001" : "Customer invoice INV/001"}</h1>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { setIsBill(!isBill); setStage("draft") }}>Switch document kind</Button>
      <Button variant="outline" onClick={() => setAllowed(!allowed)}>Toggle permission</Button>
      <Button variant="outline" onClick={() => setReject(!reject)}>Toggle rejected payment</Button>
      <Button variant="outline" onClick={() => setSource(source.status === "ready" ? { status: "loading" } : source.status === "loading" ? { status: "error", message: "Payment source unavailable" } : source.status === "error" ? { status: "denied" } : { status: "ready" })}>Cycle payment source</Button>
    </div>
    <InvoiceWorkflowGuide stage={stage} isBill={isBill} amountDue="EUR 125.00" onReviewLines={() => setLines(true)} paymentsHref={stage === "paid" ? "#linked-payments" : "/accounting?tab=payments"}
      primaryAction={stage === "draft" || stage === "posted" ? { label: stage === "draft" ? isBill ? "Post bill" : "Post invoice" : "Apply existing payment", blockedReason: allowed ? undefined : "Ask your accounting administrator for posting or payment permission.", onClick: () => stage === "draft" ? setStage("posted") : setOpen(true) } : undefined} />
    {lines ? <p>Review synthetic line: Accounting services · EUR 125.00</p> : null}
    <p data-testid="guided-dispatches">Payment applications: {dispatches}</p>
    {stage === "paid" ? <section id="linked-payments" aria-label="Linked payments" className="rounded-xl border p-4">PAY/001 · EUR 125.00</section> : null}
    {open ? <ApplyPostedPaymentDialog options={[{ value: "9007199254740993", label: "PAY/001 · EUR 125.00" }]} sourceState={source} canApply={allowed} isPending={false} onClose={() => setOpen(false)} onApply={async (id) => { if (id !== "9007199254740993") throw new Error("Wrong synthetic payment"); setDispatches((value) => value + 1); if (reject) throw new Error("Synthetic payment rejected; selection retained"); setStage("paid") }} /> : null}
  </main>
}

export default function GuidedWorkflowFixture() {
  return <I18nProvider language="en"><ThemeProvider defaultTheme="light"><GuideFixture /></ThemeProvider></I18nProvider>
}
