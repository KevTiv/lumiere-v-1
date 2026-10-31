"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon, FileTextIcon, MessageSquareMoreIcon, PlusIcon, ScrollTextIcon, XIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import {
  mergeSelectOptionsForFields,
  newInvoiceReminderBatchForm,
  newMessageBatchForm,
  newMessageTemplateForm,
  RuntimeFormModal,
  FormModal,
} from "@lumiere/ui"
import type { CustomField, FormConfig } from "@lumiere/ui"
import type { CreateInvoiceReminderBatchParams, CreateMessageBatchParams, CreateMessageTemplateParams, MessageChannel } from "@lumiere/stdb/types"
import {
  useCreateInvoiceReminderBatch,
  useCreateMessageBatch,
  useCreateMessageTemplate,
  useMessageBatches,
  useMessageBatchExclusions,
  useMessageTemplates,
  useReviewMessageBatch,
  useOperationalMessages,
} from "@lumiere/query-hooks/hooks/messages"
import { nullableBigIntU64 as asId } from "@lumiere/erp-shared/form-coercion"
import { useCrmConversationMessages } from "@lumiere/query-hooks/hooks/crm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { batchEvidenceComplete, batchExclusions, batchExclusionReason, batchInScope, filterBatchChoices, messageFailureReason, messageProviderEvidence, messagesForBatch, type BatchReviewEnvelope } from "./message-batch-review"

type Row = Record<string, unknown>
type PickerOption = { value: string; label: string; description?: string }
type PickerField = CustomField & { options?: PickerOption[] }

function enumName(value: unknown): string {
  return value != null && typeof value === "object" && "tag" in value
    ? String((value as { tag: unknown }).tag)
    : String(value ?? "")
}

function enumValue<T>(tag: string): T {
  return { tag } as T
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function ids(value: unknown): bigint[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",")
  const parsed = raw.map((item) => asId(item))
  if (parsed.some((id) => id == null || id <= 0n)) throw new Error("A selected record identifier is invalid. Review the current choices before saving.")
  return [...new Set(parsed.filter((id): id is bigint => id != null))]
}

function SelectionPicker({ field, value, onChange, error }: { field: CustomField; value: unknown; onChange: (value: unknown) => void; error?: string }) {
  const options = (field as PickerField).options ?? []
  const selected = new Set(Array.isArray(value) ? value.map(String) : [])
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const visible = filterBatchChoices(options, search)
  return <div className="space-y-2">
    <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t("messages.batchReview.searchChoices", { defaultValue: "Search available recipients or invoices" })} placeholder={t("common.search", { defaultValue: "Search" })} />
    <p className="text-xs text-muted-foreground" role="status">{t("messages.batchReview.selectedCount", { defaultValue: "{{count}} selected", count: selected.size })}</p>
    <ScrollArea className="max-h-56 rounded-md border">
    <div className="flex flex-col gap-2 p-3">
      {visible.map((option) => {
        const checked = selected.has(option.value)
        return <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={checked} onCheckedChange={(next) => {
            const nextValues = new Set(selected)
            if (next) nextValues.add(option.value)
            else nextValues.delete(option.value)
            onChange([...nextValues])
          }} aria-label={[option.label, option.description].filter(Boolean).join(" · ")} aria-invalid={Boolean(error)} />
          <span className="flex flex-col gap-0.5"><span>{option.label}</span>{option.description ? <span className="text-xs text-muted-foreground">{option.description}</span> : null}</span>
        </label>
      })}
      {visible.length === 0 ? <p className="text-sm text-muted-foreground">{t("messages.batchReview.noMatches", { defaultValue: "No matching choices. Your selections are retained." })}</p> : null}
    </div>
  </ScrollArea>
  </div>
}

function withSelectionPicker(config: FormConfig, fieldName: string, options: PickerOption[]): FormConfig {
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => field.name === fieldName
        ? { id: field.id, name: field.name, type: "custom", label: field.label, description: field.description, required: field.required, width: field.width, component: SelectionPicker, options } as PickerField
        : field),
    })),
  }
}

function selectedChannels(data: Row): MessageChannel[] {
  return [
    ["channelWhatsApp", "WhatsApp"],
    ["channelSms", "Sms"],
    ["channelEmail", "Email"],
    ["channelInApp", "InApp"],
  ].filter(([field]) => data[field] === true).map(([, channel]) => enumValue<MessageChannel>(channel))
}

