"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import type { BackfillModule } from "../components/module-backfill-records"
import { apiFetch } from "./api-fetch"
import type { ReviewDetail, ReviewRow } from "./import-review-model"

type Receipt = {
  results: Array<{
    itemId: string
    status: "ready" | "saved" | "matched" | "held" | "conflict"
    reason?: string
    recordId?: string
    digest?: string
    periodStart?: string
    periodEnd?: string
    facts?: {
      customer?: string
      product?: string
      quantity?: string
      unit?: string
      unitPrice?: string
      amount?: string
      currency?: string
      pieces?: string
      kilograms?: string
    }
  }>
}
type Contact = {
  id: string | number
  name: string
  isCustomer?: boolean
  is_customer?: boolean
}

function destination(item: ReviewRow): BackfillModule | undefined {
  const labels = new Set(item.source.fields.map((field) => field.label))
  const keys = new Set(item.source.fields.map((field) => field.key))
  if (
    (labels.has("Source customer label") &&
      labels.has("Recorded sales total (RWF)")) ||
    (keys.has("customer_label") &&
      keys.has("quantity") &&
      keys.has("unit_price") &&
      keys.has("amount"))
  )
    return "sales"
  if (
    (labels.has("Recorded piece count") &&
      labels.has("Recorded weight (kg)")) ||
    (keys.has("pieces") && keys.has("kilograms"))
  )
    return "warehouse"
}

export function ModuleBackfillAction({
  detail,
  companyId,
  organizationId,
  actor,
  disabled,
}: {
  detail: ReviewDetail
  companyId: number
  organizationId: number
  actor: string | null | undefined
  disabled: boolean
}) {
  if (detail.targetEntity !== "source_observation") return null
  return (["sales", "warehouse"] as const).map((module) => {
    const items = detail.items.filter(
      (item) => item.state !== "excluded" && destination(item) === module,
    )
    return items.length ? (
      <BackfillAction
        key={`${organizationId}:${companyId}:${actor}:${detail.id}:${module}`}
        batchId={detail.id}
        companyId={companyId}
        organizationId={organizationId}
        actor={actor}
        module={module}
        items={items}
        disabled={disabled}
      />
    ) : null
  })
}

function BackfillAction({
  batchId,
  companyId,
  organizationId,
  actor,
  items,
  module,
  disabled,
}: {
  batchId: string
  companyId: number
  organizationId: number
  actor: string | null | undefined
  items: ReviewRow[]
  module: BackfillModule
  disabled: boolean
}) {
  const cache = useQueryClient()
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [showMatches, setShowMatches] = useState(false)
  const [preview, setPreview] = useState<{
    key: string
    receipt: Receipt
  } | null>(null)
  const key = JSON.stringify(
    items.map((item) => [item.id, item.revision, overrides[item.id]]),
  )
  const ready =
    preview?.key === key
      ? preview.receipt.results.filter((row) => row.status === "ready")
      : []
  const contacts = useQuery({
    queryKey: ["module-backfill-contacts", organizationId, companyId, actor],
    enabled: showMatches && module === "sales",
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
      const selected = previewOnly
        ? items
        : items.filter((item) => ready.some((row) => row.itemId === item.id))
      for (let start = 0; start < selected.length; start += 200) {
        const response = await apiFetch(
          `/api/import-reviews/${batchId}/module-backfill`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              module,
              preview: previewOnly,
              rows: selected.slice(start, start + 200).map((item) => ({
                itemId: item.id,
                revision: item.revision,
                customerId: overrides[item.id] || undefined,
                expectedDigest: previewOnly
                  ? undefined
                  : ready.find((row) => row.itemId === item.id)?.digest,
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
  const sales = module === "sales"
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
          {sales
            ? "Preview customer sales backfill"
            : "Preview inventory count backfill"}
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
        {sales ? (
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
          href={
            sales
              ? "/sales#backfilled-records"
              : "/warehouse#backfilled-records"
          }
        >
          {sales ? "Open Sales records" : "Open Warehouse records"}
        </a>
      </div>
      {showMatches && sales ? (
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
          {ready.map(({ itemId, periodStart, periodEnd, facts }) => (
            <li key={itemId}>
              {periodStart === periodEnd
                ? periodStart
                : `${periodStart} – ${periodEnd}`}{" "}
              · {facts?.customer ? `${facts.customer} · ` : ""}
              {facts?.product}
              {sales
                ? ` · ${facts?.quantity}${facts?.unit ? ` ${facts.unit}` : ""} × ${facts?.unitPrice} = ${facts?.amount} ${facts?.currency}`
                : ` · ${facts?.pieces} pieces · ${facts?.kilograms} kg`}
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
