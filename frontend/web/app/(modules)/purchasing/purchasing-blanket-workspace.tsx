"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button, Input, Label } from "@lumiere/ui"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"

type Row = Record<string, unknown>
type DraftLine = {
  key: number
  productId: string
  productUom: string
  committedQuantity: string
  priceUnit: string
}

const QUANTITY_TOLERANCE = 1e-6

export interface PurchasingBlanketWorkspaceProps {
  blanketOrders: Row[]
  blanketLines: Row[]
  blanketReleases: Row[]
  vendors: Row[]
  products: Row[]
  uoms: Row[]
  currencies: Row[]
  createBlanket: (params: {
    name: string
    partnerId: bigint
    currencyId: bigint
    dateStart: unknown | null
    dateEnd: unknown | null
    lines: Array<{
      productId: bigint
      productUom: bigint
      committedQuantity: number
      priceUnit: number
    }>
  }) => Promise<void>
  releaseBlanket: (
    blanketOrderId: bigint,
    params: {
      idempotencyKey: string
      lines: Array<{ blanketLineId: bigint; quantity: number }>
      notes: string | null
      datePlanned: unknown | null
    },
  ) => Promise<void>
  createRequestToken?: number
  actionRequest?: { kind: "create" | "release"; token: number } | null
  embedded?: boolean
  onOpenPurchaseOrder: (purchaseOrderId: string) => void
}

function rowId(row: Row): string {
  return String(row.id ?? "")
}

function active(row: Row): boolean {
  return row.active !== false && row.active !== 0 && row.isActive !== false && row.isActive !== 0 && row.is_active !== false && row.is_active !== 0
}

function activeVendor(row: Row): boolean {
  return active(row) && row.deletedAt == null && row.deleted_at == null && (row.isVendor === true || row.isVendor === 1 || Number(row.supplierRank ?? row.supplier_rank ?? 0) > 0)
}

function purchasableProduct(row: Row): boolean {
  return active(row) && (row.purchaseOk === true || row.purchase_ok === true)
}

function timestampMs(value: unknown): number | null {
  if (value == null || value === "") return null
  const raw =
    typeof value === "object" && value !== null
      ? ((value as Record<string, unknown>).microsSinceUnixEpoch ??
        (value as Record<string, unknown>).__timestamp_micros_since_unix_epoch__)
      : value
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1e15) return numeric / 1000
    if (numeric < 1e11) return numeric * 1000
    return numeric
  }
  const parsed = new Date(String(raw)).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function dateValue(value: unknown): string {
  const ms = timestampMs(value)
  return ms == null ? "—" : new Date(ms).toLocaleDateString()
}

function isReleaseWindowOpen(order: Row): boolean {
  const now = Date.now()
  const starts = timestampMs(order.dateStart ?? order.date_start)
  const ends = timestampMs(order.dateEnd ?? order.date_end)
  return (starts == null || starts <= now) && (ends == null || ends >= now)
}

