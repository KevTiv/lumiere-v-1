"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { AiActionDraftDiffPanel, Button } from "@lumiere/ui"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import { Field, FieldGroup, FieldLabel } from "@lumiere/ui/components/field"
import { Input } from "@lumiere/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { Textarea } from "@lumiere/ui/components/textarea"
import { AlertCircle, Building2, FilePenLine, Loader2, ShieldAlert } from "lucide-react"

import { useAiActionDraftBridge } from "@lumiere/query-hooks/hooks/ai-harness"
import type { ChatActionDraftPayload } from "@lumiere/ui"

interface RedActionDraftPanelProps {
  companies: Record<string, unknown>[]
}

interface SaleOrderDraftForm {
  companyId: string
  customerId: string
  pricelistId: string
  currencyId: string
  warehouseId: string
  customerReference: string
  note: string
}

function companyRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id ?? ""),
    label: String(row.name ?? row.id ?? ""),
  }))
}

function positiveId(value: string): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function draftParams(form: SaleOrderDraftForm): Record<string, unknown> | null {
  const customerId = positiveId(form.customerId)
  const pricelistId = positiveId(form.pricelistId)
  const currencyId = positiveId(form.currencyId)
  const warehouseId = positiveId(form.warehouseId)
  if (!customerId || !pricelistId || !currencyId || !warehouseId) return null

  return {
    partner_id: customerId,
    partner_invoice_id: customerId,
    partner_shipping_id: customerId,
    pricelist_id: pricelistId,
    currency_id: currencyId,
    warehouse_id: warehouseId,
    order_lines: [],
    ...(form.customerReference.trim()
      ? { client_order_ref: form.customerReference.trim() }
      : {}),
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
  }
}

export function RedActionDraftPanel({ companies }: RedActionDraftPanelProps) {
  const { t } = useTranslation()
  const createDraft = useAiActionDraftBridge()
  const companyOptions = useMemo(() => companyRowsToSelectOptions(companies), [companies])
  const [form, setForm] = useState<SaleOrderDraftForm>(() => ({
    companyId: companyOptions[0]?.value ?? "",
    customerId: "",
    pricelistId: "",
    currencyId: "",
    warehouseId: "",
    customerReference: "",
    note: "",
  }))

  const params = draftParams(form)
  const previewDraft = useMemo<ChatActionDraftPayload | null>(() => {
    if (!params) return null
    return {
      draftId: 0,
      reducerName: "create_sale_order",
      summary: t("aiHarness.redAction.previewSummary"),
      paramsJson: params,
      confidence: 1,
      warnings: [t("aiHarness.redAction.approvalWarning")],
      elevated: true,
      status: "pending",
      companyId: positiveId(form.companyId) ?? undefined,
    }
  }, [form.companyId, params, t])

  const update = (field: keyof SaleOrderDraftForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleCreateDraft = async () => {
    const companyId = positiveId(form.companyId)
    if (!companyId || !params) return
    await createDraft.mutateAsync({ companyId, input: params })
  }

  const createdDraftId = createDraft.data?.draftId

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("aiHarness.redAction.title")}
          </h2>
          <Badge variant="destructive">{t("aiHarness.redAction.redSkillBadge")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t("aiHarness.redAction.description")}</p>
      </div>

      <Alert>
        <ShieldAlert />
        <AlertTitle>{t("aiHarness.redAction.approvalTitle")}</AlertTitle>
        <AlertDescription>{t("aiHarness.redAction.approvalDescription")}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("aiHarness.redAction.formTitle")}</CardTitle>
          <CardDescription>{t("aiHarness.redAction.formDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel>{t("aiHarness.redAction.companyLabel")}</FieldLabel>
              <Select
                value={form.companyId}
                onValueChange={(value) => update("companyId", value)}
                disabled={companyOptions.length === 0}
              >
                <SelectTrigger data-testid="red-action-draft-company-trigger">
                  <Building2 data-icon="inline-start" />
                  <SelectValue placeholder={t("aiHarness.redAction.companyPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {companyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <IdField
              label={t("aiHarness.redAction.customerIdLabel")}
              value={form.customerId}
              onChange={(value) => update("customerId", value)}
              testId="red-action-draft-customer-id"
            />
            <IdField
              label={t("aiHarness.redAction.pricelistIdLabel")}
              value={form.pricelistId}
              onChange={(value) => update("pricelistId", value)}
              testId="red-action-draft-pricelist-id"
            />
            <IdField
              label={t("aiHarness.redAction.currencyIdLabel")}
              value={form.currencyId}
              onChange={(value) => update("currencyId", value)}
              testId="red-action-draft-currency-id"
            />
            <IdField
              label={t("aiHarness.redAction.warehouseIdLabel")}
              value={form.warehouseId}
              onChange={(value) => update("warehouseId", value)}
              testId="red-action-draft-warehouse-id"
            />
            <Field>
              <FieldLabel>{t("aiHarness.redAction.customerReferenceLabel")}</FieldLabel>
              <Input
                value={form.customerReference}
                onChange={(event) => update("customerReference", event.target.value)}
                placeholder={t("aiHarness.redAction.customerReferencePlaceholder")}
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel>{t("aiHarness.redAction.noteLabel")}</FieldLabel>
            <Textarea
              value={form.note}
              onChange={(event) => update("note", event.target.value)}
              placeholder={t("aiHarness.redAction.notePlaceholder")}
              rows={3}
            />
          </Field>

          {previewDraft && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t("aiHarness.redAction.previewTitle")}</p>
              <AiActionDraftDiffPanel draft={previewDraft} requireReview={false} />
            </div>
          )}

          <Button
            data-testid="red-action-draft-create"
            disabled={!params || !positiveId(form.companyId) || createDraft.isPending}
            onClick={handleCreateDraft}
          >
            {createDraft.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <FilePenLine data-icon="inline-start" />
            )}
            {t("aiHarness.redAction.createDraftButton")}
          </Button>
        </CardContent>
      </Card>

      {createDraft.error && !createDraft.isPending && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("aiHarness.redAction.errorTitle")}</AlertTitle>
          <AlertDescription>
            {createDraft.error instanceof Error
              ? createDraft.error.message
              : t("aiHarness.redAction.errorDescription")}
          </AlertDescription>
        </Alert>
      )}

      {createdDraftId != null && (
        <Alert>
          <FilePenLine />
          <AlertTitle>{t("aiHarness.redAction.successTitle")}</AlertTitle>
          <AlertDescription>
            {t("aiHarness.redAction.successDescription", { id: createdDraftId })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function IdField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  testId: string
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        data-testid={testId}
        type="number"
        min="1"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}
