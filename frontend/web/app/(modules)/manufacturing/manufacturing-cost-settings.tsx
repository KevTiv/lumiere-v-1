"use client"
import { useTranslation } from "@lumiere/i18n"


import { useEffect, useState } from "react"
import { Button, FormModal, EntityView, useRBAC, type FormConfig, type EntityViewConfig } from "@lumiere/ui"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { canUseModuleData, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { useAccountAccounts, useAccountJournals } from "@lumiere/query-hooks/hooks/accounting"
import { useConfigureManufacturingValuation, useMrpValuationConfigs, useMrpWorkcenterCostRates } from "@lumiere/query-hooks/hooks/manufacturing-costs"
import { toManufacturingValuationParams } from "@/lib/manufacturing-cost-params"

export function ManufacturingCostSettings({ organizationId, companyId }: { organizationId: bigint; companyId: bigint }) {
  const { t } = useTranslation()
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
    { name: "journalId", label: t("manufacturing.manufacturingCostSettings.valuationJournal"), options: journalOptions },
    { name: "materialAccountId", label: t("manufacturing.manufacturingCostSettings.materialInventoryAccount"), options: accountOptions },
    { name: "outputAccountId", label: t("manufacturing.manufacturingCostSettings.outputInventoryAccount"), options: accountOptions },
    { name: "workcenterAccountId", label: t("manufacturing.manufacturingCostSettings.workcenterAbsorptionAccount"), options: accountOptions },
    { name: "varianceAccountId", label: t("manufacturing.manufacturingCostSettings.manufacturingVarianceAccount"), options: accountOptions },
  ] as const
  const form: FormConfig = {
    id: "manufacturing-valuation-config",
    title: t("manufacturing.manufacturingCostSettings.configureManufacturingValuation"),
    description: t("manufacturing.manufacturingCostSettings.futureManufacturingClosesWillPostAnEntryUsingTheseCompanyCurrency"),
    submitLabel: t("manufacturing.manufacturingCostSettings.saveValuationConfiguration"),
    sections: [{ id: "valuation-accounts", fields: fields.map(field => ({
      type: "select" as const, id: field.name, name: field.name, label: field.label, required: true,
      options: [...field.options], defaultValue: config?.[field.name] != null ? String(config[field.name]) : "",
    })) }],
  }
  const rateTable: EntityViewConfig = {
    id: "manufacturing-cost-rates", title: t("manufacturing.manufacturingCostSettings.configuredWorkcenterRates"),
    view: { mode: "table", rowKey: "workcenterId", columns: [
      { key: "workcenterId", label: t("manufacturing.manufacturingCostReadback.workcenter") }, { key: "hourlyRate", label: t("manufacturing.manufacturingCostReadback.hourlyRate"), type: "number" }, { key: "currencyId", label: t("accounting.overview.currency") },
    ], emptyMessage: t("manufacturing.manufacturingCostSettings.noWorkcenterRatesConfiguredUseConfigureHourlyCostRateOnA") },
  }
  const referencesReady = journalsState.status === "ready" && accountsState.status === "ready" && journalOptions.length > 0 && accountOptions.length > 0
  return (
    <div className="space-y-6" data-testid="manufacturing-cost-settings">
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("manufacturing.manufacturingCostSettings.ratesAreSavedInCompanyCurrencyProductivityRecordsRetainTheRate")}</p>
        <ModuleDataNotice state={ratesState} />
        {canUseModuleData(ratesState) && <EntityView config={rateTable} data={rates} isLoading={ratesState.status === "loading"} />}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">{t("manufacturing.manufacturingCostSettings.manufacturingValuation")}</h2>
        <ModuleDataNotice state={valuationState} />
        {valuationState.status === "ready" && <p data-testid="manufacturing-valuation-status">
          {config ? t("manufacturing.manufacturingCostSettings.configuredForCompanyCurrencyJournal", { value1: config.companyId, value2: config.currencyId, value3: config.journalId }) : t("manufacturing.manufacturingCostSettings.notConfiguredManufacturingClosesRecordCostsWithoutAJournalEntry")}
        </p>}
        {config && <dl className="grid grid-cols-2 gap-2 text-sm">{fields.map(field => <div key={field.name}><dt>{field.label}</dt><dd>{String(config[field.name])}</dd></div>)}</dl>}
        {canConfigure && <>
          <ModuleDataNotice state={journalsState} /><ModuleDataNotice state={accountsState} />
          <Button disabled={!referencesReady || companyId <= 0n || !canUseModuleData(valuationState)} data-testid="manufacturing-configure-valuation" onClick={() => { setSubmitError(null); setSaved(false); setOpen(true) }}>{t("manufacturing.manufacturingCostSettings.configureValuation")}</Button>
          {!referencesReady && journalsState.status === "ready" && accountsState.status === "ready" && <p className="text-sm">{t("manufacturing.manufacturingCostSettings.createAnActiveJournalAndValuationAccountsBeforeConfiguringManufacturingValuation")}</p>}
        </>}
        {saved && <p role="status" data-testid="manufacturing-valuation-saved">{t("manufacturing.manufacturingCostSettings.valuationConfigurationSavedAndReadBackForThisCompany")}</p>}
      </section>
      <FormModal config={form} open={open} onOpenChange={setOpen} closeOnSubmit={false} submitError={submitError} isPending={mutation.isPending} onSubmit={async values => {
        setSubmitError(null)
        try { await mutation.mutateAsync(toManufacturingValuationParams(values)); setSaved(true); setOpen(false) }
        catch (error) { setSubmitError(error instanceof Error ? error.message : String(error)) }
      }} />
    </div>
  )
}
