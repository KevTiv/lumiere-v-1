"use client"
import { useTranslation } from "@lumiere/i18n"


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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const resources = ["products", "mrp-boms", "mrp-bom-byproducts", "mrp-bom-lines",
  "stock-production-lots", "stock-production-serials", "stock-moves", "stock-quants", "stock-locations"] as const
const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm"
const labelOf = (row: TrackingRow) => String(row.name ?? row.displayName ?? row.id)
const valueOf = (row: TrackingRow, camel: string, snake: string) => row[camel] ?? row[snake]

export function ManufacturingTrackingPanel({ order, organizationId, companyId }: {
  order: TrackingRow; organizationId: bigint; companyId: bigint
}) {
  const { t } = useTranslation()
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
  const title = mode === "close" ? t("manufacturing.manufacturingTrackingPanel.closeWithLotOrSerialAttribution")
    : mode === "output" ? t("manufacturing.manufacturingTrackingPanel.scrapTrackedOutput") : t("manufacturing.manufacturingTrackingPanel.recordMaterialWastage")
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
    const numericQuantity = typeof qty === "number" ? qty : typeof qty === "string" || typeof qty === "bigint" ? Number(qty) : NaN
    return [product ? labelOf(product) : t("manufacturing.manufacturingTrackingPanel.productUnavailable"), serial ? labelOf(serial) : lot ? labelOf(lot) : t("manufacturing.manufacturingTrackingPanel.untracked"), t("manufacturing.manufacturingTrackingPanel.unitCount", { count: Number.isFinite(numericQuantity) ? numericQuantity : 2, quantity: String(qty) })].join(" · ")
  }
  const submit = async () => {
    if (inFlight.current || pendingUnknown || !references.data) return
    inFlight.current = true
    setBusy(true); setError(null); setLinks([])
    try {
      const api = getLumiereApiClientOrThrow()
      const snapshot = references.data
      const readOrdersAndMoves = async () => Promise.all([
        api.fetchQueryList("/api/query/mrp-productions", t("manufacturing.errors.unableToReadCompletedOrder")),
        api.fetchQueryList("/api/query/stock-moves", t("manufacturing.errors.unableToReadCompletedStockEffects")),
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
            return decodeOperationDispatch(await api.apiFetch(request.urlPath, request.init), t("manufacturing.errors.unableToCloseAttributedOutput"))
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
          await api.fetchQueryList("/api/query/stock-moves", t("manufacturing.errors.unableToReadCompletedScrap")))
        pendingReadback.current = resolveEffect
        const result = requireResolvedOperationEffect(await executeOperationWithCanonicalReadback({
          dispatch: async () => {
            const request = "outputMoveId" in input
              ? stdbBffCommandPost("scrap_tracked_manufacturing_output", input)
              : stdbBffCommandPost("scrap_manufacturing_material", input)
            return decodeOperationDispatch(await api.apiFetch(request.urlPath, request.init), t("manufacturing.errors.unableToRecordManufacturingWaste"))
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
      if (!ref) { setError(t("manufacturing.manufacturingTrackingPanel.thePreviousActionHasNotAppearedInTheCanonicalRecordsYet")); return }
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
      {mode === "material" ? <p className="text-sm text-muted-foreground">{t("manufacturing.manufacturingTrackingPanel.disposeOfAdditionalUnconsumedBOMMaterialThisLeavesTheOriginalBOM")}</p> : null}
      {references.isLoading ? <p role="status">{t("manufacturing.manufacturingTrackingPanel.loadingCompanyReferences")}</p> : null}
      {references.error || choices?.error ? <p role="alert">{references.error?.message ?? choices?.error}</p> : null}
      {mode === "close" ? choices?.requirements.map((requirement) => <label className="block space-y-1 text-sm" key={requirement.key}>
        <span>{labelOf(requirement.product)} · {requirement.quantity} {" "}{t("manufacturing.manufacturingTrackingPanel.units")}{" "}{requirement.tracking}</span>
        <Select disabled={busy} value={(requirement.tracking === "serial" ? selections[requirement.key]?.serialId : selections[requirement.key]?.lotId) ?? ""} onValueChange={(value) => setSelections({ ...selections, [requirement.key]: requirement.tracking === "serial"
            ? { serialId: value } : { lotId: value } })}>
          <SelectTrigger aria-label={`${labelOf(requirement.product)} ${requirement.tracking}`}>
            <SelectValue placeholder={<>{t("settings.formConfig.fieldDialog.fieldTypes.Select")}{" "}{requirement.tracking}</>} />
          </SelectTrigger>
          <SelectContent>
            {outputIdentityOptions(requirement, references.data!, organizationId, companyId).map((identity) => <SelectItem key={trackingId(identity.id)} value={trackingId(identity.id)}>{labelOf(identity)}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>) : <>
        <label className="block space-y-1 text-sm"><span>{mode === "output" ? t("manufacturing.manufacturingTrackingPanel.exactCompletedOutput") : t("manufacturing.manufacturingTrackingPanel.availableBOMMaterialStock")}</span>
          <Select value={sourceId} onValueChange={setSourceId} disabled={busy}>
            <SelectTrigger>
              <SelectValue placeholder={t("manufacturing.manufacturingTrackingPanel.selectStock")} />
            </SelectTrigger>
            <SelectContent>
              {choices?.sources.map((row) => <SelectItem key={trackingId(row.id)} value={trackingId(row.id)}>{sourceLabel(row)}</SelectItem>)}
            </SelectContent>
          </Select></label>
        <label className="block space-y-1 text-sm"><span>{t("manufacturing.rowActions.form.scrapLocation")}</span><Select value={locationId} onValueChange={setLocationId} disabled={busy}>
          <SelectTrigger>
            <SelectValue placeholder={t("manufacturing.manufacturingTrackingPanel.selectScrapLocation")} />
          </SelectTrigger>
          <SelectContent>
            {choices?.locations.map((row) => <SelectItem key={trackingId(row.id)} value={trackingId(row.id)}>{labelOf(row)}</SelectItem>)}
          </SelectContent>
        </Select></label>
        <label className="block space-y-1 text-sm"><span>{t("manufacturing.billsOfMaterials.columns.productQty")}</span><input className={inputClass} type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} /></label>
      </>}
      {mode === "close" && choices && !choices.error && choices.requirements.length === 0 ? <p className="text-sm">{t("manufacturing.manufacturingTrackingPanel.thisOrderHasNoTrackedOutputsUseTheStandardFinishAction")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {pendingUnknown ? <Button variant="outline" disabled={busy} onClick={() => void checkPreviousAction()}>{t("accounting.createInvoiceModal.checkPreviousAction")}</Button> : null}
      <Button disabled={busy || pendingUnknown || !choices || !!choices.error || !!references.error
        || (mode === "close" ? choices.requirements.length === 0 : !sourceId || !locationId || !quantity)} onClick={() => void submit()}>
        {busy ? t("common.saving") : title}
      </Button>
    </div> : null}
  </section>
}
