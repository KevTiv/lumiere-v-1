"use client"

import { useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { decodeOperationDispatch, getLumiereApiClientOrThrow } from "@lumiere/api-client"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { Button } from "@lumiere/ui"
import { executeOperationWithCanonicalReadback, requireResolvedOperationEffect, UnresolvedOperationEffectError,
  type CanonicalRecordRef } from "@lumiere/query-hooks/hooks/operation-effect"
import { invalidateResourceQueries } from "@lumiere/query-hooks/subscription-query"
import {
  buildManufacturingScrapIntent, buildTrackedCloseIntent, materialScrapOptions,
  outputIdentityOptions, outputTrackingRequirements, resolveTrackingCloseEffect,
  resolveTrackingScrapEffect, scrapLocationOptions, trackedOutputOptions, trackingId, trackingState,
  type ManufacturingTrackingSnapshot, type TrackingRow, type TrackingSelection,
} from "@/lib/manufacturing-tracking-intent"
import { manufacturingResultLinks, type ManufacturingResultLink } from "@/lib/manufacturing-result-links"
import { ManufacturingActionResult } from "./manufacturing-action-result"

const resources = ["products", "mrp-boms", "mrp-bom-byproducts", "mrp-bom-lines",
  "stock-production-lots", "stock-production-serials", "stock-moves", "stock-quants", "stock-locations"] as const
const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm"
const labelOf = (row: TrackingRow) => String(row.name ?? row.displayName ?? row.id)
const valueOf = (row: TrackingRow, camel: string, snake: string) => row[camel] ?? row[snake]

export function ManufacturingTrackingPanel({ order, organizationId, companyId }: {
  order: TrackingRow; organizationId: bigint; companyId: bigint
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selections, setSelections] = useState<Record<string, TrackingSelection>>({})
  const [sourceId, setSourceId] = useState("")
  const [locationId, setLocationId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [requestId, setRequestId] = useState("")
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const pendingReadback = useRef<(() => Promise<CanonicalRecordRef | null>) | null>(null)
  const [pendingUnknown, setPendingUnknown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [links, setLinks] = useState<ManufacturingResultLink[]>([])
  const state = trackingState(order)
  const mode = state === "toclose" ? "close" : state === "done" ? "output" : "material"
  const title = mode === "close" ? "Close with lot or serial attribution"
    : mode === "output" ? "Scrap tracked output" : "Record material wastage"
  const queryKey = ["manufacturing-tracking-refs", organizationId.toString(), companyId.toString(), trackingId(order.id)]
  const references = useQuery({ queryKey, enabled: open, queryFn: async (): Promise<ManufacturingTrackingSnapshot> => {
    const api = getLumiereApiClientOrThrow()
    const [products, boms, byproducts, bomLines, lots, serials, moves, quants, locations] = await Promise.all(
      resources.map((resource) => api.fetchQueryList(`/api/query/${resource}`, `Unable to read ${resource}`)))
    return { products: products!, boms: boms!, byproducts: byproducts!, bomLines: bomLines!, lots: lots!,
      serials: serials!, moves: moves!, quants: quants!, locations: locations! }
  } })
  const choices = useMemo(() => {
    if (!references.data) return null
    try {
      return { requirements: mode === "close" ? outputTrackingRequirements(order, references.data, organizationId, companyId) : [],
        sources: mode === "output" ? trackedOutputOptions(order, references.data, organizationId, companyId)
          : mode === "material" ? materialScrapOptions(order, references.data, organizationId, companyId) : [],
        locations: scrapLocationOptions(references.data, organizationId, companyId), error: undefined }
    } catch (error) {
      return { requirements: [], sources: [], locations: [], error: error instanceof Error ? error.message : String(error) }
    }
  }, [references.data, mode, order, organizationId, companyId])
  if (!["toclose", "done", "progress"].includes(state) || companyId === 0n
    || trackingId(valueOf(order, "companyId", "company_id")) !== companyId.toString()) return null

  const sourceLabel = (row: TrackingRow) => {
    const snapshot = references.data!
    const product = snapshot.products.find((product) => trackingId(product.id) === trackingId(valueOf(row, "productId", "product_id")))
    const lot = snapshot.lots.find((lot) => trackingId(lot.id) === trackingId(valueOf(row, "lotId", "lot_id")))
    const serial = snapshot.serials.find((serial) => trackingId(serial.id) === trackingId(valueOf(row, "serialId", "serial_id")))
    const qty = mode === "output" ? valueOf(row, "quantityDone", "quantity_done") : valueOf(row, "availableQuantity", "available_quantity")
    return [product ? labelOf(product) : "Product unavailable", serial ? labelOf(serial) : lot ? labelOf(lot) : "Untracked", `${qty} units`].join(" · ")
  }
  const submit = async () => {
    if (inFlight.current || pendingUnknown || !references.data) return
    inFlight.current = true
    setBusy(true); setError(null); setLinks([])
    try {
      const api = getLumiereApiClientOrThrow()
      const snapshot = references.data
      const readOrdersAndMoves = async () => Promise.all([
        api.fetchQueryList("/api/query/mrp-productions", "Unable to read completed order"),
        api.fetchQueryList("/api/query/stock-moves", "Unable to read completed stock effects"),
      ])
      const refresh = async () => {
        invalidateResourceQueries(qc, organizationId, ["mrp-productions", "stock-moves", "stock-quants", "stock-production-serials", "mrp-production-costs", "account-moves"])
        await qc.invalidateQueries({ queryKey })
      }
      if (mode === "close") {
        const input = buildTrackedCloseIntent(order, snapshot, organizationId, companyId, selections)
        const resolveEffect = async () => {
          const [orders, moves] = await readOrdersAndMoves()
          return resolveTrackingCloseEffect(order, snapshot, organizationId, companyId, input, orders, moves)
        }
        pendingReadback.current = resolveEffect
        const result = requireResolvedOperationEffect(await executeOperationWithCanonicalReadback({
          dispatch: async () => {
            const request = stdbBffCommandPost("finish_manufacturing_order_with_tracking", input)
            return decodeOperationDispatch(await api.apiFetch(request.urlPath, request.init), "Unable to close attributed output")
          },
          resolveEffect, afterDispatch: refresh, readbackAttempts: 6,
        }))
        setLinks(manufacturingResultLinks(result.ref))
      } else {
        // Keep this identity after an unknown outcome so another attempt cannot
        // record the same intent twice. A new intent follows proven completion.
        const key = requestId || crypto.randomUUID()
        setRequestId(key)
        const input = buildManufacturingScrapIntent(mode, order, snapshot, organizationId, companyId,
          sourceId, locationId, Number(quantity), key)
        const resolveEffect = async () => resolveTrackingScrapEffect(mode, order, organizationId, companyId, input,
          await api.fetchQueryList("/api/query/stock-moves", "Unable to read completed scrap"))
        pendingReadback.current = resolveEffect
        const result = requireResolvedOperationEffect(await executeOperationWithCanonicalReadback({
          dispatch: async () => {
            const request = "outputMoveId" in input
              ? stdbBffCommandPost("scrap_tracked_manufacturing_output", input)
              : stdbBffCommandPost("scrap_manufacturing_material", input)
            return decodeOperationDispatch(await api.apiFetch(request.urlPath, request.init), "Unable to record manufacturing waste")
          }, resolveEffect,
          afterDispatch: refresh, readbackAttempts: 6,
        }))
        setLinks(manufacturingResultLinks(result.ref)); setRequestId(""); setQuantity("")
      }
      pendingReadback.current = null
    } catch (error) {
      setPendingUnknown(error instanceof UnresolvedOperationEffectError)
      if (!(error instanceof UnresolvedOperationEffectError)) pendingReadback.current = null
      setError(error instanceof Error ? error.message : String(error))
    }
    finally { inFlight.current = false; setBusy(false) }
  }
  const checkPreviousAction = async () => {
    if (inFlight.current || !pendingReadback.current) return
    inFlight.current = true; setBusy(true)
    try {
      const ref = await pendingReadback.current()
      if (!ref) { setError("The previous action has not appeared in the canonical records yet. Check again after refresh."); return }
      setLinks(manufacturingResultLinks(ref)); setPendingUnknown(false); setError(null)
      setRequestId(""); setQuantity(""); pendingReadback.current = null
      invalidateResourceQueries(qc, organizationId, ["mrp-productions", "stock-moves", "stock-quants", "stock-production-serials"])
      await qc.invalidateQueries({ queryKey })
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <section className="rounded-lg border p-4" data-testid="manufacturing-tracking-panel">
    <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>{title}</Button>
    <ManufacturingActionResult links={links} onDismiss={() => setLinks([])} />
    {open ? <div className="mt-3 space-y-3">
      {mode === "material" ? <p className="text-sm text-muted-foreground">Dispose of additional unconsumed BOM material. This leaves the original BOM consumption requirement unchanged.</p> : null}
      {references.isLoading ? <p role="status">Loading company references…</p> : null}
      {references.error || choices?.error ? <p role="alert">{references.error?.message ?? choices?.error}</p> : null}
      {mode === "close" ? choices?.requirements.map((requirement) => <label className="block space-y-1 text-sm" key={requirement.key}>
        <span>{labelOf(requirement.product)} · {requirement.quantity} units · {requirement.tracking}</span>
        <select className={inputClass} aria-label={`${labelOf(requirement.product)} ${requirement.tracking}`} disabled={busy}
          value={(requirement.tracking === "serial" ? selections[requirement.key]?.serialId : selections[requirement.key]?.lotId) ?? ""}
          onChange={(event) => setSelections({ ...selections, [requirement.key]: requirement.tracking === "serial"
            ? { serialId: event.target.value } : { lotId: event.target.value } })}>
          <option value="">Select {requirement.tracking}</option>
          {outputIdentityOptions(requirement, references.data!, organizationId, companyId).map((identity) => <option key={trackingId(identity.id)} value={trackingId(identity.id)}>{labelOf(identity)}</option>)}
        </select>
      </label>) : <>
        <label className="block space-y-1 text-sm"><span>{mode === "output" ? "Exact completed output" : "Available BOM material stock"}</span>
          <select className={inputClass} value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={busy}>
            <option value="">Select stock</option>{choices?.sources.map((row) => <option key={trackingId(row.id)} value={trackingId(row.id)}>{sourceLabel(row)}</option>)}
          </select></label>
        <label className="block space-y-1 text-sm"><span>Scrap location</span><select className={inputClass} value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={busy}>
          <option value="">Select scrap location</option>{choices?.locations.map((row) => <option key={trackingId(row.id)} value={trackingId(row.id)}>{labelOf(row)}</option>)}
        </select></label>
        <label className="block space-y-1 text-sm"><span>Quantity</span><input className={inputClass} type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} /></label>
      </>}
      {mode === "close" && choices && !choices.error && choices.requirements.length === 0 ? <p className="text-sm">This order has no tracked outputs. Use the standard finish action.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {pendingUnknown ? <Button variant="outline" disabled={busy} onClick={() => void checkPreviousAction()}>Check previous action</Button> : null}
      <Button disabled={busy || pendingUnknown || !choices || !!choices.error || !!references.error
        || (mode === "close" ? choices.requirements.length === 0 : !sourceId || !locationId || !quantity)} onClick={() => void submit()}>
        {busy ? "Saving…" : title}
      </Button>
    </div> : null}
  </section>
}
