"use client"

import { useEffect, useRef, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { invoiceSellerFromCompany, resolveInvoiceProfile, type InvoiceProfileVersion } from "@lumiere/erp-shared/invoice-personalization"
import type { InvoiceProfileSaveInput, InvoiceProfileSaveOutcome, InvoiceProfileSubmission } from "@lumiere/query-hooks/hooks/invoice-personalization"
import type { CreateManualAccountInvoiceParams } from "@lumiere/query-hooks/hooks/accounting"
import { InvoicePersonalizationEditor } from "../../../../../packages/ui/src/settings/invoice-personalization-settings"
import { CreateInvoiceModal } from "../../../../../packages/ui/src/accounting-components/create-invoice-modal"
import { InvoiceDocument, readInvoiceDocumentContent, resolveDraftInvoiceDocument } from "../../../../../packages/ui/src/accounting-components/invoice-document"
import { ThemeProvider, useTheme } from "../../../../../packages/ui/src/components/theme-provider"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { Button } from "../../../../../packages/ui/src/components/button"
import { syntheticLogoUrl } from "../../personalization-fixture"

const orgVersion: InvoiceProfileVersion = { id: "1", organizationId: "7", companyId: null, name: "Synthetic organization defaults", values: { notice: "Organization notice", terms: "Organization terms", footer: "Organization footer", email: "billing@example.test" } }
const initialVersions: Record<string, InvoiceProfileVersion> = {
  "11": { id: "2", organizationId: "7", companyId: "11", name: "Synthetic company A", values: { notice: "Company A notice", footer: "Company A footer", logoUrl: syntheticLogoUrl } },
  "22": { id: "3", organizationId: "7", companyId: "22", name: "Synthetic company B", values: { notice: "Company B notice", footer: "Company B footer" } },
}
const longNotice = `Synthetic notice for international customers. ${"LONG-UNBROKEN-REFERENCE-".repeat(12)}\nThis long content demonstrates wrapping only; it is not a legal or financial acceptance record.`

function Personalization() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const { setTheme } = useTheme()
  const [companyId, setCompanyId] = useState("11")
  const [organizationVersion, setOrganizationVersion] = useState(orgVersion)
  const [versions, setVersions] = useState(initialVersions)
  const [failNext, setFailNext] = useState(false)
  const [unconfirmedNext, setUnconfirmedNext] = useState(false)
  const [dispatches, setDispatches] = useState(0)
  const [checks, setChecks] = useState(0)
  const [lastScope, setLastScope] = useState("")
  const [uploadScope, setUploadScope] = useState("")
  const [open, setOpen] = useState(false)
  const [issuedMetadata, setIssuedMetadata] = useState<string | null>(null)
  const [capturedContent, setCapturedContent] = useState("")
  const [state, setState] = useState<"ready" | "denied">("ready")
  const sequence = useRef(10)
  const publicationChannel = useRef<BroadcastChannel | null>(null)
  const pendingOutcome = useRef<InvoiceProfileSaveOutcome | null>(null)
  useEffect(() => {
    // A second fixture tab can publish while the actual composer is open. This is a synthetic prop boundary, not an ERP subscription.
    const channel = new BroadcastChannel("synthetic-invoice-publication")
    publicationChannel.current = channel
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object" || !("companyId" in event.data) || !["11", "22"].includes(String(event.data.companyId))) return
      const scope = String(event.data.companyId)
      const id = String(++sequence.current)
      setVersions((previous) => ({ ...previous, [scope]: { ...previous[scope]!, id, values: { ...previous[scope]!.values, notice: "Newer company notice", footer: "Newer company footer" } } }))
    }
    return () => { publicationChannel.current = null; channel.close() }
  }, [])
  const companyVersion = versions[companyId] ?? null
  const profile = resolveInvoiceProfile(organizationVersion.values, companyVersion?.values)
  const company = { id: companyId, organizationId: 7, name: companyId === "11" ? "Synthetic Company A international operations" : "Synthetic Company B", addressStreet: "1 Synthetic Street", addressCity: "Example City", addressZip: "", addressCountryCode: "RW", taxId: "SYNTHETIC-ONLY", companyRegistry: "SYNTHETIC-REGISTRY" }
  const seller = invoiceSellerFromCompany(company, profile)
  const profileVersionIds = { organization: organizationVersion.id, company: companyVersion?.id ?? null }
  const publish = (input: InvoiceProfileSaveInput): InvoiceProfileSaveOutcome => {
    const id = String(++sequence.current)
    const submission: InvoiceProfileSubmission = { ...input, name: `synthetic-publication-${id}` }
    const version: InvoiceProfileVersion = { id, organizationId: String(input.organizationId), companyId: input.companyId, name: submission.name, values: { ...input.values } }
    if (input.companyId === null) setOrganizationVersion(version)
    else setVersions((previous) => ({ ...previous, [input.companyId!]: version }))
    return { status: "saved", submission, version, isCurrent: true }
  }
  const save = async (input: InvoiceProfileSaveInput): Promise<InvoiceProfileSaveOutcome> => {
    setDispatches((value) => value + 1); setLastScope(`${input.organizationId}:${input.companyId ?? "organization"}`)
    const current = input.companyId === null ? organizationVersion : versions[input.companyId]
    if (String(input.organizationId) !== "7" || !current || current.id !== input.expectedVersionId) throw new Error("Synthetic publication scope or expected version did not match")
    if (failNext) { setFailNext(false); throw new Error("Synthetic publication rejected; edits retained") }
    const outcome = publish(input)
    if (unconfirmedNext) { setUnconfirmedNext(false); pendingOutcome.current = outcome; return { status: "unconfirmed", submission: outcome.submission, message: "Synthetic response lost; check the exact publication" } }
    return outcome
  }
  const check = async (submission: InvoiceProfileSubmission): Promise<InvoiceProfileSaveOutcome> => {
    setChecks((value) => value + 1)
    if (!pendingOutcome.current) throw new Error("No synthetic pending publication")
    if (JSON.stringify(submission) !== JSON.stringify(pendingOutcome.current.submission)) throw new Error("Synthetic check did not target the exact original publication")
    return pendingOutcome.current
  }
  const changeDefaults = () => {
    setVersions((previous) => ({ ...previous, [companyId]: { ...previous[companyId]!, id: String(++sequence.current), values: { ...previous[companyId]!.values, notice: "Newer company notice", footer: "Newer company footer" } } }))
    publicationChannel.current?.postMessage({ companyId })
  }
  return <main className="mx-auto min-w-0 max-w-7xl space-y-6 p-4 sm:p-6">
    <p className="text-xs text-muted-foreground" data-testid="personalization-fixture-disclosure" data-hydrated={hydrated}>Synthetic UI fixture — in-memory publication and invoice snapshots only. No ERP backend. One synthetic managed-shaped PNG asset is served locally.</p>
    <h1 className="break-words text-2xl font-semibold">Invoice personalization for international company operations</h1>
    <section aria-label="Synthetic fixture controls" className="flex flex-wrap gap-2">
      <Button onClick={() => setCompanyId(companyId === "11" ? "22" : "11")}>Switch synthetic company</Button>
      <Button onClick={changeDefaults}>Publish newer synthetic defaults</Button>
      <Button onClick={() => setFailNext(true)}>Reject next synthetic save</Button>
      <Button onClick={() => setUnconfirmedNext(true)}>Lose next synthetic response</Button>
      <Button onClick={() => setTheme("dark")}>Dark workspace</Button>
      <Button onClick={() => setTheme("light")}>Light workspace</Button>
      <Button onClick={() => setState(state === "ready" ? "denied" : "ready")}>Toggle synthetic access</Button>
      <Button onClick={() => setOpen(true)}>Compose synthetic invoice</Button>
      <Button onClick={() => setVersions((previous) => ({ ...previous, [companyId]: { ...previous[companyId]!, id: String(++sequence.current), values: { ...previous[companyId]!.values, notice: longNotice, terms: `${longNotice}\nSynthetic terms.`, paymentInstructions: "Synthetic payment instructions; do not remit funds.", footer: longNotice } } }))}>Load long synthetic content</Button>
    </section>
    <output data-testid="synthetic-publication-state" className="block break-words text-sm">Company {companyId}; save callbacks {dispatches}; check callbacks {checks}; last scope {lastScope || "none"}</output>
    {uploadScope && <p role="status">Synthetic PNG upload callback for company {uploadScope}</p>}
    <InvoicePersonalizationEditor organizationId={7} companyId={companyId} companyName={company.name} company={company} state={{ status: state }} profile={profile} organizationVersion={organizationVersion} companyVersion={companyVersion} canPublishOrganization canPublishCompany onSave={save} onCheck={check} uploadInvoiceLogo={async (_file, scope) => { setUploadScope(scope ?? "organization"); return syntheticLogoUrl }} />
    {issuedMetadata ? <section aria-label="Synthetic issued snapshot" className="min-w-0 space-y-3"><h2 className="text-xl font-semibold">Synthetic issued snapshot — not a backend posting</h2><InvoiceDocument title="Invoice" reference="SYNTHETIC-ISSUED-1" partnerLabel="Bill to" partner="Synthetic customer" currency={{ code: "EUR" }} subtotal={1250} tax={0} total={1250} {...readInvoiceDocumentContent(issuedMetadata, 7)} /><output data-testid="synthetic-invoice-content" className="block break-all text-xs">{capturedContent}</output></section> : null}
    <CreateInvoiceModal open={open} companyId={BigInt(companyId)} onClose={() => setOpen(false)} profile={profile} profileVersionIds={profileVersionIds} seller={seller} personalizationState={{ status: state }}
      onSave={async (params: CreateManualAccountInvoiceParams) => {
        // Emulate the persistence boundary explicitly. The production resolver, not a duplicate renderer, constructs the controlled issued snapshot.
        const resolved = resolveDraftInvoiceDocument(params.metadata, profile, profileVersionIds, seller)
        if (!resolved.personalization) throw new Error(resolved.personalizationError ?? "Synthetic snapshot unavailable")
        setIssuedMetadata(JSON.stringify({ invoiceDocument: resolved.personalization })); setCapturedContent(String(params.metadata))
        return { kind: "converged", dispatch: "acknowledged", ref: { resource: "account-moves", id: "synthetic-only" } } as const
      }} onCheckStatus={async () => null}
      journalOptions={[{ value: "1", label: "Synthetic sales journal", currencyId: "1" }]} partnerOptions={[{ value: "2", label: "Synthetic customer" }]}
      counterpartAccountOptions={[{ value: "3", label: "Synthetic receivables" }]} lineAccountOptions={[{ value: "4", label: "Synthetic revenue" }]}
      currencyOptions={[{ value: "1", label: "Euro (EUR)", code: "EUR" }]} />
  </main>
}

export default function PersonalizationFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light"><Personalization /></ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
