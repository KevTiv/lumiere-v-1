"use client"

import { useEffect, useState } from "react"
import { Button, FormModal, EntityView, useRBAC, type FormConfig, type EntityViewConfig } from "@lumiere/ui"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { canUseModuleData, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { useAccountAccounts, useAccountJournals } from "@lumiere/query-hooks/hooks/accounting"
import { useConfigureManufacturingValuation, useMrpValuationConfigs, useMrpWorkcenterCostRates } from "@lumiere/query-hooks/hooks/manufacturing-costs"
import { toManufacturingValuationParams } from "@/lib/manufacturing-cost-params"

export function ManufacturingCostSettings({ organizationId, companyId }: { organizationId: bigint; companyId: bigint }) {
  const { permissionsReady, checkPermission } = useRBAC()
  const canConfigure = permissionsReady !== false && checkPermission("account_journal", "write").allowed
  const ratesQuery = useMrpWorkcenterCostRates(organizationId)
  const valuationQuery = useMrpValuationConfigs(organizationId)
  const journalsQuery = useAccountJournals(organizationId, { enabled: canConfigure })
  const accountsQuery = useAccountAccounts(organizationId, { enabled: canConfigure })
  const mutation = useConfigureManufacturingValuation(organizationId, companyId)
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setOpen(false); setSaved(false); setSubmitError(null) }, [organizationId, companyId])
  const ratesState = moduleQueryState(ratesQuery)
  const valuationState = moduleQueryState(valuationQuery)
  const journalsState = moduleQueryState(journalsQuery)
  const accountsState = moduleQueryState(accountsQuery)
  const rates = canUseModuleData(ratesState) ? ratesQuery.data ?? [] : []
  const configs = canUseModuleData(valuationState) ? valuationQuery.data ?? [] : []
  const config = configs.find(row => row.companyId === companyId && row.organizationId === organizationId)
  const journals = canUseModuleData(journalsState) ? journalsQuery.data ?? [] : []
  const accounts = canUseModuleData(accountsState) ? accountsQuery.data ?? [] : []
  const journalOptions = journals.filter(row => row.active !== false).map(row => ({ value: String(row.id), label: `${row.code ?? ""} ${row.name ?? row.id}`.trim() }))
  const accountOptions = accounts.filter(row => row.deprecated !== true).map(row => ({ value: String(row.id), label: `${row.code ?? ""} ${row.name ?? row.id}`.trim() }))
  const fields = [
    { name: "journalId", label: "Valuation journal", options: journalOptions },
    { name: "materialAccountId", label: "Material inventory account", options: accountOptions },
    { name: "outputAccountId", label: "Output inventory account", options: accountOptions },
    { name: "workcenterAccountId", label: "Workcenter absorption account", options: accountOptions },
    { name: "varianceAccountId", label: "Manufacturing variance account", options: accountOptions },
  ] as const
  const form: FormConfig = {
    id: "manufacturing-valuation-config",
    title: "Configure manufacturing valuation",
    description: "Future manufacturing closes will post an entry using these company-currency accounts. Existing cost snapshots are immutable.",
    submitLabel: "Save valuation configuration",
    sections: [{ id: "valuation-accounts", fields: fields.map(field => ({
      type: "select" as const, id: field.name, name: field.name, label: field.label, required: true,
      options: [...field.options], defaultValue: config?.[field.name] != null ? String(config[field.name]) : "",
    })) }],
  }
  const rateTable: EntityViewConfig = {
    id: "manufacturing-cost-rates", title: "Configured workcenter rates",
    view: { mode: "table", rowKey: "workcenterId", columns: [
      { key: "workcenterId", label: "Workcenter" }, { key: "hourlyRate", label: "Hourly rate", type: "number" }, { key: "currencyId", label: "Currency" },
    ], emptyMessage: "No workcenter rates configured. Use Configure hourly cost rate on a workcenter." },
  }
  const referencesReady = journalsState.status === "ready" && accountsState.status === "ready" && journalOptions.length > 0 && accountOptions.length > 0
  return (
    <div className="space-y-6" data-testid="manufacturing-cost-settings">
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">Rates are saved in company currency. Productivity records retain the rate used when time is logged; missing rates remain explicitly unconfigured.</p>
        <ModuleDataNotice state={ratesState} />
        {canUseModuleData(ratesState) && <EntityView config={rateTable} data={rates} isLoading={ratesState.status === "loading"} />}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Manufacturing valuation</h2>
        <ModuleDataNotice state={valuationState} />
        {valuationState.status === "ready" && <p data-testid="manufacturing-valuation-status">
          {config ? `Configured for company ${config.companyId}, currency ${config.currencyId}, journal ${config.journalId}.` : "Not configured. Manufacturing closes record costs without a journal entry."}
        </p>}
        {config && <dl className="grid grid-cols-2 gap-2 text-sm">{fields.map(field => <div key={field.name}><dt>{field.label}</dt><dd>{String(config[field.name])}</dd></div>)}</dl>}
        {canConfigure && <>
          <ModuleDataNotice state={journalsState} /><ModuleDataNotice state={accountsState} />
          <Button disabled={!referencesReady || companyId <= 0n || !canUseModuleData(valuationState)} data-testid="manufacturing-configure-valuation" onClick={() => { setSubmitError(null); setSaved(false); setOpen(true) }}>Configure valuation</Button>
          {!referencesReady && journalsState.status === "ready" && accountsState.status === "ready" && <p className="text-sm">Create an active journal and valuation accounts before configuring manufacturing valuation.</p>}
        </>}
        {saved && <p role="status" data-testid="manufacturing-valuation-saved">Valuation configuration saved and read back for this company.</p>}
      </section>
      <FormModal config={form} open={open} onOpenChange={setOpen} closeOnSubmit={false} submitError={submitError} isPending={mutation.isPending} onSubmit={async values => {
        setSubmitError(null)
        try { await mutation.mutateAsync(toManufacturingValuationParams(values)); setSaved(true); setOpen(false) }
        catch (error) { setSubmitError(error instanceof Error ? error.message : String(error)) }
      }} />
    </div>
  )
}
