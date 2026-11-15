"use client"

import { useMemo, useState } from "react"
import { toSnakeCase } from "@lumiere/erp-shared/row-values"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { ChatActionDraftPayload } from "@/lib/ai-chat-types"
import {
  HistoryFieldDiff,
  type HistoryDiffValue,
  type HistoryFieldDiffRow,
} from "../entity-views/history-field-diff"

const draftFields = {
  create_task: {
    name: "Task name",
    description: "Description",
    project_id: "Project",
    stage_id: "Stage",
    priority: "Priority",
    state: "State",
    partner_id: "Partner",
    planned_hours: "Planned hours",
    date_deadline: "Deadline",
  },
  create_sale_order: {
    partner_id: "Customer (partner)",
    partner_invoice_id: "Invoice address",
    partner_shipping_id: "Shipping address",
    pricelist_id: "Pricelist",
    currency_id: "Currency",
    warehouse_id: "Warehouse",
    origin: "Origin",
    client_order_ref: "Customer reference",
    note: "Note",
    order_lines: "Order lines",
  },
  create_purchase_order: {
    partner_id: "Vendor (partner)",
    currency_id: "Currency",
    origin: "Origin",
    partner_ref: "Vendor reference",
    notes: "Notes",
    order_lines: "Order lines",
  },
  reverse_payment_transaction: {
    transaction_id: "Payment transaction",
    reason: "Reason",
  },
} as const

function proposalValue(value: unknown): HistoryDiffValue {
  if (value === null || typeof value === "string") {
    return { kind: "value", value }
  }
  const serialized = JSON.stringify(value, null, 2)
  return serialized === undefined
    ? { kind: "unavailable" }
    : { kind: "value", value: serialized }
}

function buildDraftDiffFields(
  reducerName: string,
  params: Record<string, unknown>,
): HistoryFieldDiffRow[] {
  const reducer = reducerName.trim()
  const labels: Readonly<Record<string, string>> = Object.hasOwn(
    draftFields,
    reducer,
  )
    ? draftFields[reducer as keyof typeof draftFields]
    : {}
  const isCreation =
    reducer === "create_task" ||
    reducer === "create_sale_order" ||
    reducer === "create_purchase_order"
  const before: HistoryDiffValue = isCreation
    ? { kind: "absent" }
    : { kind: "unavailable" }

  return Object.entries(params).map(([key, value]) => {
    const field = toSnakeCase(key)
    const label = Object.hasOwn(labels, field)
      ? labels[field]
      : field.replace(/_/g, " ")
    return { id: key, label, before, after: proposalValue(value) }
  })
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
        <div className={cn("py-2", !nested && "px-2.5")}>
          <HistoryFieldDiff
            fields={fields}
            beforeLabel={t("aiChat.draft.beforeProposal", {
              defaultValue: "Before proposal",
            })}
            afterLabel={t("aiChat.draft.proposedValue", {
              defaultValue: "Proposed value",
            })}
          />
        </div>
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