export function MessageBatchesPanel({ organizationId, companyId, contacts, invoices }: { organizationId: number; companyId: bigint; contacts: Row[]; invoices: Row[] }) {
  const { t } = useTranslation()
  const session = useErpSession()
  const organization = BigInt(organizationId)
  const templatesQuery = useMessageTemplates(organization)
  const batchesQuery = useMessageBatches(organization)
  const evidenceQuery = useOperationalMessages(organization)
  const providerQuery = useCrmConversationMessages(organization)
  const exclusionsQuery = useMessageBatchExclusions(organization, companyId, JSON.stringify([session.identity, session.organizationId, session.activeCompanyId]))
  const exclusionsState = moduleQueryState({ ...exclusionsQuery, data: exclusionsQuery.isFetching ? undefined : exclusionsQuery.data, isLoading: exclusionsQuery.isFetching || exclusionsQuery.isPending })
  const templatesState = moduleQueryState(templatesQuery)
  const batchesState = moduleQueryState(batchesQuery)
  const evidenceState = moduleQueryState(evidenceQuery)
  const providerState = moduleQueryState(providerQuery)
  const templates = templatesState.status === "ready" ? templatesQuery.data ?? [] : []
  const batches = batchesState.status === "ready" ? (batchesQuery.data ?? []).filter((row) => batchInScope(row, organization, companyId)) : []
  const evidence = evidenceState.status === "ready" ? evidenceQuery.data ?? [] : []
  const createBatch = useCreateMessageBatch(organization)
  const createInvoiceReminder = useCreateInvoiceReminderBatch(organization)
  const createTemplate = useCreateMessageTemplate(organization)
  const reviewBatch = useReviewMessageBatch(organization)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewTarget, setReviewTarget] = useState<{ id: string; approved: boolean } | null>(null)
  const scope = `${organizationId}:${companyId}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  useEffect(() => {
    setBatchDialogOpen(false); setInvoiceDialogOpen(false); setTemplateDialogOpen(false)
    setReviewTarget(null); setError(null)
  }, [scope])

  const templateOptions = useMemo(() => (templates as Row[])
    .filter((template) => template.active !== false && stringValue(template.reviewState ?? template.review_state).toLowerCase() === "approved")
    .map((template) => ({ value: String(template.id), label: `${String(template.name ?? template.key ?? template.id)} · ${String(template.locale ?? "")}` })), [templates])
  const contactOptions = useMemo(() => contacts.map((contact) => ({
    value: String(contact.id),
    label: String(contact.displayName ?? contact.display_name ?? contact.name ?? contact.id),
    description: String(contact.mobile ?? contact.phone ?? "No primary phone shown"),
  })), [contacts])
  const invoiceOptions = useMemo(() => invoices
    .filter((invoice) => {
      const type = enumName(invoice.moveType ?? invoice.move_type)
      const state = enumName(invoice.state)
      const residual = Number(invoice.amountResidual ?? invoice.amount_residual ?? 0)
      const invoiceCompany = asId(invoice.companyId ?? invoice.company_id)
      return type === "OutInvoice" && state === "Posted" && Number.isFinite(residual) && residual > 0 && companyId > 0n && invoiceCompany === companyId
    })
    .map((invoice) => ({
      value: String(invoice.id),
      label: String(invoice.name ?? invoice.id),
      description: `${String(invoice.invoicePartnerDisplayName ?? invoice.invoice_partner_display_name ?? "Customer")} · ${Number(invoice.amountResidual ?? invoice.amount_residual ?? 0).toLocaleString()} due`,
    })), [companyId, invoices])
  const batchForm = useMemo(() => withSelectionPicker(mergeSelectOptionsForFields(newMessageBatchForm(t), { templateId: templateOptions }), "candidateContactIds", contactOptions), [contactOptions, t, templateOptions])
  const invoiceForm = useMemo(() => withSelectionPicker(mergeSelectOptionsForFields(newInvoiceReminderBatchForm(t), { templateId: templateOptions }), "invoiceIds", invoiceOptions), [invoiceOptions, t, templateOptions])
  const templateForm = useMemo(() => newMessageTemplateForm(t), [t])

  const saveTemplate = async (data: Row) => {
    try {
      setError(null)
      if (companyId <= 0n || templatesState.status !== "ready") throw new Error(t("messages.batchReview.sourceRequired", { defaultValue: "Choose a company and restore the required records before continuing. Your entries are retained." }))
      const channels = selectedChannels(data)
      if (channels.length === 0) throw new Error("Choose at least one allowed channel")
      const key = stringValue(data.key)
      const name = stringValue(data.name)
      const bodyTemplate = stringValue(data.bodyTemplate)
      if (!key || !name || !bodyTemplate) throw new Error("Enter a template key, name, and message body")
      const params: CreateMessageTemplateParams = {
        companyId: companyId > 0n ? companyId : undefined,
        key,
        name,
        locale: stringValue(data.locale) || "en",
        subject: stringValue(data.subject) || undefined,
        bodyTemplate,
        allowedVariables: stringValue(data.allowedVariables).split(",").map((item) => item.trim()).filter(Boolean),
        applicableChannels: channels,
        retentionClassification: "operational",
        metadata: undefined,
      }
      await createTemplate.mutateAsync(params)
      if (activeScope.current === scope) setTemplateDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create message template"
      if (activeScope.current === scope) setError(message)
      throw cause
    }
  }

  const saveBatch = async (data: Row) => {
    try {
      setError(null)
      if (companyId <= 0n || templatesState.status !== "ready" || batchesState.status !== "ready") throw new Error(t("messages.batchReview.sourceRequired", { defaultValue: "Choose a company and restore the required records before continuing. Your entries are retained." }))
      const templateId = asId(data.templateId)
      const candidateContactIds = ids(data.candidateContactIds)
      if (templateId == null || candidateContactIds.length === 0) throw new Error("Choose a template and at least one recipient")
      if (!templateOptions.some((option) => option.value === String(templateId)) || candidateContactIds.some((id) => !contactOptions.some((option) => option.value === String(id)))) throw new Error(t("messages.batchReview.selectionChanged", { defaultValue: "A selected record is no longer available. Review the current choices before saving." }))
      const params: CreateMessageBatchParams = { companyId: companyId > 0n ? companyId : undefined, templateId, channel: enumValue<MessageChannel>(String(data.channel || "WhatsApp")), subjectModel: stringValue(data.subjectModel) || "account.move", subjectQuery: undefined, candidateContactIds, metadata: undefined }
      await createBatch.mutateAsync(params)
      if (activeScope.current === scope) setBatchDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create message batch"
      if (activeScope.current === scope) setError(message)
      throw cause
    }
  }

  const saveInvoiceReminder = async (data: Row) => {
    try {
      setError(null)
      if (templatesState.status !== "ready" || batchesState.status !== "ready") throw new Error(t("messages.batchReview.sourceRequired", { defaultValue: "Choose a company and restore the required records before continuing. Your entries are retained." }))
      const templateId = asId(data.templateId)
      const invoiceIds = ids(data.invoiceIds)
      if (companyId <= 0n) throw new Error("Choose an active company before creating invoice reminders")
      if (templateId == null || invoiceIds.length === 0) throw new Error("Choose a template and at least one outstanding invoice")
      if (!templateOptions.some((option) => option.value === String(templateId)) || invoiceIds.some((id) => !invoiceOptions.some((option) => option.value === String(id)))) throw new Error(t("messages.batchReview.selectionChanged", { defaultValue: "A selected record is no longer available. Review the current choices before saving." }))
      const params: CreateInvoiceReminderBatchParams = { companyId, templateId, channel: enumValue<MessageChannel>(String(data.channel || "WhatsApp")), invoiceIds, metadata: undefined }
      await createInvoiceReminder.mutateAsync(params)
      if (activeScope.current === scope) setInvoiceDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create invoice reminder batch"
      if (activeScope.current === scope) setError(message)
      throw cause
    }
  }

  const reviewedBatch: BatchReviewEnvelope | undefined = batches.find((batch) => String(batch.id) === reviewTarget?.id)
  const reviewedMessages = reviewedBatch ? messagesForBatch(evidence, reviewedBatch, organization, companyId) : []
  const reviewReady = batchesState.status === "ready" && reviewedBatch != null && enumName(reviewedBatch.status) === "PendingApproval"
  const reviewConfig: FormConfig = {
    id: reviewTarget?.approved ? "approve-message-batch" : "reject-message-batch",
    title: reviewTarget?.approved
      ? t("messages.batchReview.approveTitle", { defaultValue: "Approve message batch" })
      : t("messages.batchReview.rejectTitle", { defaultValue: "Reject message batch" }),
    description: t("messages.batchReview.effect", { defaultValue: "This records your review of the saved batch. Approval is not proof of sending or delivery." }),
    submitLabel: reviewTarget?.approved ? t("messages.batchReview.approve", { defaultValue: "Approve" }) : t("messages.batchReview.reject", { defaultValue: "Reject" }),
    sections: [{ id: "decision", fields: reviewTarget?.approved
      ? [{ id: "reviewConfirmed", name: "reviewConfirmed", type: "checkbox", label: t("messages.batchReview.confirmEvidence", { defaultValue: "I have reviewed the saved recipients and rendered message content." }), required: true, validation: { custom: (value) => value === true ? null : t("messages.batchReview.confirmRequired", { defaultValue: "Verify all saved recipient content and confirm your review before approving." }) } }]
      : [{ id: "reason", name: "reason", type: "textarea", label: t("messages.batchReview.reason", { defaultValue: "Rejection reason" }), required: true }] }],
  }

  const renderEvidence = (batch: BatchReviewEnvelope) => {
    const messages = messagesForBatch(evidence, batch, organization, companyId)
    const exclusions = batchExclusions(batch, exclusionsState.status === "ready" ? exclusionsQuery.data ?? [] : [])
    const count = batch.recipientCount ?? batch.recipient_count
    return <section className="space-y-3" aria-label={t("messages.batchReview.evidence", { defaultValue: "Saved batch evidence" })}>
      <p className="text-sm">{t("messages.batchReview.template", { defaultValue: "Template" })}: {templateOptions.find((option) => option.value === String(batch.templateId ?? batch.template_id))?.label ?? t("messages.batchReview.templateUnavailable", { defaultValue: "Template details unavailable" })}</p>
      <ModuleDataNotice state={evidenceState} />
      {evidenceState.status === "loading" ? <p role="status">{t("common.loading", { defaultValue: "Loading…" })}</p> : null}
      {evidenceState.status === "ready" ? <>
        {!batchEvidenceComplete(messages, count) ? <p role="status" className="text-sm text-muted-foreground">{t("messages.batchReview.incomplete", { defaultValue: "The complete saved recipient content could not be verified. Approval is unavailable; restore the source records before continuing." })}</p> : null}
        <ul className="max-h-72 space-y-3 overflow-y-auto">
          {messages.map((message) => {
            const provider = providerState.status === "ready" ? messageProviderEvidence(message, providerQuery.data ?? [], organization, companyId) : null
            const providerLabel = provider?.status === "delivered"
              ? t("messages.batchReview.providerDelivered", { defaultValue: "Provider confirmed delivery" })
              : provider?.status === "accepted" ? t("messages.batchReview.providerAccepted", { defaultValue: "Provider accepted; delivery is not confirmed" })
                : provider?.status === "failed" ? t("messages.batchReview.providerFailed", { defaultValue: "Provider reported failure" })
                  : t("messages.batchReview.providerUnavailable", { defaultValue: "No verified provider delivery receipt is available." })
            return <li key={String(message.id)} className="space-y-1 rounded border p-3 text-sm">
            <p className="font-medium">{contactOptions.find((option) => option.value === String(message.contactId ?? message.contact_id))?.label ?? t("messages.batchReview.recipientUnavailable", { defaultValue: "Recipient name unavailable" })}</p>
            {typeof (message.renderedSubject ?? message.rendered_subject) === "string" ? <p>{String(message.renderedSubject ?? message.rendered_subject)}</p> : null}
            <p className="whitespace-pre-wrap break-words">{typeof (message.renderedBody ?? message.rendered_body) === "string" ? String(message.renderedBody ?? message.rendered_body) : t("messages.batchReview.bodyUnavailable", { defaultValue: "Message content unavailable" })}</p>
            <Badge variant="outline">{enumName(message.status)}</Badge>
            <p className="text-xs text-muted-foreground">{providerLabel}</p>
            {provider ? <p className="break-all text-xs">{t("messages.batchReview.providerReference", { defaultValue: "Provider reference" })}: {provider.providerMessageId}</p> : null}
            {provider?.status === "failed" ? <p className="text-xs">{messageFailureReason(message) ?? t("messages.batchReview.failureUnavailable", { defaultValue: "The provider failure reason is unavailable." })}</p> : null}
          </li>})}
        </ul>
      </> : null}
      <ModuleDataNotice state={exclusionsState} />
      {exclusions == null ? <p role="status" className="text-xs text-muted-foreground">{t("messages.batchReview.exclusionsUnavailable", { defaultValue: "The complete creation-time exclusion reasons are unavailable for this batch. Current contact preferences cannot establish why a recipient was excluded earlier." })}</p>
        : exclusions.length > 0 ? <section className="space-y-2"><p className="text-sm font-medium">{t("messages.batchReview.excludedRecipients", { defaultValue: "Excluded at batch creation" })}</p><ul className="max-h-60 space-y-2 overflow-y-auto">{exclusions.map((excluded) => <li key={`${excluded.model}:${excluded.recordId}`} className="rounded border p-2 text-sm">
          <p>{contactOptions.find((option) => option.value === excluded.contactId)?.label ?? t("messages.batchReview.recipientUnavailable", { defaultValue: "Recipient name unavailable" })} · {excluded.model === "account_move" ? t("messages.batchReview.invoice", { defaultValue: "Invoice" }) : t("messages.batchReview.contact", { defaultValue: "Contact" })} #{excluded.recordId}</p>
          <p className="text-muted-foreground">{t(`messages.batchReview.exclusionReasons.${excluded.reason}`, { defaultValue: batchExclusionReason(excluded.reason) ?? "" })}</p>
        </li>)}</ul></section> : null}
    </section>
  }

  const review = async (data: Row) => {
    if (!reviewTarget || !reviewReady || !reviewedBatch) throw new Error(t("messages.batchReview.reviewChanged", { defaultValue: "This batch is no longer available for review. Refresh the batch list." }))
    const batchId = asId(reviewedBatch.id)
    if (batchId == null) throw new Error(t("messages.batchReview.reviewChanged", { defaultValue: "This batch is no longer available for review. Refresh the batch list." }))
    try {
      setError(null)
      const approved = reviewTarget.approved
      const reason = stringValue(data.reason)
      if (approved && (evidenceState.status !== "ready" || !batchEvidenceComplete(reviewedMessages, reviewedBatch.recipientCount ?? reviewedBatch.recipient_count) || data.reviewConfirmed !== true)) throw new Error(t("messages.batchReview.confirmRequired", { defaultValue: "Verify all saved recipient content and confirm your review before approving." }))
      if (!approved && !reason) throw new Error(t("messages.batchReview.reasonRequired", { defaultValue: "Enter a rejection reason. Your review has not been submitted." }))
      await reviewBatch.mutateAsync({ batchId, params: { approved, reason: approved ? undefined : reason } })
      if (activeScope.current === scope) setReviewTarget(null)
    } catch (cause) {
      if (activeScope.current === scope) setError(cause instanceof Error ? cause.message : "Unable to review message batch")
      throw cause
    }
  }

  const mutationBusy = createBatch.isPending || createInvoiceReminder.isPending || createTemplate.isPending || reviewBatch.isPending
  const createReady = companyId > 0n && templatesState.status === "ready" && batchesState.status === "ready"
  return <Card>
    <CardHeader>
      <div>
        <CardTitle>Invoice reminders & message batches</CardTitle>
        <CardDescription>Create approved copy, choose recipients or outstanding invoices, then review the saved recipient content. Approval does not confirm sending or delivery.</CardDescription>
      </div>
      <CardAction><div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!createReady || mutationBusy} onClick={() => { setError(null); setTemplateDialogOpen(true) }}><ScrollTextIcon data-icon="inline-start" />New template</Button>
        <Button size="sm" variant="outline" disabled={!createReady || mutationBusy || templateOptions.length === 0 || invoiceOptions.length === 0} onClick={() => { setError(null); setInvoiceDialogOpen(true) }}><FileTextIcon data-icon="inline-start" />Invoice reminders</Button>
        <Button size="sm" disabled={!createReady || mutationBusy || templateOptions.length === 0 || contactOptions.length === 0} onClick={() => { setError(null); setBatchDialogOpen(true) }}><PlusIcon data-icon="inline-start" />New batch</Button>
      </div></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {companyId <= 0n ? <p role="status">{t("messages.batchReview.companyRequired", { defaultValue: "Choose an operating company to review batches or create messages." })}</p> : null}
      <ModuleDataNotice state={batchesState} />
      <ModuleDataNotice state={templatesState} />
      {batchesState.status === "loading" ? <p role="status">{t("messages.batchReview.loading", { defaultValue: "Loading message batches…" })}</p> : null}
      {templatesState.status === "loading" ? <p role="status">{t("messages.batchReview.templatesLoading", { defaultValue: "Loading message templates…" })}</p> : null}
      {batchesState.status === "ready" && companyId > 0n ? batches.length > 0 ? batches.map((batch: BatchReviewEnvelope) => {
        const status = enumName(batch.status)
        const awaitingReview = status === "PendingApproval"
        const isInvoiceReminder = ["account_move", "account.move"].includes(stringValue(batch.subjectModel ?? batch.subject_model))
        return <div key={String(batch.id)} className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><p className="font-medium">{isInvoiceReminder ? "Invoice reminder batch" : String(batch.subjectModel ?? batch.subject_model ?? "Message batch")}</p><Badge variant={awaitingReview ? "secondary" : status === "Approved" ? "default" : "outline"}>{status || "Draft"}</Badge></div>
              <p className="mt-1 text-sm text-muted-foreground">{enumName(batch.channel)} · {String(batch.recipientCount ?? batch.recipient_count ?? "—")} recipients · {String(batch.excludedCount ?? batch.excluded_count ?? "—")} excluded</p>
            </div>
            {awaitingReview ? <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => { setError(null); setReviewTarget({ id: String(batch.id), approved: false }) }}><XIcon data-icon="inline-start" />Reject</Button>
              <Button size="sm" disabled={mutationBusy} onClick={() => { setError(null); setReviewTarget({ id: String(batch.id), approved: true }) }}><CheckIcon data-icon="inline-start" />Review & approve</Button>
            </div> : null}
          </div>
          <details><summary className="cursor-pointer py-2 text-sm font-medium">{t("messages.batchReview.showEvidence", { defaultValue: "Review saved recipients and content" })}</summary><div className="pt-3">{renderEvidence(batch)}</div></details>
        </div>
      }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquareMoreIcon /></EmptyMedia><EmptyTitle>No message batches</EmptyTitle><EmptyDescription>Create an approved template, then build an invoice-reminder or contact-message batch.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" disabled={!createReady || mutationBusy} onClick={() => setTemplateDialogOpen(true)}><ScrollTextIcon data-icon="inline-start" />New template</Button></EmptyContent></Empty> : null}
    </CardContent>
    <RuntimeFormModal open={templateDialogOpen} onOpenChange={(next) => !next && !createTemplate.isPending && setTemplateDialogOpen(false)} staticConfig={templateForm} moduleId="messages" organizationId={organizationId} isPending={createTemplate.isPending} submissionDisabled={!createReady} closeOnSubmit={false} showSubmitSuccessToast submitError={error} onSubmit={saveTemplate} />
    <RuntimeFormModal open={invoiceDialogOpen} onOpenChange={(next) => !next && !createInvoiceReminder.isPending && setInvoiceDialogOpen(false)} staticConfig={invoiceForm} moduleId="messages" organizationId={organizationId} isPending={createInvoiceReminder.isPending} submissionDisabled={!createReady} closeOnSubmit={false} showSubmitSuccessToast submitError={error} onSubmit={saveInvoiceReminder} />
    <RuntimeFormModal open={batchDialogOpen} onOpenChange={(next) => !next && !createBatch.isPending && setBatchDialogOpen(false)} staticConfig={batchForm} moduleId="messages" organizationId={organizationId} isPending={createBatch.isPending} submissionDisabled={!createReady} closeOnSubmit={false} showSubmitSuccessToast submitError={error} onSubmit={saveBatch} />
    <FormModal open={reviewTarget != null} onOpenChange={(next) => !next && !reviewBatch.isPending && setReviewTarget(null)} config={reviewConfig} draft={false} draftKey={reviewTarget?.id} closeOnSubmit={false} isPending={reviewBatch.isPending} submissionDisabled={!reviewReady || (reviewTarget?.approved === true && (evidenceState.status !== "ready" || !batchEvidenceComplete(reviewedMessages, reviewedBatch?.recipientCount ?? reviewedBatch?.recipient_count)))} submitError={error} renderPreview={() => reviewedBatch ? renderEvidence(reviewedBatch) : <p role="status">{t("messages.batchReview.reviewChanged", { defaultValue: "This batch is no longer available for review. Refresh the batch list." })}</p>} onSubmit={review} />
  </Card>
}
