"use client"

import { useMemo, useState } from "react"
import { CheckIcon, FileTextIcon, MessageSquareMoreIcon, PlusIcon, ScrollTextIcon, XIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  mergeSelectOptionsForFields,
  newInvoiceReminderBatchForm,
  newMessageBatchForm,
  newMessageTemplateForm,
  RuntimeFormModal,
} from "@lumiere/ui"
import type { CustomField, FormConfig } from "@lumiere/ui"
import type { CreateInvoiceReminderBatchParams, CreateMessageBatchParams, CreateMessageTemplateParams, MessageChannel } from "@lumiere/stdb/types"
import {
  useCreateInvoiceReminderBatch,
  useCreateMessageBatch,
  useCreateMessageTemplate,
  useMessageBatches,
  useMessageTemplates,
  useReviewMessageBatch,
} from "@lumiere/query-hooks/hooks/messages"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"

type Row = Record<string, unknown>
type PickerOption = { value: string; label: string; description?: string }
type PickerField = CustomField & { options?: PickerOption[] }

function asId(value: unknown): bigint | null {
  try {
    return value == null || value === "" ? null : typeof value === "bigint" ? value : BigInt(String(value))
  } catch {
    return null
  }
}

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
  return raw.map((item) => asId(item)).filter((id): id is bigint => id != null)
}

