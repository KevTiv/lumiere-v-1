"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-fetch"
import type { ReviewDetail } from "./import-review-model"
import { useFarmOperationsEnabled } from "./use-farm-operations-enabled"

type FarmEffect = {
  kind: string
  businessDate: string
  count?: number
  sampleCount?: number
  totalWeightKg?: number
  feedProduct?: string
  quantityKg?: number
  liveWeightKg?: number
  sellableWeightKg?: number
  fromExclusive?: string
  cost?: { journalLineId: string; amount: string | number; currencyCode?: string; currencyId: string; allocationBasis: string }
}

type Result =
  | { status: "ready"; itemId: string; flockReference: string; digest: string; effect: FarmEffect; existingEventId?: string | null }
  | { status: "saved" | "matched"; itemId: string; batchId: string; eventId?: string; journalLineId?: string }
  | { status: "held" | "conflict"; itemId: string; reason: string }

type Selection = { itemId: string; revision: number; expectedDigest?: string }
type ApplyRequest =
  | { preview: true; scope: string; rows: Selection[] }
  | { preview: false; scope: string; rows: Selection[] }

const eventLabels: Record<string, string> = {
  intake: "Intake",
  mortality: "Mortality",
  transferIn: "Incoming transfer",
  transferOut: "Outgoing transfer",
  internalTransfer: "Internal transfer",
  liveSale: "Live sale",
  processing: "Processing",
  weighIn: "Weigh-in",
  feedUsage: "Feed use",
  feedCoverage: "Complete feed records",
  costLink: "Posted cost link",
}

function effectLabel(effect: FarmEffect): string {
  const cost = effect.cost
  const amounts = [
    effect.count == null ? null : `${effect.count} head`,
    effect.sampleCount == null ? null : `${effect.sampleCount} weighed`,
    effect.totalWeightKg == null ? null : `${effect.totalWeightKg} kg sample weight`,
    effect.quantityKg == null ? null : `${effect.quantityKg} kg ${effect.feedProduct ?? "feed"}`,
    effect.liveWeightKg == null ? null : `${effect.liveWeightKg} kg live input`,
    effect.sellableWeightKg == null ? null : `${effect.sellableWeightKg} kg sellable output`,
    effect.fromExclusive == null ? null : `after ${effect.fromExclusive}`,
    cost == null ? null : `Journal line ${cost.journalLineId} · ${cost.amount} ${cost.currencyCode ?? `(currency ${cost.currencyId})`} · ${cost.allocationBasis}`,
  ]
  return [effect.businessDate, eventLabels[effect.kind] ?? effect.kind, ...amounts]
    .filter(Boolean)
    .join(" · ")
}

export function FarmImportAction({
  detail,
  companyId,
  disabled,
}: {
  detail: ReviewDetail
  companyId: number
  disabled: boolean
}) {
  const enabled = useFarmOperationsEnabled(companyId)
  if (!enabled) return null
  return <FarmImportEditor detail={detail} companyId={companyId} disabled={disabled} />
}

function FarmImportEditor({ detail, companyId, disabled }: {
  detail: ReviewDetail
  companyId: number
  disabled: boolean
}) {
  const cache = useQueryClient()
  const reviewed = detail.items.filter((row) => row.state === "confirmed")
  const labels = new Map(detail.items.map((row) => [row.id, row.source.label]))
  const rows = reviewed.map((row) => ({ itemId: row.id, revision: row.revision }))
  const scope = JSON.stringify([companyId, detail.id, rows])
  const request = async ({ preview, rows }: ApplyRequest) => {
    const results: Result[] = []
    for (let start = 0; start < rows.length; start += 200) {
      const response = await apiFetch(`/api/import-reviews/${detail.id}/farm-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, preview, rows: rows.slice(start, start + 200) }),
      })
      const receipt = await response.json()
      if (!response.ok) {
        throw new Error(
          typeof receipt.error === "string"
            ? receipt.error
            : "Farm import could not be verified.",
        )
      }
      results.push(...(receipt.results as Result[]))
    }
    return results
  }
  const preview = useMutation({ mutationFn: request })
  const apply = useMutation({
    mutationFn: request,
    onSettled: () =>
      cache.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === "farm-batches" || (
          queryKey[0] === "import-workflow" && queryKey[3] === companyId
        ),
      }),
  })
  const proposed = preview.variables?.scope === scope ? preview.data ?? [] : []
  const applied = apply.variables?.scope === scope ? apply.data ?? [] : []
  const latest = new Map([...proposed, ...applied].map((row) => [row.itemId, row]))
  const selections = rows.flatMap((row) => {
    const result = latest.get(row.itemId)
    return result?.status === "ready" ? [{ ...row, expectedDigest: result.digest }] : []
  })
  const busy = preview.isPending || apply.isPending
  const error = [apply, preview].find(
    (attempt) => attempt.variables?.scope === scope && attempt.error,
  )?.error

  return (
    <section className="space-y-3 rounded-lg border p-3 text-sm" aria-label="Farm batch import">
      <p>Save dated activity and link posted costs to Farm Batches. Current stock and ledger balances stay the same.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || rows.length === 0}
          onClick={() => {
            apply.reset()
            preview.mutate({ preview: true, scope, rows })
          }}
        >
          Preview confirmed farm rows ({rows.length})
        </Button>
        {selections.length ? (
          <Button
            type="button"
            disabled={disabled || busy}
            onClick={() => apply.mutate({ preview: false, scope, rows: selections })}
          >
            {apply.isError ? "Check and retry" : "Apply reviewed farm rows"} ({selections.length})
          </Button>
        ) : null}
      </div>
      {busy ? <p role="status">{preview.isPending ? "Checking reviewed farm rows" : "Verifying saved farm rows"}</p> : null}
      {error ? <p role="alert" className="text-destructive">{error.message}</p> : null}
      {latest.size ? (
        <ul className="max-h-64 space-y-2 overflow-auto" aria-label="Farm import results">
          {[...latest.values()].map((row) => (
            <li key={row.itemId}>
              <span className="font-medium">{labels.get(row.itemId) ?? row.itemId}</span>{" · "}
              {row.status === "ready" ? (
                <span>{row.flockReference} · {effectLabel(row.effect)}{row.existingEventId ? " · Link the existing event" : null}</span>
              ) : "batchId" in row ? (
                <Link className="underline underline-offset-4" href={`/farm-batches/${row.batchId}?view=${row.journalLineId ? "costs" : "history"}`}>
                  {row.status === "saved" ? "Saved in Farm Batches" : "Already in Farm Batches"}
                </Link>
              ) : (
                <span>{row.reason}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
