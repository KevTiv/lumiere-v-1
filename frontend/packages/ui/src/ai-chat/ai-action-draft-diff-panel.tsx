"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { ChatActionDraftPayload } from "@/lib/ai-chat-types"

export type DraftDiffField = {
  label: string
  value: string
}

function formatScalar(value: unknown): string {
  if (value == null) return "—"
  if (typeof value === "string") return value.trim() || "—"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return "—"
    return value.map((item) => formatScalar(item)).join(", ")
  }
  return JSON.stringify(value)
}

function summarizeOrderLines(lines: unknown, label: string): DraftDiffField[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [{ label, value: i18n.t("ui.aiChat.aiActionDraftDiffPanel.noLines") }]
  }
  const summaries = lines.map((line, index) => {
    if (line == null || typeof line !== "object" || Array.isArray(line)) {
      return `Line ${index + 1}: (invalid)`
    }
    const row = line as Record<string, unknown>
    const productId = row.product_id ?? row.productId
    const qty = row.quantity ?? row.product_uom_qty ?? row.product_qty
    const price = row.price_unit ?? row.priceUnit
    const parts = [
      productId != null ? `product #${productId}` : null,
      qty != null ? `qty ${qty}` : null,
      price != null ? `@ ${price}` : null,
    ].filter(Boolean)
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null
    return `Line ${index + 1}: ${name ?? (parts.join(", ") || "(empty)")}`
  })
  return [{ label, value: summaries.join("; ") }]
}

export function buildDraftDiffFields(
  reducerName: string,
  params: Record<string, unknown>,
): DraftDiffField[] {
  switch (reducerName) {
    case "create_task":
      return [
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.taskName"), value: formatScalar(params.name) },
        { label: i18n.t("settings.ai.description"), value: formatScalar(params.description) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.project"), value: formatScalar(params.project_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.stage"), value: formatScalar(params.stage_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.priority"), value: formatScalar(params.priority) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.state"), value: formatScalar(params.state) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.partner"), value: formatScalar(params.partner_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.plannedHours"), value: formatScalar(params.planned_hours) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.deadline"), value: formatScalar(params.date_deadline) },
      ].filter((field) => field.value !== "—")

    case "create_sale_order":
      return [
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.customerPartner"), value: formatScalar(params.partner_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.invoiceAddress"), value: formatScalar(params.partner_invoice_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.shippingAddress"), value: formatScalar(params.partner_shipping_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.pricelist"), value: formatScalar(params.pricelist_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.currency"), value: formatScalar(params.currency_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.warehouse"), value: formatScalar(params.warehouse_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.origin"), value: formatScalar(params.origin) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.customerReference"), value: formatScalar(params.client_order_ref) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.note"), value: formatScalar(params.note) },
        ...summarizeOrderLines(params.order_lines, i18n.t("ui.aiChat.aiActionDraftDiffPanel.orderLines")),
      ].filter((field) => field.value !== "—")

    case "create_purchase_order":
      return [
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.vendorPartner"), value: formatScalar(params.partner_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.currency"), value: formatScalar(params.currency_id) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.origin"), value: formatScalar(params.origin) },
        { label: i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.vendorReference"), value: formatScalar(params.partner_ref) },
        { label: i18n.t("common.notes"), value: formatScalar(params.notes) },
        ...summarizeOrderLines(params.order_lines, i18n.t("ui.aiChat.aiActionDraftDiffPanel.orderLines")),
      ].filter((field) => field.value !== "—")

    default:
      return Object.entries(params).map(([key, value]) => ({
        label: key.replace(/_/g, " "),
        value: formatScalar(value),
      }))
  }
}

interface AiActionDraftDiffPanelProps {
  draft: ChatActionDraftPayload
  requireReview?: boolean
  reviewed?: boolean
  onReviewedChange?: (reviewed: boolean) => void
  className?: string
}

export function AiActionDraftDiffPanel({
  draft,
  requireReview = true,
  reviewed = false,
  onReviewedChange,
  className,
}: AiActionDraftDiffPanelProps) {
  useTranslation()
  const [showRawJson, setShowRawJson] = useState(false)
  const fields = useMemo(
    () => buildDraftDiffFields(draft.reducerName, draft.paramsJson),
    [draft.reducerName, draft.paramsJson, i18n.resolvedLanguage],
  )
  const rawJson = JSON.stringify(draft.paramsJson, null, 2)
  const isPending = (draft.status ?? "pending") === "pending"

  return (
    <div
      data-testid={`ai-action-draft-diff-${draft.draftId}`}
      className={cn("rounded-md border border-border/60 bg-background/50", className)}
    >
      <div className="border-b border-border/60 px-2.5 py-1.5">
        <p className="text-[10px] font-medium text-foreground">{i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.willCreate")}</p>
        <p className="text-[9px] text-muted-foreground">
          {i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.reviewTheFieldsBelowBeforeApprovingThisDraft")}</p>
      </div>

      {fields.length > 0 ? (
        <dl className="divide-y divide-border/40 px-2.5 py-1">
          {fields.map((field) => (
            <div
              key={field.label}
              className="grid grid-cols-[minmax(7rem,35%)_1fr] gap-2 py-1.5 text-[10px]"
            >
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="text-foreground wrap-break-word">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-2.5 py-2 text-[10px] text-muted-foreground">{i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.noParametersToPreview")}</p>
      )}

      <div className="border-t border-border/60 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setShowRawJson((value) => !value)}
          className="flex w-full items-center justify-between text-[10px] text-muted-foreground hover:text-foreground"
        >
          <span>{i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.rawJSON")}</span>
          {showRawJson ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showRawJson ? (
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-2 font-mono text-[9px] leading-relaxed">
            {rawJson}
          </pre>
        ) : null}
      </div>

      {requireReview && isPending && onReviewedChange ? (
        <div className="border-t border-border/60 px-2.5 py-2">
          <label className="flex items-start gap-2 text-[10px] text-muted-foreground cursor-pointer">
            <Checkbox
              checked={reviewed}
              onCheckedChange={(checked) => onReviewedChange(checked === true)}
              className="mt-0.5"
              data-testid="ai-action-draft-reviewed"
            />
            <span>{i18n.t("ui.aiAssistant.aiActionDraftDiffPanel.iReviewedThisDraftAndConfirmTheValuesAbove")}</span>
          </label>
        </div>
      ) : null}
    </div>
  )
}