function SelectionPicker({ field, value, onChange, error }: { field: CustomField; value: unknown; onChange: (value: unknown) => void; error?: string }) {
  const options = (field as PickerField).options ?? []
  const selected = new Set(Array.isArray(value) ? value.map(String) : [])
  return <ScrollArea className="max-h-56 rounded-md border">
    <div className="flex flex-col gap-2 p-3">
      {options.map((option) => {
        const checked = selected.has(option.value)
        return <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={checked} onCheckedChange={(next) => {
            const nextValues = new Set(selected)
            if (next) nextValues.add(option.value)
            else nextValues.delete(option.value)
            onChange([...nextValues])
          }} aria-invalid={Boolean(error)} />
          <span className="flex flex-col gap-0.5"><span>{option.label}</span>{option.description ? <span className="text-xs text-muted-foreground">{option.description}</span> : null}</span>
        </label>
      })}
    </div>
  </ScrollArea>
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
  const organization = BigInt(organizationId)
  const { data: templates = [] } = useMessageTemplates(organization)
  const { data: batches = [], isLoading } = useMessageBatches(organization)
  const createBatch = useCreateMessageBatch(organization)
  const createInvoiceReminder = useCreateInvoiceReminderBatch(organization)
  const createTemplate = useCreateMessageTemplate(organization)
  const reviewBatch = useReviewMessageBatch(organization)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      return type === "OutInvoice" && state === "Posted" && residual > 0 && (companyId <= 0n || invoiceCompany === companyId)
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
      setTemplateDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create message template"
      setError(message)
      throw cause
    }
  }

  const saveBatch = async (data: Row) => {
    try {
      setError(null)
      const templateId = asId(data.templateId)
      const candidateContactIds = ids(data.candidateContactIds)
      if (templateId == null || candidateContactIds.length === 0) throw new Error("Choose a template and at least one recipient")
      const params: CreateMessageBatchParams = { companyId: companyId > 0n ? companyId : undefined, templateId, channel: enumValue<MessageChannel>(String(data.channel || "WhatsApp")), subjectModel: stringValue(data.subjectModel) || "account.move", subjectQuery: undefined, candidateContactIds, metadata: undefined }
      await createBatch.mutateAsync(params)
      setBatchDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create message batch"
      setError(message)
      throw cause
    }
  }

  const saveInvoiceReminder = async (data: Row) => {
    try {
      setError(null)
      const templateId = asId(data.templateId)
      const invoiceIds = ids(data.invoiceIds)
      if (companyId <= 0n) throw new Error("Choose an active company before creating invoice reminders")
      if (templateId == null || invoiceIds.length === 0) throw new Error("Choose a template and at least one outstanding invoice")
      const params: CreateInvoiceReminderBatchParams = { companyId, templateId, channel: enumValue<MessageChannel>(String(data.channel || "WhatsApp")), invoiceIds, metadata: undefined }
      await createInvoiceReminder.mutateAsync(params)
      setInvoiceDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create invoice reminder batch"
      setError(message)
      throw cause
    }
  }

  const review = async (batch: Row, approved: boolean) => {
    const batchId = asId(batch.id)
    if (batchId == null) return
    try {
      setError(null)
      await reviewBatch.mutateAsync({ batchId, params: { approved, reason: approved ? undefined : "Rejected from operations workspace" } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to review message batch")
    }
  }

  const mutationBusy = createBatch.isPending || createInvoiceReminder.isPending || createTemplate.isPending || reviewBatch.isPending
  return <Card>
    <CardHeader>
      <div><CardTitle>Invoice reminders & message batches</CardTitle><CardDescription>Create approved copy, choose recipients or outstanding invoices, then review the generated batch before staff copy or send it.</CardDescription></div>
      <CardAction><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setError(null); setTemplateDialogOpen(true) }}><ScrollTextIcon data-icon="inline-start" />New template</Button><Button size="sm" variant="outline" disabled={templateOptions.length === 0 || invoiceOptions.length === 0 || companyId <= 0n} onClick={() => { setError(null); setInvoiceDialogOpen(true) }}><FileTextIcon data-icon="inline-start" />Invoice reminders</Button><Button size="sm" disabled={templateOptions.length === 0 || contactOptions.length === 0} onClick={() => { setError(null); setBatchDialogOpen(true) }}><PlusIcon data-icon="inline-start" />New batch</Button></div></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {(batches as Row[]).length > 0 ? (batches as Row[]).map((batch) => {
        const status = enumName(batch.status)
        const awaitingReview = status === "PendingApproval"
        const isInvoiceReminder = stringValue(batch.subjectModel ?? batch.subject_model) === "account_move"
        return <div key={String(batch.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="flex items-center gap-2"><p className="font-medium">{isInvoiceReminder ? "Invoice reminder batch" : String(batch.subjectModel ?? batch.subject_model ?? "Message batch")}</p><Badge variant={awaitingReview ? "secondary" : status === "Approved" ? "default" : "outline"}>{status || "Draft"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{enumName(batch.channel)} · {String(batch.recipientCount ?? batch.recipient_count ?? 0)} recipients · {String(batch.excludedCount ?? batch.excluded_count ?? 0)} excluded</p></div>{awaitingReview ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => void review(batch, false)}><XIcon data-icon="inline-start" />Reject</Button><Button size="sm" disabled={mutationBusy} onClick={() => void review(batch, true)}><CheckIcon data-icon="inline-start" />Approve</Button></div> : null}</div>
      }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquareMoreIcon /></EmptyMedia><EmptyTitle>{isLoading ? "Loading batches" : "No message batches"}</EmptyTitle><EmptyDescription>Create an approved template, then build an invoice-reminder or contact-message batch.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" onClick={() => setTemplateDialogOpen(true)}><ScrollTextIcon data-icon="inline-start" />New template</Button></EmptyContent></Empty>}
    </CardContent>
    <RuntimeFormModal open={templateDialogOpen} onOpenChange={(next) => !next && setTemplateDialogOpen(false)} staticConfig={templateForm} moduleId="messages" organizationId={organizationId} isPending={createTemplate.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={error} onSubmit={saveTemplate} />
    <RuntimeFormModal open={invoiceDialogOpen} onOpenChange={(next) => !next && setInvoiceDialogOpen(false)} staticConfig={invoiceForm} moduleId="messages" organizationId={organizationId} isPending={createInvoiceReminder.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={error} onSubmit={saveInvoiceReminder} />
    <RuntimeFormModal open={batchDialogOpen} onOpenChange={(next) => !next && setBatchDialogOpen(false)} staticConfig={batchForm} moduleId="messages" organizationId={organizationId} isPending={createBatch.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={error} onSubmit={saveBatch} />
  </Card>
}
