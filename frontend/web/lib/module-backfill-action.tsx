"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { apiFetch } from "./api-fetch"
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
  const cache = useQueryClient()
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [showMatches, setShowMatches] = useState(false)
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
    },
    onSettled: (_data, _error, previewOnly) => {
      if (!previewOnly)
        return Promise.all([
          cache.invalidateQueries({
            queryKey: ["module-backfill", organizationId, companyId],
          }),
          cache.invalidateQueries({
            predicate: ({ queryKey }) =>
              queryKey[0] === "import-workflow" &&
              queryKey[2] === organizationId &&
              queryKey[3] === companyId,
          }),
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
  const matched =
    write.data?.results.filter((row) => row.status === "matched").length ?? 0
  const saved =
    write.data?.results.filter((row) => row.status === "saved").length ?? 0
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
        {ready.length > 0 ? (
          <Button
            disabled={disabled || write.isPending}
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
      {ready.length ? (
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
      {write.isError ? <p role="alert">{write.error.message}</p> : null}
      {write.data && write.variables === false ? (
        <p role="status">
          {saved} saved · {matched} matched existing records · {held.length}{" "}
          need attention
        </p>
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
