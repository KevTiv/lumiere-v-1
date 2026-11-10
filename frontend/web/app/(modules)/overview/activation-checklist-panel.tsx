"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { Button } from "@lumiere/ui/components/button"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import { apiFetch } from "@lumiere/query-hooks/http"
import { useAssistantNativeForms } from "@lumiere/ui/components/assistant-native-form-provider"
import {
  activationChecklist, activationCreateTask, activationForm, activationReceiptKey, activationRecordHref,
  activationTaskHref, availableActivationTasks, matchesActivationRecord, parseActivationReceipt, selectedActivationTask,
  type ActivationCheckState, type ActivationReceipt,
} from "./activation-checklist"

/** Deterministic post-tenant assistance; forms remain the only business owners. */
export function ActivationChecklistPanel({ organizationId, companyId, collapseWhenReady = false }: { organizationId: number; companyId: number | null; collapseWhenReady?: boolean }) {
  const { t } = useTranslation()
  const { currentUser, checkPermission, permissionsReady, isAdmin } = useRBAC()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const nativeForms = useAssistantNativeForms()
  const scope = nativeForms?.scopeKey ?? null
  const [receiptState, setReceiptState] = useState<{ scope: string; receipt: ActivationReceipt | null } | null>(null)
  const [startErrorScope, setStartErrorScope] = useState<string | null>(null)
  useEffect(() => {
    if (!scope) return
    let receipt: ActivationReceipt | null = null
    try { receipt = parseActivationReceipt(window.localStorage.getItem(activationReceiptKey(scope))) }
    catch { /* Browser storage may be unavailable. */ }
    setReceiptState({ scope, receipt })
  }, [scope])
  const companies = useCompanies(organizationId, true)
  const contacts = useContacts(BigInt(organizationId))
  const permissionsCurrent = permissionsReady !== false && currentUser != null
  const tasks = permissionsCurrent ? availableActivationTasks((resource, action) => checkPermission(resource, action).allowed) : []
  const selected = selectedActivationTask(searchParams.get("activation"), tasks)
  const checks = activationChecklist({ organizationId, companyId, companies, contacts })
  const receipt = receiptState?.scope === scope ? receiptState?.receipt : null
  const receiptForm = activationForm(receipt?.task ?? null)
  const canVerifyReceipt = permissionsCurrent && checks.companyState === "ready" && receiptForm != null
    && checkPermission(receiptForm.permission, "read").allowed
  const readback = useQuery({
    queryKey: ["activation-saved-record", scope, receipt?.task, receipt?.recordId],
    enabled: canVerifyReceipt,
    refetchOnMount: "always",
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!receipt || !receiptForm || companyId == null) return false
      const isExpense = receipt.task === "expense"
      const path = isExpense ? `/api/query/${receiptForm.resource}`
        : `/api/authoritative/${receiptForm.resource}/${receipt.recordId}`
      const response = await apiFetch(`${path}?companyId=${companyId}`, { cache: "no-store", signal })
      if (!response.ok) return false
      const { data } = await response.json()
      return isExpense ? Array.isArray(data) && data.some(row => matchesActivationRecord(row, receipt, organizationId, companyId))
        : matchesActivationRecord(data, receipt, organizationId, companyId)
    },
  })
  const confirmed = canVerifyReceipt && readback.isSuccess && !readback.isFetching && readback.data === true
  const selectedForm = activationForm(selected)
  const status = searchParams.get("activationStatus")

  function startTask() {
    if (!selected) return
    const task = activationCreateTask(selected)
    if (!task || !selectedForm) {
      router.push(activationTaskHref(selected))
      return
    }
    if (!nativeForms || !scope) return
    setStartErrorScope(null)
    const requestId = crypto.randomUUID()
    const destination = new URL(activationTaskHref(task), window.location.origin)
    destination.searchParams.set("activationForm", requestId)
    const result = nativeForms.requestForm({
      requestId, scopeKey: scope, moduleId: selectedForm.moduleId, tabId: selectedForm.tabId,
      onActivationReturn: (outcome) => {
        const current = new URL(window.location.href)
        if (current.pathname !== destination.pathname || current.searchParams.get("activationForm") !== requestId) return
        const next = new URLSearchParams(searchParams.toString())
        next.set("activation", task)
        next.delete("activationStatus")
        if (outcome.status === "saved") {
          try { window.localStorage.setItem(activationReceiptKey(scope), JSON.stringify({ task, recordId: outcome.recordId })) }
          catch { /* Current record access still requires server verification. */ }
        } else next.set("activationStatus", outcome.status)
        router.replace(`${pathname}?${next}`)
      },
    })
    if (result === "pending") router.push(`${destination.pathname}${destination.search}`)
    else setStartErrorScope(scope)
  }
  const taskLabels = {
    contact: t("activation.tasks.contact", { defaultValue: "Add a contact" }),
    quotation: t("activation.tasks.quotation", { defaultValue: "Prepare a quotation" }),
    expense: t("activation.tasks.expense", { defaultValue: "Capture an expense" }),
    accounting: t("activation.tasks.accounting", { defaultValue: "Set up accounting" }),
    reports: t("activation.tasks.reports", { defaultValue: "Review reports" }),
  }
  const taskGuidance = {
    contact: t("activation.guidance.contact", { defaultValue: "Enter the contact’s name and save it in this company." }),
    quotation: t("activation.guidance.quotation", { defaultValue: "Choose a customer, price list and warehouse to save a quotation. Open the saved quotation to add products." }),
    expense: t("activation.guidance.expense", { defaultValue: "Choose an employee, enter the expense details and attach a receipt if needed. The form saves a draft for review." }),
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
  const outcomeMessage = status === "cancelled" ? t("activation.outcome.cancelled", { defaultValue: "Form closed. You can start this task again." })
    : status === "denied" ? t("activation.outcome.denied", { defaultValue: "Your access changed. Check your permissions before trying again." })
      : status === "scope_changed" ? t("activation.outcome.scopeChanged", { defaultValue: "The workspace changed. Check the selected company before trying again." })
        : status === "busy" || (startErrorScope != null && startErrorScope === scope)
          ? t("activation.outcome.busy", { defaultValue: "Another form or retained request is open. Review it in the workspace before trying again." })
          : status === "unavailable" ? t("activation.outcome.unavailable", { defaultValue: "The form could not open. Review the workspace and try again." }) : null
  const completed = collapseWhenReady && confirmed && !searchParams.has("activation")
  const content = <section aria-labelledby="activation-title" data-testid="activation-checklist" className="min-w-0 rounded-xl border p-4 sm:p-6">
    {!completed && <h2 id="activation-title" className="text-lg font-semibold">{t("activation.title", { defaultValue: "Getting started" })}</h2>}
    <p className="mt-1 text-sm text-muted-foreground">{t("activation.description", { defaultValue: "Choose a first task and check your company setup before starting." })}</p>
    {!permissionsCurrent ? <p role="status" className="mt-3 text-sm">{t("activation.permissionsUnavailable", { defaultValue: "Current permissions are unavailable. Refresh your session before choosing a task." })}</p> : <>
      <ul className="my-4 space-y-2 text-sm" aria-live="polite">
        {rows.map(row => <li key={row.id} data-check={row.id} data-state={row.state} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1"><span>{row.label}</span><span className="font-medium">{stateLabel(row.state)}</span></li>)}
      </ul>
      <p className="text-xs text-muted-foreground">{t("activation.scopeNote", { defaultValue: "Review saved records before using them for business; they may include sample data. Each form checks required fields and your current permissions when you save." })}</p>
      {companyId == null && <p role="status" className="mt-3 text-sm">{t("activation.selectCompany", { defaultValue: "Select a company in the workspace company selector to check its setup and start a task." })}</p>}
      {outcomeMessage && <p role="status" className="mt-3 text-sm">{outcomeMessage}</p>}
      {receipt && canVerifyReceipt && <div className="mt-4 space-y-1 border-t pt-3 text-sm" role="status">
        {confirmed ? <>
          <p className="font-medium">{receipt.task === "contact"
            ? t("activation.outcome.contactSaved", { defaultValue: "Contact saved in this company." })
            : receipt.task === "quotation"
              ? t("activation.outcome.quotationSaved", { defaultValue: "Quotation saved in this company." })
              : t("activation.outcome.expenseSaved", { defaultValue: "Expense draft saved in this company." })}</p>
          <Link className="text-primary underline underline-offset-2" href={activationRecordHref(receipt)}>{t("activation.outcome.openRecord", { defaultValue: "Open saved record" })}</Link>
        </> : <p>{readback.isFetching ? t("activation.outcome.checking", { defaultValue: "Checking the saved record…" })
          : t("activation.outcome.unverified", { defaultValue: "The saved record could not be verified in this company. Refresh checks to try again." })}</p>}
      </div>}
      {tasks.length ? <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-medium">{t("activation.chooseTask", { defaultValue: "What would you like to do first?" })}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {tasks.map(task => <label key={task} className="flex items-center gap-2 text-sm"><input type="radio" name="activation-task" value={task} checked={selected === task} onChange={() => {
            const next = new URLSearchParams(searchParams.toString())
            next.set("activation", task)
            next.delete("activationStatus")
            setStartErrorScope(null)
            router.replace(`${pathname}?${next}`, { scroll: false })
          }} />{taskLabels[task]}</label>)}
        </div>
      </fieldset> : <p className="mt-4 text-sm">{t("activation.noTasks", { defaultValue: "No supported first task is available for your current permissions. Ask your organization administrator for the access needed for your work." })}</p>}
      {selected && <div className="mt-4 space-y-3">
        <p className="max-w-3xl text-sm">{taskGuidance[selected]}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={checks.companyState !== "ready" || (selectedForm != null && (!scope || nativeForms?.pending != null))} onClick={startTask}>{taskLabels[selected]}</Button>
          {selectedForm && outcomeMessage && <Button type="button" variant="outline" onClick={() => router.push(activationTaskHref(selected))}>{t("activation.outcome.openWorkspace", { defaultValue: "Open task workspace" })}</Button>}
          {isAdmin() && checkPermission("admin:organization", "update").allowed && <Button type="button" variant="outline" onClick={() => router.push("/settings?section=organization")}>{t("activation.companySettings", { defaultValue: "Review company settings" })}</Button>}
        </div>
      </div>}
    </>}
    <Button type="button" variant="outline" className="mt-4" disabled={companies.isFetching || contacts.isFetching || readback.isFetching} onClick={() => { void Promise.allSettled([companies.refetch(), contacts.refetch(), ...(canVerifyReceipt ? [readback.refetch()] : [])]) }}>{t("activation.refresh", { defaultValue: "Refresh checks" })}</Button>
  </section>
  return completed ? <details className="min-w-0 rounded-xl border p-4 sm:p-6">
    <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <h2 id="activation-title" className="inline text-lg font-semibold">{t("activation.title", { defaultValue: "Getting started" })}</h2>
      <span className="ml-3 text-sm text-muted-foreground">{t("activation.reviewSetup", { defaultValue: "Review setup and first tasks" })}</span>
    </summary>
    <div className="mt-4">{content}</div>
  </details> : content
}
