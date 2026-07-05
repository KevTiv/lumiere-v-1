"use client"

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
        { label: "Invoice address", value: formatScalar(params.partner_invoice_id) },
        { label: "Shipping address", value: formatScalar(params.partner_shipping_id) },
        { label: "Pricelist", value: formatScalar(params.pricelist_id) },
        { label: "Currency", value: formatScalar(params.currency_id) },
        { label: "Warehouse", value: formatScalar(params.warehouse_id) },
        { label: "Origin", value: formatScalar(params.origin) },
        { label: "Customer reference", value: formatScalar(params.client_order_ref) },
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
      className={cn("rounded-md border border-border/60 bg-background/50", className)}
    >
      <div className="border-b border-border/60 px-2.5 py-1.5">
        <p className="text-[10px] font-medium text-foreground">Will create</p>
        <p className="text-[9px] text-muted-foreground">
          Review the fields below before approving this draft.
        </p>
      </div>

      {fields.length > 0 ? (
        <dl className="divide-y divide-border/40 px-2.5 py-1">
          {fields.map((field) => (
            <div
              key={field.label}
              className="grid grid-cols-[minmax(7rem,35%)_1fr] gap-2 py-1.5 text-[10px]"
            >
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="text-foreground break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-2.5 py-2 text-[10px] text-muted-foreground">No parameters to preview.</p>
      )}

      <div className="border-t border-border/60 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setShowRawJson((value) => !value)}
          className="flex w-full items-center justify-between text-[10px] text-muted-foreground hover:text-foreground"
        >
          <span>Raw JSON</span>
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
            <span>I reviewed this draft and confirm the values above.</span>
          </label>
        </div>
      ) : null}
    </div>
  )
}
