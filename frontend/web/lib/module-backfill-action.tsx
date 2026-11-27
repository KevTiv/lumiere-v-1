"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@lumiere/i18n"
import { formatImportAmount } from "@lumiere/ui/ai-chat/import-task-status-card"
import {
  isModuleBackfillRecordId,
  moduleBackfillTabs,
  moduleBackfillRecordHref,
  type BackfillModule,
} from "./module-backfill-navigation"
import { apiFetch } from "./api-fetch"
import { chatImportReceiptKey } from "./chat-import-task"
import { startDurableImportRun } from "./durable-import-request"
import { importAmountUnits } from "./import-workflow"
import { ImportsPausedError, importsPausedFrom } from "./import-write-pause"
import type {
  ReviewDetail,
  ReviewedRecordOperation,
  ReviewRow,
} from "./import-review-model"

type Receipt = {
  results: Array<{
    itemId: string
    status: "ready" | "saved" | "matched" | "held" | "conflict"
    reason?: string
    recordId?: string | null
    digest?: string
    periodStart?: string
    periodEnd?: string
    facts?: Record<string, string | null>
  }>
}
type Contact = {
  id: string | number
  name: string
  isCustomer?: boolean
  is_customer?: boolean
}

function previewShopSales(rows: Receipt["results"]) {
  const currencies = new Map<
    string,
    { newAmount: bigint; existingAmount: bigint }
  >()
  let alreadyPresent = 0
  for (const row of rows) {
    const { amount, currency } = row.facts ?? {}
    if (
      typeof amount !== "string" ||
      !/^\d{1,12}(?:\.\d{1,6})?$/.test(amount) ||
      typeof currency !== "string" ||
      !/^[A-Z]{3}$/.test(currency) ||
      (row.recordId != null && !isModuleBackfillRecordId(row.recordId))
    )
      return null
    const totals = currencies.get(currency) ?? {
      newAmount: 0n,
      existingAmount: 0n,
    }
    const units = importAmountUnits(amount)
    if (row.recordId) {
      alreadyPresent += 1
      totals.existingAmount += units
    } else {
      totals.newAmount += units
    }
    currencies.set(currency, totals)
  }
  return { alreadyPresent, currencies }
}

