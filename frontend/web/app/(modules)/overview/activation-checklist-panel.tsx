"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { Button } from "@lumiere/ui/components/button"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import {
  activationChecklist, activationTaskHref, availableActivationTasks, selectedActivationTask,
  type ActivationCheckState,
} from "./activation-checklist"

/** Deterministic post-tenant assistance; forms remain the only business owners. */
export function ActivationChecklistPanel({ organizationId, companyId }: { organizationId: number; companyId: number | null }) {
  const { t } = useTranslation()
  const { currentUser, checkPermission, permissionsReady, isAdmin } = useRBAC()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const companies = useCompanies(organizationId, true)
  const contacts = useContacts(BigInt(organizationId))
  const permissionsCurrent = permissionsReady !== false && currentUser != null
  const tasks = permissionsCurrent ? availableActivationTasks((resource, action) => checkPermission(resource, action).allowed) : []
  const selected = selectedActivationTask(searchParams.get("activation"), tasks)
  const checks = activationChecklist({ organizationId, companyId, companies, contacts })
  const taskLabels = {
    contact: t("activation.tasks.contact", { defaultValue: "Add a contact" }),
    quotation: t("activation.tasks.quotation", { defaultValue: "Prepare a quotation" }),
    expense: t("activation.tasks.expense", { defaultValue: "Capture an expense" }),
    accounting: t("activation.tasks.accounting", { defaultValue: "Set up accounting" }),
    reports: t("activation.tasks.reports", { defaultValue: "Review reports" }),
  }
  const taskGuidance = {
    contact: t("activation.guidance.contact", { defaultValue: "Open Contacts, choose New contact and enter the details. Save in the form, then return here to refresh the checks." }),
    quotation: t("activation.guidance.quotation", { defaultValue: "In Sales, choose New quotation, then select a customer, currency and price list. Add products and review their prices before confirming an order." }),
    expense: t("activation.guidance.expense", { defaultValue: "Use the expense capture form to choose an employee, product and price list, enter the amount and attach a receipt. Saving a draft does not approve or reimburse it." }),
    accounting: t("activation.guidance.accounting", { defaultValue: "Accounting checks your fiscal years, open periods, journals, accounts and taxes. Follow the setup actions to complete missing details before posting." }),
    reports: t("activation.guidance.reports", { defaultValue: "Open Reports and choose your company, accounting period and report. Check its sources and limitations before using a preview for a financial decision." }),
  }
  function stateLabel(state: ActivationCheckState): string {
    switch (state) {
      case "ready": return t("activation.states.ready", { defaultValue: "Available" })
      case "missing": return t("activation.states.missing", { defaultValue: "Needs setup" })
      case "unavailable": return t("activation.states.unavailable", { defaultValue: "Could not verify" })
      case "loading": return t("common.loading")
    }
  }
  const rows = [
    { id: "company", label: t("activation.checks.company", { defaultValue: "Current company access" }), state: checks.companyState },
    { id: "currency", label: t("activation.checks.currency", { defaultValue: "Company base currency assigned" }), state: checks.currencyState },
    { id: "fiscal", label: t("activation.checks.fiscal", { defaultValue: "Company fiscal year-end recorded" }), state: checks.fiscalState },
    ...(selected === "contact" ? [{ id: "contact", label: t("activation.checks.contact", { defaultValue: "Saved contact in this company" }), state: checks.contactState }] : []),
    ...(selected === "quotation" ? [{ id: "customer", label: t("activation.checks.customer", { defaultValue: "Saved customer in this company" }), state: checks.customerState }] : []),
  ]
  return <section aria-labelledby="activation-title" data-testid="activation-checklist" className="min-w-0 rounded-xl border p-4 sm:p-6">
    <h2 id="activation-title" className="text-lg font-semibold">{t("activation.title", { defaultValue: "Getting started" })}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("activation.description", { defaultValue: "Choose a first task for your role. Check your company settings and find the form you need." })}</p>
    {!permissionsCurrent ? <p role="status" className="mt-3 text-sm">{t("activation.permissionsUnavailable", { defaultValue: "Current permissions are unavailable. Refresh your session before choosing a task." })}</p> : <>
      <ul className="my-4 space-y-2 text-sm" aria-live="polite">
        {rows.map(row => <li key={row.id} data-check={row.id} data-state={row.state} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1"><span>{row.label}</span><span className="font-medium">{stateLabel(row.state)}</span></li>)}
      </ul>
      <p className="text-xs text-muted-foreground">{t("activation.scopeNote", { defaultValue: "Review saved records before using them for business; they may include sample data. Each form checks required fields and your current permissions when you save." })}</p>
      {companyId == null && <p role="status" className="mt-3 text-sm">{t("activation.selectCompany", { defaultValue: "Select a company in the workspace company selector to check its setup and start a task." })}</p>}
      {tasks.length ? <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-medium">{t("activation.chooseTask", { defaultValue: "What would you like to do first?" })}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {tasks.map(task => <label key={task} className="flex items-center gap-2 text-sm"><input type="radio" name="activation-task" value={task} checked={selected === task} onChange={() => {
            const next = new URLSearchParams(searchParams.toString())
            next.set("activation", task)
            router.replace(`${pathname}?${next}`, { scroll: false })
          }} />{taskLabels[task]}</label>)}
        </div>
      </fieldset> : <p className="mt-4 text-sm">{t("activation.noTasks", { defaultValue: "No supported first task is available for your current permissions. Ask your organization administrator for the access needed for your work." })}</p>}
      {selected && <div className="mt-4 space-y-3">
        <p className="max-w-3xl text-sm">{taskGuidance[selected]}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={checks.companyState !== "ready"} onClick={() => router.push(activationTaskHref(selected))}>{taskLabels[selected]}</Button>
          {isAdmin() && checkPermission("admin:organization", "update").allowed && <Button type="button" variant="outline" onClick={() => router.push("/settings?section=organization")}>{t("activation.companySettings", { defaultValue: "Review company settings" })}</Button>}
        </div>
      </div>}
    </>}
    <Button type="button" variant="outline" className="mt-4" disabled={companies.isFetching || contacts.isFetching} onClick={() => { void Promise.allSettled([companies.refetch(), contacts.refetch()]) }}>{t("activation.refresh", { defaultValue: "Refresh checks" })}</Button>
  </section>
}