function timestampFromDateInput(value: string, endOfDay = false): unknown | null {
  if (!value) return null
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`)
  return Number.isNaN(date.getTime()) ? null : stbTimestampFromDate(date)
}

function label(row: Row, kind: "vendor" | "product" | "uom" | "currency"): string {
  if (kind === "vendor") return String(row.displayName ?? row.name ?? row.email ?? `Vendor ${rowId(row)}`)
  if (kind === "product") return String(row.displayName ?? row.name ?? row.defaultCode ?? `Product ${rowId(row)}`)
  if (kind === "uom") return String(row.name ?? row.displayName ?? `UoM ${rowId(row)}`)
  return String(row.name ?? row.fullName ?? row.symbol ?? row.code ?? `Currency ${rowId(row)}`)
}

function newDraftLine(key: number): DraftLine {
  return { key, productId: "", productUom: "", committedQuantity: "", priceUnit: "" }
}

function positive(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function nonNegative(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function compatiblePurchaseUom(product: Row, uom: Row, uomById: Map<string, Row>): boolean {
  const purchaseUom = uomById.get(String(product.uomPoId ?? product.uom_po_id ?? ""))
  const category = String(purchaseUom?.categoryId ?? purchaseUom?.category_id ?? "")
  return category !== "" && active(uom) && String(uom.categoryId ?? uom.category_id ?? "") === category
}

/** Purchasing-only authoring and release workspace backed by blanket subscriptions. */
export function PurchasingBlanketWorkspace({
  blanketOrders,
  blanketLines,
  blanketReleases,
  vendors,
  products,
  uoms,
  currencies,
  createBlanket,
  releaseBlanket,
  createRequestToken,
  actionRequest,
  embedded = false,
  onOpenPurchaseOrder,
}: PurchasingBlanketWorkspaceProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [partnerId, setPartnerId] = useState("")
  const [currencyId, setCurrencyId] = useState("")
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")
  const [nextLineKey, setNextLineKey] = useState(2)
  const [draftLines, setDraftLines] = useState<DraftLine[]>(() => [newDraftLine(1)])
  const [selectedBlanketId, setSelectedBlanketId] = useState("")
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releasePending, setReleasePending] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [releaseAttemptId, setReleaseAttemptId] = useState<string | null>(null)
  const [releaseQuantities, setReleaseQuantities] = useState<Record<string, string>>({})
  const [releaseNotes, setReleaseNotes] = useState("")
  const [releaseDate, setReleaseDate] = useState("")
  const handledActionToken = useRef(0)

  const selectableVendors = useMemo(() => vendors.filter(activeVendor), [vendors])
  const selectableProducts = useMemo(() => products.filter(purchasableProduct), [products])
  const productById = useMemo(() => new Map(products.map((product) => [rowId(product), product])), [products])
  const uomById = useMemo(() => new Map(uoms.map((uom) => [rowId(uom), uom])), [uoms])
  const productNames = useMemo(() => new Map(products.map((product) => [rowId(product), label(product, "product")])), [products])
  const uomNames = useMemo(() => new Map(uoms.map((uom) => [rowId(uom), label(uom, "uom")])), [uoms])
  const vendorNames = useMemo(() => new Map(vendors.map((vendor) => [rowId(vendor), label(vendor, "vendor")])), [vendors])

  useEffect(() => {
    if (createRequestToken != null && createRequestToken > 0) setCreateOpen(true)
  }, [createRequestToken])

  useEffect(() => {
    if (!embedded && !selectedBlanketId && blanketOrders[0]) setSelectedBlanketId(rowId(blanketOrders[0]))
  }, [blanketOrders, embedded, selectedBlanketId])

  const selectedOrder = blanketOrders.find((order) => rowId(order) === selectedBlanketId)
  const selectedLines = useMemo(
    () => blanketLines.filter((line) => String(line.blanketOrderId ?? line.blanket_order_id ?? "") === selectedBlanketId),
    [blanketLines, selectedBlanketId],
  )
  const selectedReleases = useMemo(
    () => blanketReleases.filter((release) => String(release.blanketOrderId ?? release.blanket_order_id ?? "") === selectedBlanketId),
    [blanketReleases, selectedBlanketId],
  )
  const releasableLines = useMemo(
    () => selectedLines.filter((line) => {
      const product = productById.get(String(line.productId ?? line.product_id ?? ""))
      const uom = uomById.get(String(line.productUom ?? line.product_uom ?? ""))
      return purchasableProduct(product ?? {}) && compatiblePurchaseUom(product ?? {}, uom ?? {}, uomById) && Number(line.committedQuantity ?? line.committed_quantity ?? 0) - Number(line.releasedQuantity ?? line.released_quantity ?? 0) > QUANTITY_TOLERANCE
    }),
    [selectedLines, productById, uomById],
  )
  const canRelease =
    selectedOrder != null &&
    String(selectedOrder.state ?? "").toLowerCase() === "draft" &&
    isReleaseWindowOpen(selectedOrder) &&
    releasableLines.length > 0
  const eligibleOrders = useMemo(
    () => blanketOrders.filter((order) => {
      if (String(order.state ?? "").toLowerCase() !== "draft" || !isReleaseWindowOpen(order)) return false
      return blanketLines.some((line) => {
        if (String(line.blanketOrderId ?? line.blanket_order_id ?? "") !== rowId(order)) return false
        const product = productById.get(String(line.productId ?? line.product_id ?? ""))
        const uom = uomById.get(String(line.productUom ?? line.product_uom ?? ""))
        const remaining = Number(line.committedQuantity ?? line.committed_quantity ?? 0) - Number(line.releasedQuantity ?? line.released_quantity ?? 0)
        return purchasableProduct(product ?? {}) && compatiblePurchaseUom(product ?? {}, uom ?? {}, uomById) && remaining > QUANTITY_TOLERANCE
      })
    }),
    [blanketLines, blanketOrders, productById, uomById],
  )

  const compatibleUoms = (productId: string) => {
    const product = productById.get(productId)
    if (!product) return []
    const purchaseUomId = String(product.uomPoId ?? product.uom_po_id ?? "")
    const purchaseUom = uomById.get(purchaseUomId)
    const category = String(purchaseUom?.categoryId ?? purchaseUom?.category_id ?? "")
    return uoms.filter((uom) => active(uom) && category !== "" && String(uom.categoryId ?? uom.category_id ?? "") === category)
  }

  const remainingForOrder = (orderId: string) =>
    blanketLines
      .filter((line) => String(line.blanketOrderId ?? line.blanket_order_id ?? "") === orderId)
      .reduce(
        (total, line) =>
          total +
          Math.max(
            0,
            Number(line.committedQuantity ?? line.committed_quantity ?? 0) -
              Number(line.releasedQuantity ?? line.released_quantity ?? 0),
          ),
        0,
      )

  const updateLine = (key: number, update: Partial<DraftLine>) => {
    setDraftLines((lines) => lines.map((line) => (line.key === key ? { ...line, ...update } : line)))
  }

  const changeLineProduct = (line: DraftLine, productId: string) => {
    const compatible = compatibleUoms(productId)
    const defaultUomId = String(productById.get(productId)?.uomPoId ?? productById.get(productId)?.uom_po_id ?? "")
    const validDefault = compatible.some((uom) => rowId(uom) === defaultUomId)
    updateLine(line.key, { productId, productUom: validDefault ? defaultUomId : "" })
  }

  const resetCreate = () => {
    setName("")
    setPartnerId("")
    setCurrencyId("")
    setDateStart("")
    setDateEnd("")
    setDraftLines([newDraftLine(1)])
    setNextLineKey(2)
    setCreateError(null)
  }

  const submitCreate = async () => {
    const trimmedName = name.trim()
    if (!trimmedName || !selectableVendors.some((vendor) => rowId(vendor) === partnerId) || !currencyId) {
      setCreateError("Name, an active vendor, and currency are required.")
      return
    }
    if (dateStart && dateEnd && dateStart > dateEnd) {
      setCreateError("Start date must be on or before the end date.")
      return
    }
    const mappedLines = draftLines.map((line) => {
      const product = productById.get(line.productId)
      const validUom = compatibleUoms(line.productId).some((uom) => rowId(uom) === line.productUom)
      return { line, product, validUom, quantity: positive(line.committedQuantity), price: nonNegative(line.priceUnit) }
    })
    if (mappedLines.length === 0 || mappedLines.some(({ product, validUom, quantity, price }) => !purchasableProduct(product ?? {}) || !validUom || quantity == null || price == null)) {
      setCreateError("Every line needs an active purchasable product, a compatible active UoM, a positive quantity, and a non-negative price.")
      return
    }
    setCreateError(null)
    setCreatePending(true)
    try {
      await createBlanket({
        name: trimmedName,
        partnerId: BigInt(partnerId),
        currencyId: BigInt(currencyId),
        dateStart: timestampFromDateInput(dateStart),
        dateEnd: timestampFromDateInput(dateEnd, true),
        lines: mappedLines.map(({ line, quantity, price }) => ({ productId: BigInt(line.productId), productUom: BigInt(line.productUom), committedQuantity: quantity!, priceUnit: price! })),
      })
      resetCreate()
      setCreateOpen(false)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreatePending(false)
    }
  }

  const openRelease = () => {
    if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
      setReleaseError("Secure UUID generation is unavailable; release cannot be started safely.")
      return
    }
    setReleaseError(null)
    setReleaseAttemptId(crypto.randomUUID())
    setReleaseOpen(true)
  }

  const selectReleaseBlanket = (orderId: string) => {
    setSelectedBlanketId(orderId)
    setReleaseQuantities({})
    setReleaseError(null)
    if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
      setReleaseError("Secure UUID generation is unavailable; release cannot be started safely.")
      setReleaseAttemptId(null)
      return
    }
    setReleaseAttemptId(crypto.randomUUID())
  }

  const closeRelease = () => {
    setReleaseOpen(false)
    setReleaseError(null)
    setReleaseAttemptId(null)
  }

  useEffect(() => {
    if (!actionRequest || actionRequest.token <= 0 || handledActionToken.current === actionRequest.token) return
    handledActionToken.current = actionRequest.token
    if (actionRequest.kind === "create") {
      setReleaseOpen(false)
      setCreateOpen(true)
      return
    }
    setSelectedBlanketId("")
    setReleaseAttemptId(null)
    setReleaseQuantities({})
    setCreateOpen(false)
    setReleaseError(eligibleOrders.length === 0 ? "There is no blanket order currently eligible for release." : null)
    setReleaseOpen(true)
  }, [actionRequest, eligibleOrders])

  const submitRelease = async () => {
    if (!selectedOrder || !canRelease || !releaseAttemptId) {
      setReleaseError("This blanket is not eligible for release.")
      return
    }
    const lines = releasableLines.flatMap((line) => {
      const quantity = positive(releaseQuantities[rowId(line)] ?? "")
      return quantity == null ? [] : [{ blanketLineId: rowId(line), quantity }]
    })
    if (lines.length === 0) {
      setReleaseError("Enter a positive release quantity for an available line.")
      return
    }
    if (lines.some(({ blanketLineId, quantity }) => {
      const line = releasableLines.find((candidate) => rowId(candidate) === blanketLineId)
      const remaining = Number(line?.committedQuantity ?? line?.committed_quantity ?? 0) - Number(line?.releasedQuantity ?? line?.released_quantity ?? 0)
      return quantity > remaining + QUANTITY_TOLERANCE
    })) {
      setReleaseError("A release quantity exceeds the remaining committed quantity.")
      return
    }
    setReleaseError(null)
    setReleasePending(true)
    try {
      await releaseBlanket(BigInt(selectedBlanketId), {
        idempotencyKey: releaseAttemptId,
        lines: lines.map(({ blanketLineId, quantity }) => ({ blanketLineId: BigInt(blanketLineId), quantity })),
        notes: releaseNotes.trim() || null,
        datePlanned: timestampFromDateInput(releaseDate),
      })
      setReleaseQuantities({})
      setReleaseNotes("")
      setReleaseDate("")
      closeRelease()
    } catch (error) {
      // Deliberately retain all values and the idempotency key for retry.
      setReleaseError(error instanceof Error ? error.message : String(error))
    } finally {
      setReleasePending(false)
    }
  }

  if (embedded) {
    return (
      <section className="space-y-3 rounded-md border p-3" data-testid="purchasing-blanket-ops-form">
        {createOpen ? <>
          <h4 className="font-medium">New blanket order</h4>
          <div className="grid gap-2 md:grid-cols-2"><Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Vendor"><NativeSelect value={partnerId} onChange={setPartnerId} placeholder="Select an active vendor" options={selectableVendors} kind="vendor" /></Field><Field label="Currency"><NativeSelect value={currencyId} onChange={setCurrencyId} placeholder="Select a currency" options={currencies} kind="currency" /></Field><div className="grid grid-cols-2 gap-2"><Field label="Start"><Input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} /></Field><Field label="End"><Input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} /></Field></div></div>
          {draftLines.map((line, index) => <DraftLineEditor key={line.key} line={line} index={index} products={selectableProducts} uoms={compatibleUoms(line.productId)} onProductChange={(productId) => changeLineProduct(line, productId)} onChange={(update) => updateLine(line.key, update)} onRemove={() => setDraftLines((lines) => lines.filter((candidate) => candidate.key !== line.key))} canRemove={draftLines.length > 1} />)}
          <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setDraftLines((lines) => [...lines, newDraftLine(nextLineKey)]); setNextLineKey((key) => key + 1) }}>Add line</Button><Button size="sm" disabled={createPending || selectableVendors.length === 0 || selectableProducts.length === 0 || uoms.length === 0 || currencies.length === 0} onClick={() => void submitCreate()}>{createPending ? "Creating…" : "Create blanket"}</Button><Button type="button" size="sm" variant="outline" onClick={() => { resetCreate(); setCreateOpen(false) }}>Cancel</Button></div>
          {createError ? <p className="text-sm text-destructive" role="alert">{createError}</p> : null}
        </> : null}
        {releaseOpen ? <>
          <h4 className="font-medium">Release blanket to purchase order</h4>
          <Field label="Eligible blanket"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedBlanketId} onChange={(event) => selectReleaseBlanket(event.target.value)}><option value="">Select eligible blanket</option>{eligibleOrders.map((order) => <option key={rowId(order)} value={rowId(order)}>{String(order.name ?? `Blanket ${rowId(order)}`)} · {vendorNames.get(String(order.partnerId ?? order.partner_id ?? "")) ?? "Vendor"} · ends {dateValue(order.dateEnd ?? order.date_end)} · {remainingForOrder(rowId(order)).toLocaleString()} remaining</option>)}</select></Field>
          {!selectedOrder ? <p className="text-sm text-muted-foreground">Choose an eligible blanket order to enter release quantities.</p> : releasableLines.map((line) => { const remaining = Number(line.committedQuantity ?? line.committed_quantity ?? 0) - Number(line.releasedQuantity ?? line.released_quantity ?? 0); return <div key={rowId(line)} className="grid grid-cols-[1fr_9rem] items-center gap-2"><Label htmlFor={`ops-release-${rowId(line)}`}>{productNames.get(String(line.productId ?? line.product_id ?? "")) ?? "Unavailable product"} ({remaining.toLocaleString()} remaining)</Label><Input id={`ops-release-${rowId(line)}`} type="number" min={QUANTITY_TOLERANCE} max={remaining + QUANTITY_TOLERANCE} step="any" value={releaseQuantities[rowId(line)] ?? ""} onChange={(event) => setReleaseQuantities((quantities) => ({ ...quantities, [rowId(line)]: event.target.value }))} /></div> })}
          <div className="grid gap-2 md:grid-cols-2"><Input aria-label="Release notes" placeholder="Notes (optional)" value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} /><Input aria-label="Planned date" type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></div>
          <div className="flex gap-2"><Button size="sm" disabled={releasePending || !canRelease} onClick={() => void submitRelease()}>{releasePending ? "Releasing…" : "Release to PO"}</Button><Button type="button" size="sm" variant="outline" disabled={releasePending} onClick={closeRelease}>Cancel</Button></div>
          {releaseError ? <p className="text-sm text-destructive" role="alert">{releaseError}</p> : null}
        </> : null}
      </section>
    )
  }

  return (
    <section className="space-y-4" data-testid="purchasing-blanket-workspace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Blanket orders</h2>
          <p className="text-sm text-muted-foreground">Commit vendor pricing and release remaining quantities to purchase orders.</p>
        </div>
        <Button data-testid="purchasing-blanket-create" onClick={() => setCreateOpen((open) => !open)}>{createOpen ? "Close create form" : "New blanket order"}</Button>
      </div>

      {createOpen ? <div className="space-y-4 rounded-md border p-4" data-testid="purchasing-blanket-create-form">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Vendor"><NativeSelect value={partnerId} onChange={setPartnerId} placeholder="Select an active vendor" options={selectableVendors} kind="vendor" /></Field>
          <Field label="Currency"><NativeSelect value={currencyId} onChange={setCurrencyId} placeholder="Select a currency" options={currencies} kind="currency" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Start"><Input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} /></Field><Field label="End"><Input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} /></Field></div>
        </div>
        <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-medium">Committed lines</h3><Button type="button" size="sm" variant="outline" onClick={() => { setDraftLines((lines) => [...lines, newDraftLine(nextLineKey)]); setNextLineKey((key) => key + 1) }}>Add line</Button></div>
          {draftLines.map((line, index) => <DraftLineEditor key={line.key} line={line} index={index} products={selectableProducts} uoms={compatibleUoms(line.productId)} onProductChange={(productId) => changeLineProduct(line, productId)} onChange={(update) => updateLine(line.key, update)} onRemove={() => setDraftLines((lines) => lines.filter((candidate) => candidate.key !== line.key))} canRemove={draftLines.length > 1} />)}
        </div>
        {createError ? <p className="text-sm text-destructive" role="alert">{createError}</p> : null}
        <div className="flex gap-2"><Button disabled={createPending || selectableVendors.length === 0 || selectableProducts.length === 0 || uoms.length === 0 || currencies.length === 0} onClick={() => void submitCreate()}>{createPending ? "Creating…" : "Create blanket order"}</Button><Button type="button" variant="outline" onClick={() => { resetCreate(); setCreateOpen(false) }}>Cancel</Button></div>
      </div> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.4fr)]">
        <div className="overflow-hidden rounded-md border"><div className="border-b px-3 py-2 text-sm font-medium">Orders</div><div className="max-h-[32rem] overflow-auto">{blanketOrders.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No blanket orders yet.</p> : blanketOrders.map((order) => <button key={rowId(order)} type="button" className={`w-full border-b px-3 py-3 text-left text-sm hover:bg-muted ${rowId(order) === selectedBlanketId ? "bg-muted" : ""}`} onClick={() => { setSelectedBlanketId(rowId(order)); closeRelease() }}><span className="block font-medium">{String(order.name ?? `Blanket ${rowId(order)}`)}</span><span className="block text-muted-foreground">{String(order.state ?? "Draft")} · {Number(order.releaseCount ?? order.release_count ?? 0)} releases</span></button>)}</div></div>
        <div className="space-y-4 rounded-md border p-4">
          {!selectedOrder ? <p className="text-sm text-muted-foreground">Select a blanket order to view its details.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{String(selectedOrder.name ?? "Blanket order")}</h3><p className="text-sm text-muted-foreground">Effective {dateValue(selectedOrder.dateStart ?? selectedOrder.date_start)} – {dateValue(selectedOrder.dateEnd ?? selectedOrder.date_end)}</p></div><Button size="sm" disabled={!canRelease} onClick={openRelease}>Release to PO</Button></div>
            {!isReleaseWindowOpen(selectedOrder) ? <p className="text-sm text-muted-foreground">This blanket is not currently within its release window.</p> : null}
            <div><h4 className="mb-2 text-sm font-medium">Authoritative lines</h4><div className="space-y-2">{selectedLines.length === 0 ? <p className="text-sm text-muted-foreground">No committed lines.</p> : selectedLines.map((line) => <AuthoritativeLine key={rowId(line)} line={line} product={productById.get(String(line.productId ?? line.product_id ?? ""))} uom={uomById.get(String(line.productUom ?? line.product_uom ?? ""))} uomById={uomById} />)}</div></div>
            {releaseOpen ? <div className="space-y-3 rounded border border-primary/40 p-3" data-testid="purchasing-blanket-release-form"><div><h4 className="font-medium">Release selected quantities</h4><p className="text-xs text-muted-foreground">Retries use the same secure idempotency key until this attempt succeeds or is cancelled.</p></div>{releasableLines.map((line) => { const remaining = Number(line.committedQuantity ?? line.committed_quantity ?? 0) - Number(line.releasedQuantity ?? line.released_quantity ?? 0); return <div key={rowId(line)} className="grid grid-cols-[1fr_9rem] items-center gap-2"><Label htmlFor={`release-${rowId(line)}`}>{productNames.get(String(line.productId ?? line.product_id ?? "")) ?? "Unavailable product"} <span className="text-muted-foreground">({remaining.toLocaleString()} remaining)</span></Label><Input id={`release-${rowId(line)}`} type="number" min={QUANTITY_TOLERANCE} max={remaining + QUANTITY_TOLERANCE} step="any" value={releaseQuantities[rowId(line)] ?? ""} onChange={(event) => setReleaseQuantities((quantities) => ({ ...quantities, [rowId(line)]: event.target.value }))} /></div> })}<div className="grid gap-2 md:grid-cols-2"><Input aria-label="Release notes" placeholder="Notes (optional)" value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} /><Input aria-label="Planned date" type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></div>{releaseError ? <p className="text-sm text-destructive" role="alert">{releaseError}</p> : null}<div className="flex gap-2"><Button disabled={releasePending} onClick={() => void submitRelease()}>{releasePending ? "Releasing…" : "Release to purchase order"}</Button><Button type="button" variant="outline" disabled={releasePending} onClick={closeRelease}>Cancel</Button></div></div> : null}
            <div><h4 className="mb-2 text-sm font-medium">Release history</h4>{selectedReleases.length === 0 ? <p className="text-sm text-muted-foreground">No purchase orders have been released from this blanket.</p> : <div className="space-y-2">{selectedReleases.map((release) => { const poId = String(release.purchaseOrderId ?? release.purchase_order_id ?? ""); return <div key={rowId(release)} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"><span>PO #{poId || "—"} · {dateValue(release.createDate ?? release.create_date)}</span><Button size="sm" variant="outline" disabled={!poId} onClick={() => onOpenPurchaseOrder(poId)}>Open PO #{poId}</Button></div> })}</div>}</div>
          </>}
        </div>
      </div>
    </section>
  )
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{text}</Label>{children}</div>
}

function NativeSelect({ value, onChange, placeholder, options, kind }: { value: string; onChange: (value: string) => void; placeholder: string; options: Row[]; kind: "vendor" | "currency" }) {
  return <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}><option value="">{placeholder}</option>{options.map((option) => <option key={rowId(option)} value={rowId(option)}>{label(option, kind)}</option>)}</select>
}

function DraftLineEditor({ line, index, products, uoms, onProductChange, onChange, onRemove, canRemove }: { line: DraftLine; index: number; products: Row[]; uoms: Row[]; onProductChange: (value: string) => void; onChange: (update: Partial<DraftLine>) => void; onRemove: () => void; canRemove: boolean }) {
  return <div className="grid gap-2 rounded border p-3 md:grid-cols-[1.5fr_1fr_0.7fr_0.7fr_auto]"><select aria-label={`Product for line ${index + 1}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.productId} onChange={(event) => onProductChange(event.target.value)}><option value="">Select active purchasable product</option>{products.map((product) => <option key={rowId(product)} value={rowId(product)}>{label(product, "product")}</option>)}</select><select aria-label={`UoM for line ${index + 1}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={!line.productId || uoms.length === 0} value={line.productUom} onChange={(event) => onChange({ productUom: event.target.value })}><option value="">Select compatible UoM</option>{uoms.map((uom) => <option key={rowId(uom)} value={rowId(uom)}>{label(uom, "uom")}</option>)}</select><Input aria-label={`Committed quantity for line ${index + 1}`} type="number" min={QUANTITY_TOLERANCE} step="any" placeholder="Quantity" value={line.committedQuantity} onChange={(event) => onChange({ committedQuantity: event.target.value })} /><Input aria-label={`Unit price for line ${index + 1}`} type="number" min="0" step="any" placeholder="Unit price" value={line.priceUnit} onChange={(event) => onChange({ priceUnit: event.target.value })} /><Button type="button" size="sm" variant="ghost" disabled={!canRemove} onClick={onRemove}>Remove</Button></div>
}

function AuthoritativeLine({ line, product, uom, uomById }: { line: Row; product?: Row; uom?: Row; uomById: Map<string, Row> }) {
  const remaining = Number(line.committedQuantity ?? line.committed_quantity ?? 0) - Number(line.releasedQuantity ?? line.released_quantity ?? 0)
  const unavailable = !purchasableProduct(product ?? {}) || !compatiblePurchaseUom(product ?? {}, uom ?? {}, uomById)
  return <div className="grid grid-cols-[1fr_auto] gap-2 rounded border p-2 text-sm"><span>{unavailable ? "Unavailable product or UoM — not releasable" : `${label(product!, "product")} · ${label(uom!, "uom")}`}</span><span>{remaining.toLocaleString()} remaining @ {Number(line.priceUnit ?? line.price_unit ?? 0).toLocaleString()}</span></div>
}