function formatPreviewUnits(units: bigint, locale?: string) {
  const decimals = (units % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
  const whole = String(units / 1_000_000n)
  return formatImportAmount(decimals ? `${whole}.${decimals}` : whole, locale)
}

function destinationHref(
  destination: string,
  taskId: string | undefined,
  companyId: number,
) {
  if (!taskId) return destination
  const [path, query] = destination.split("?", 2)
  const params = new URLSearchParams(query)
  params.set("backfillTask", taskId)
  params.set("backfillCompany", String(companyId))
  return `${path}?${params}`
}

export function ModuleBackfillAction({
  detail,
  taskId,
  companyId,
  organizationId,
  actor,
  disabled,
}: {
  detail: ReviewDetail
  taskId?: string
  companyId: number
  organizationId: number
  actor: string | null | undefined
  disabled: boolean
}) {
  return detail.reviewOperations?.map((operation) => {
    const eligible = new Set(operation.itemIds)
    const items = detail.items.filter(
      (item) => item.state !== "excluded" && eligible.has(item.id),
    )
    return items.length ? (
      <BackfillAction
        key={`${organizationId}:${companyId}:${actor}:${detail.id}:${operation.key}:${operation.version}`}
        batchId={detail.id}
        taskId={taskId}
        companyId={companyId}
        organizationId={organizationId}
        actor={actor}
        operation={operation}
        items={items}
        disabled={disabled}
      />
    ) : null
  })
}

function BackfillAction({
  batchId,
  taskId,
  companyId,
  organizationId,
  actor,
  items,
  operation,
  disabled,
}: {
  batchId: string
  taskId?: string
  companyId: number
  organizationId: number
  actor: string | null | undefined
  items: ReviewRow[]
  operation: ReviewedRecordOperation
  disabled: boolean
}) {
  const { t, i18n } = useTranslation()
  const cache = useQueryClient()
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [showMatches, setShowMatches] = useState(false)
  const [scheduledPreview, setScheduledPreview] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    key: string
    receipt: Receipt
  } | null>(null)
  const canMatchCustomer = operation.reviewedRecord.inputs.includes("customer")
  const key = JSON.stringify(
    items.map((item) => [item.id, item.revision, overrides[item.id]]),
  )
  const ready =
    preview?.key === key
      ? preview.receipt.results.filter((row) => row.status === "ready")
      : []
  const contacts = useQuery({
    queryKey: ["module-backfill-contacts", organizationId, companyId, actor],
    enabled: showMatches && canMatchCustomer,
    queryFn: async ({ signal }): Promise<Contact[]> => {
      const response = await apiFetch(
        `/api/query/contacts?companyId=${companyId}`,
        { signal },
      )
      if (!response.ok) throw new Error("Customer list unavailable.")
      const result: { data: Contact[] } = await response.json()
      return result.data.filter((row) => row.isCustomer ?? row.is_customer)
    },
  })
  const write = useMutation({
    mutationFn: async (previewOnly: boolean): Promise<Receipt> => {
      const results: Receipt["results"] = []
      const digests = new Map(ready.map((row) => [row.itemId, row.digest]))
      if (!previewOnly && taskId) {
        const adapter = operation.reviewedRecord.dispatch
        if (adapter !== "sales" && adapter !== "shop_sales" && adapter !== "warehouse") {
          throw new Error("This import operation is unavailable.")
        }
        const rows = items.flatMap(item => {
          const expectedDigest = digests.get(item.id)
          return expectedDigest ? [{
            batchId, itemId: item.id, revision: item.revision, expectedDigest,
            customerId: overrides[item.id] || undefined,
          }] : []
        })
        await startDurableImportRun(taskId, {
          companyId,
          adapter,
          config: { rows },
          rows: rows.map(({ batchId, itemId, revision }) => ({ batchId, itemId, revision })),
        })
        return { results }
      }
      const selected = previewOnly
        ? items
        : items.filter((item) => digests.has(item.id))
      for (let start = 0; start < selected.length; start += 200) {
        const response = await apiFetch(
          `/api/import-reviews/${batchId}/module-backfill`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              module: operation.reviewedRecord.dispatch,
              preview: previewOnly,
              rows: selected.slice(start, start + 200).map((item) => ({
                itemId: item.id,
                revision: item.revision,
                customerId: overrides[item.id] || undefined,
                expectedDigest: previewOnly ? undefined : digests.get(item.id),
              })),
            }),
          },
        )
        if (!response.ok) {
          const paused = await importsPausedFrom(response)
          if (paused) throw paused
        }
        if (!response.ok)
          throw new Error(
            "Could not verify the backfill. Retry to reconcile saved records.",
          )
        const receipt: Receipt = await response.json()
        results.push(...receipt.results)
      }
      return { results }
    },
    onSuccess: (receipt, previewOnly) => {
      if (previewOnly) setPreview({ key, receipt })
      else if (taskId) setScheduledPreview(key)
    },
    onSettled: (_data, _error, previewOnly) => {
      if (!previewOnly)
        return Promise.all([
          cache.invalidateQueries({ queryKey: ["durable-import-runs"] }),
          cache.invalidateQueries({
            queryKey: ["module-backfill", organizationId, companyId],
          }),
          cache.invalidateQueries({
            predicate: ({ queryKey }) =>
              queryKey[0] === "import-workflow" &&
              queryKey[2] === organizationId &&
              queryKey[3] === companyId,
          }),
          ...(taskId && actor
            ? [
                cache.invalidateQueries({
                  queryKey: chatImportReceiptKey(
                    { identity: actor, organizationId, companyId },
                    taskId,
                  ),
                }),
              ]
            : []),
        ])
    },
  })
  const pendingPreview =
    preview?.key === key
      ? preview.receipt.results.filter(
          (row) => row.status === "held" || row.status === "conflict",
        )
      : []
  const held =
    (write.variables === false
      ? { results: [...pendingPreview, ...(write.data?.results ?? [])] }
      : preview?.key === key
        ? preview.receipt
        : undefined
    )?.results.filter(
      (row) => row.status === "held" || row.status === "conflict",
    ) ?? []
  const results = write.variables === false ? (write.data?.results ?? []) : []
  const matched = results.filter((row) => row.status === "matched").length
  const saved = results.filter((row) => row.status === "saved").length
  const dispatch = operation.reviewedRecord.dispatch
  const showPreview =
    ready.length > 0 && (!write.isSuccess || write.variables === true)
  const salesPreview =
    dispatch === "shop_sales" && showPreview
      ? previewShopSales(ready)
      : undefined
  const recordLinks = results.flatMap((row) => {
    if (
      (row.status !== "saved" && row.status !== "matched") ||
      !isModuleBackfillRecordId(row.recordId) ||
      !Object.hasOwn(moduleBackfillTabs, dispatch)
    )
      return []
    return [
      {
        itemId: row.itemId,
        label: items.find((item) => item.id === row.itemId)?.source.label,
        // A matched record may have been stored by an earlier import.
        href: moduleBackfillRecordHref(dispatch as BackfillModule, {
          companyId,
          recordId: row.recordId,
          taskId: row.status === "saved" ? taskId : undefined,
        }),
      },
    ]
  })
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={disabled || write.isPending}
          onClick={() => write.mutate(true)}
        >
          Preview {operation.label.toLowerCase()}
        </Button>
        {showPreview ? (
          <Button
            disabled={disabled || write.isPending || salesPreview === null || scheduledPreview === key}
            onClick={() => write.mutate(false)}
          >
            {write.isPending
              ? "Working…"
              : `Save and verify ${ready.length} records`}
          </Button>
        ) : null}
        {canMatchCustomer ? (
          <Button
            variant="ghost"
            disabled={disabled || write.isPending}
            onClick={() => setShowMatches(!showMatches)}
          >
            Match customers
          </Button>
        ) : null}
        <a
          className="underline underline-offset-4"
          href={destinationHref(operation.destination, taskId, companyId)}
        >
          Open {operation.label.toLowerCase()}
        </a>
      </div>
      {salesPreview === null ? (
        <p role="alert">
          {t("settings.importTask.shopSalesPreviewUnavailable", {
            defaultValue:
              "Shop Sales totals could not be verified. Refresh the preview before saving.",
          })}
        </p>
      ) : salesPreview ? (
        <div className="space-y-1 rounded-md bg-muted/40 p-2 tabular-nums">
          <p className="font-medium">
            {t("settings.importTask.shopSalesPreviewCounts", {
              defaultValue:
                "Preview · {{newCount}} new · {{existingCount}} already present · {{heldCount}} held",
              newCount: ready.length - salesPreview.alreadyPresent,
              existingCount: salesPreview.alreadyPresent,
              heldCount: held.length,
            })}
          </p>
          {[...salesPreview.currencies]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([currency, totals]) => (
              <p key={currency}>
                {t("settings.importTask.shopSalesPreviewAmounts", {
                  defaultValue:
                    "{{currency}} {{newAmount}} to create · {{currency}} {{existingAmount}} already present",
                  currency,
                  newAmount: formatPreviewUnits(
                    totals.newAmount,
                    i18n?.language,
                  ),
                  existingAmount: formatPreviewUnits(
                    totals.existingAmount,
                    i18n?.language,
                  ),
                })}
              </p>
            ))}
        </div>
      ) : null}
      {showMatches && canMatchCustomer ? (
        contacts.isPending ? (
          <p>Loading customers…</p>
        ) : contacts.isError ? (
          <p role="alert">Customer list unavailable.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <label className="grid gap-1" key={item.id}>
                {item.source.label}
                <select
                  className="w-full rounded border bg-background p-1"
                  value={overrides[item.id] ?? ""}
                  disabled={disabled || write.isPending}
                  onChange={(event) => {
                    const id = event.currentTarget.value
                    setOverrides((current) => ({ ...current, [item.id]: id }))
                  }}
                >
                  <option value="">Match by source name</option>
                  {contacts.data?.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )
      ) : null}
      {showPreview ? (
        <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5">
          {ready.map(({ itemId, periodStart, periodEnd, facts, recordId }) => (
            <li key={itemId}>
              {periodStart === periodEnd
                ? periodStart
                : `${periodStart} – ${periodEnd}`}
              {recordId && <span> · Already saved</span>}
              {operation.reviewedRecord.previewFields.map(({ key, label }) => {
                const value = facts?.[key]
                return value ? (
                  <span key={key}>
                    {" · "}
                    {label} {value}
                  </span>
                ) : null
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {write.error instanceof ImportsPausedError ? (
        <div role="alert" className="space-y-1">
          <p className="font-medium">
            {t("settings.importTask.importsPaused", {
              defaultValue: "Imports are paused for an update",
            })}
          </p>
          <p>
            {t("settings.importTask.importsPausedResume", {
              defaultValue:
                "Your saved import is kept. Try again when imports resume; rows already saved are matched, not repeated.",
            })}
          </p>
        </div>
      ) : write.isError ? (
        <p role="alert">{write.error.message}</p>
      ) : null}
      {scheduledPreview === key ? (
        <p role="status">{t("settings.importOperator.serverRunning", { defaultValue: "The import is running. Check its saved result later." })}</p>
      ) : null}
      {!taskId && write.data && write.variables === false ? (
        <p role="status">
          {saved} saved · {matched} matched existing records · {held.length}{" "}
          need attention
        </p>
      ) : null}
      {recordLinks.length ? (
        <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5">
          {recordLinks.map(({ itemId, label, href }) => (
            <li key={itemId}>
              <a className="underline underline-offset-4" href={href}>
                {label ?? t("moduleRecords.recordHistory")}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {held.length ? (
        <ul className="list-disc pl-5">
          {held.map((row) => (
            <li key={row.itemId}>
              {items.find((item) => item.id === row.itemId)?.source.label}:{" "}
              {row.reason ?? "A saved record has different values."}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
