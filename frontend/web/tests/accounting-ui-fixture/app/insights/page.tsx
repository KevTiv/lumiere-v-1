"use client"

import { useEffect, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider, useTheme } from "../../../../../packages/ui/src/components/theme-provider"
import { Button } from "../../../../../packages/ui/src/components/button"
import { AccountantOverview } from "../../../../app/(modules)/accounting/accountant-overview"
import type { ModuleDataState } from "../../../../../packages/ui/src/lib/module-data-state"
import { fixtureNow, overviewFixture } from "../../fixtures"

function InsightsFixture() {
  const { setTheme } = useTheme()
  const [hydrated, setHydrated] = useState(false)
  const [movesState, setMovesState] = useState<ModuleDataState["status"]>("ready")
  const [currenciesState, setCurrenciesState] = useState<ModuleDataState["status"]>("ready")
  const [companyId, setCompanyId] = useState(1n)
  const [message, setMessage] = useState("")
  useEffect(() => setHydrated(true), [])
  const state = (status: ModuleDataState["status"]): ModuleDataState => ({ status })
  const data = {
    ...overviewFixture, companyId,
    moves: { rows: [...overviewFixture.moves.rows,
      { id: "9007199254740993", organizationId: 1, companyId: 2, name: "SYNTHETIC SECOND COMPANY", moveType: "OutInvoice", state: "Posted", amountTotal: 500, amountResidual: 250, currencyId: 2, invoiceDate: "2026-10-01", invoiceDateDue: "2026-10-30" },
    ], state: state(movesState) },
    currencies: { rows: overviewFixture.currencies.rows, state: state(currenciesState) },
    companies: { rows: [{ id: 1, organizationId: 1, currencyId: 1 }, { id: 2, organizationId: 1, currencyId: 2 }], state: state("ready") },
  }
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 p-4 sm:p-6">
    <p className="text-xs text-muted-foreground" data-testid="insights-fixture-disclosure" data-hydrated={hydrated}>Synthetic financial UI preview — no database or API operations.</p>
    <div className="flex flex-wrap gap-3">
      <label className="text-xs">Synthetic document source<select aria-label="Synthetic document source" className="ml-2 h-11 rounded-md border bg-background px-2" value={movesState} onChange={(event) => setMovesState(event.target.value as ModuleDataState["status"])}>{["ready", "loading", "denied", "error", "partial"].map((status) => <option key={status}>{status}</option>)}</select></label>
      <Button variant="outline" onClick={() => setCurrenciesState((value) => value === "ready" ? "denied" : "ready")}>Toggle synthetic currency access</Button>
      <Button variant="outline" onClick={() => setCompanyId((value) => value === 1n ? 2n : 1n)}>Switch synthetic company</Button>
      <Button variant="outline" onClick={() => setTheme("dark")}>Synthetic dark theme</Button>
    </div>
    <p role="status" data-testid="insights-fixture-action">{message}</p>
    <AccountantOverview data={data} now={fixtureNow} companyName={`Synthetic Company ${companyId}`}
      onNavigate={(tab) => setMessage(`Synthetic navigation: ${tab}`)}
      onCreateInvoice={() => setMessage("Synthetic draft review requested")}
      onOpenBankLine={(line) => setMessage(`Synthetic bank line: ${String(line.id)}`)} />
  </main>
}
export default function Page() { return <I18nProvider><ThemeProvider defaultTheme="light" storageKey="lumiere-insights-fixture-theme"><InsightsFixture /></ThemeProvider></I18nProvider> }
