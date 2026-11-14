"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
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
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return "—"
    return value.map((item) => formatScalar(item)).join(", ")
  }
  return JSON.stringify(value)
}

function summarizeOrderLines(lines: unknown, label: string): DraftDiffField[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [{ label, value: "No lines" }]
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
    const name =
      typeof row.name === "string" && row.name.trim() ? row.name.trim() : null
    return `Line ${index + 1}: ${name ?? (parts.join(", ") || "(empty)")}`
  })
  return [{ label, value: summaries.join("; ") }]
}

export function buildDraftDiffFields(
  reducerName: string,
  params: Record<string, unknown>,
): DraftDiffField[] {
  switch (reducerName.trim()) {
    case "create_task":
      return [
        { label: "Task name", value: formatScalar(params.name) },
        { label: "Description", value: formatScalar(params.description) },
        { label: "Project", value: formatScalar(params.project_id) },
        { label: "Stage", value: formatScalar(params.stage_id) },
        { label: "Priority", value: formatScalar(params.priority) },
        { label: "State", value: formatScalar(params.state) },
        { label: "Partner", value: formatScalar(params.partner_id) },
        { label: "Planned hours", value: formatScalar(params.planned_hours) },
        { label: "Deadline", value: formatScalar(params.date_deadline) },
      ].filter((field) => field.value !== "—")

    case "create_sale_order":
      return [
        { label: "Customer (partner)", value: formatScalar(params.partner_id) },
        {
          label: "Invoice address",
          value: formatScalar(params.partner_invoice_id),
        },
        {
          label: "Shipping address",
          value: formatScalar(params.partner_shipping_id),
        },
        { label: "Pricelist", value: formatScalar(params.pricelist_id) },
        { label: "Currency", value: formatScalar(params.currency_id) },
        { label: "Warehouse", value: formatScalar(params.warehouse_id) },
        { label: "Origin", value: formatScalar(params.origin) },
        {
          label: "Customer reference",
          value: formatScalar(params.client_order_ref),
        },
        { label: "Note", value: formatScalar(params.note) },
        ...summarizeOrderLines(params.order_lines, "Order lines"),
      ].filter((field) => field.value !== "—")

    case "create_purchase_order":
      return [
        { label: "Vendor (partner)", value: formatScalar(params.partner_id) },
        { label: "Currency", value: formatScalar(params.currency_id) },
        { label: "Origin", value: formatScalar(params.origin) },
        { label: "Vendor reference", value: formatScalar(params.partner_ref) },
        { label: "Notes", value: formatScalar(params.notes) },
        ...summarizeOrderLines(params.order_lines, "Order lines"),
      ].filter((field) => field.value !== "—")

    case "reverse_payment_transaction":
      return [
        {
          label: "Payment transaction",
          value: formatScalar(params.transaction_id),
        },
        { label: "Reason", value: formatScalar(params.reason) },
      ]

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
  nested?: boolean
}

export function AiActionDraftDiffPanel({
  draft,
  requireReview = true,
  reviewed = false,
  onReviewedChange,
  className,
  nested = false,
}: AiActionDraftDiffPanelProps) {
  const { t } = useTranslation()
  const [showRawJson, setShowRawJson] = useState(false)
  const fields = useMemo(
    () => buildDraftDiffFields(draft.reducerName, draft.paramsJson),
    [draft.reducerName, draft.paramsJson],
  )
  const rawJson = JSON.stringify(draft.paramsJson, null, 2)
  const isPending = (draft.status ?? "pending") === "pending"

  return (
    <div
      data-testid={`ai-action-draft-diff-${draft.draftId}`}
      className={cn(
        !nested && "rounded-md border border-border/60 bg-background/50",
        className,
      )}
    >
      <div
        className={cn("border-b border-border/60 py-1.5", !nested && "px-2.5")}
      >
        <p className="text-sm font-medium text-foreground">
          {t("aiChat.draft.proposedChanges", {
            defaultValue: "Proposed changes",
          })}
        </p>
      </div>

      {fields.length > 0 ? (
        <dl
          className={cn("divide-y divide-border/40 py-1", !nested && "px-2.5")}
        >
          {fields.map((field) => (
            <div
              key={field.label}
              className="grid grid-cols-[minmax(0,35%)_minmax(0,1fr)] gap-2 py-1.5 text-xs"
            >
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="text-foreground wrap-break-word">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p
          className={cn(
            "py-2 text-xs text-muted-foreground",
            !nested && "px-2.5",
          )}
        >
          {t("aiChat.draft.noParameters", {
            defaultValue: "No parameters to preview.",
          })}
        </p>
      )}

      {!nested ? (
        <div className="border-t border-border/60 px-2.5 py-1.5">
          <button
            type="button"
            onClick={() => setShowRawJson((value) => !value)}
            className="flex w-full items-center justify-between text-[10px] text-muted-foreground hover:text-foreground"
          >
            <span>Raw JSON</span>
            {showRawJson ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          {showRawJson ? (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-2 font-mono text-[9px] leading-relaxed">
              {rawJson}
            </pre>
          ) : null}
        </div>
      ) : null}

      {requireReview && isPending && onReviewedChange ? (
        <div
          className={cn("border-t border-border/60 py-2", !nested && "px-2.5")}
        >
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={reviewed}
              onCheckedChange={(checked) => onReviewedChange(checked === true)}
              className="mt-0.5"
              data-testid="ai-action-draft-reviewed"
            />
            <span>
              {t("aiChat.draft.reviewed", {
                defaultValue: "I reviewed the proposed changes.",
              })}
            </span>
          </label>
        </div>
      ) : null}
    </div>
  )
}
