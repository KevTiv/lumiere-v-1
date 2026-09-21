"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button, Input, Label } from "@lumiere/ui"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import {
  buildPurchasingConfigurationSubmission,
  initialPurchasingConfigurationValues,
  type PurchasingConfigurationKind,
  type PurchasingConfigurationSubmission,
  type PurchasingConfigurationValues,
} from "./purchasing-configuration"

type Row = Record<string, unknown>

export interface PurchasingConfigurationWorkspaceProps {
  vendors: Row[]
  products: Row[]
  warehouses?: Row[]
  purchaseOrders?: Row[]
  actionRequest?: { kind: PurchasingConfigurationKind; token: number } | null
  embedded?: boolean
  onCreateContract: (
    params: Omit<Extract<PurchasingConfigurationSubmission, { kind: "contract" }>["params"], "dateStart" | "dateEnd"> & {
      dateStart: unknown | null
      dateEnd: unknown | null
    },
  ) => Promise<void>
  onUpsertScorecard: (
    params: Extract<PurchasingConfigurationSubmission, { kind: "scorecard" }>["params"],
  ) => Promise<void>
  onSetRiskFlag: (
    params: Extract<PurchasingConfigurationSubmission, { kind: "riskFlag" }>["params"],
  ) => Promise<void>
  onSetApprovalDelegate: (
    params: Extract<PurchasingConfigurationSubmission, { kind: "approvalDelegate" }>["params"],
  ) => Promise<void>
  onSetCommodityIndex: (
    params: Extract<PurchasingConfigurationSubmission, { kind: "commodityIndex" }>["params"],
  ) => Promise<void>
  onCreateConsignment: (
    params: Extract<PurchasingConfigurationSubmission, { kind: "consignment" }>["params"],
  ) => Promise<void>
  onCreateIntegrationIntent: (
    params: Extract<PurchasingConfigurationSubmission, { kind: "integrationIntent" }>["params"],
  ) => Promise<void>
}

const KIND_LABELS: Record<PurchasingConfigurationKind, string> = {
  contract: "Purchase contract",
  scorecard: "Vendor scorecard",
  riskFlag: "Vendor risk flag",
  approvalDelegate: "Approval delegate",
  commodityIndex: "Commodity price index",
  consignment: "Consignment agreement",
  integrationIntent: "Integration intent",
}

function rowId(row: Row) {
  return String(row.id ?? "")
}

function rowLabel(row: Row, fallback: string) {
  return String(
    row.displayName ?? row.display_name ?? row.name ?? row.code ?? `${fallback} ${rowId(row)}`,
  )
}

function dateTimestamp(value: string | null, endOfDay = false): unknown | null {
  if (!value) return null
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`)
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date")
  return stbTimestampFromDate(date)
}

function SelectField({
  id,
  label,
  value,
  rows,
  fallback,
  optional = false,
  onChange,
}: {
  id: string
  label: string
  value: string
  rows: Row[]
  fallback: string
  optional?: boolean
  onChange: (value: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          inputMode="numeric"
          placeholder={optional ? "Optional record id" : `${label} id`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={!optional}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={!optional}
      >
        <option value="">{optional ? "None" : `Select ${label.toLowerCase()}`}</option>
        {rows.map((row) => (
          <option key={rowId(row)} value={rowId(row)}>
            {rowLabel(row, fallback)}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Real form surface for purchasing configuration writes and one-off setup records. */
export function PurchasingConfigurationWorkspace({
  vendors,
  products,
  warehouses = [],
  purchaseOrders = [],
  actionRequest,
  embedded = false,
  onCreateContract,
  onUpsertScorecard,
  onSetRiskFlag,
  onSetApprovalDelegate,
  onSetCommodityIndex,
  onCreateConsignment,
  onCreateIntegrationIntent,
}: PurchasingConfigurationWorkspaceProps) {
  const [kind, setKind] = useState<PurchasingConfigurationKind>("scorecard")
  const [values, setValues] = useState<PurchasingConfigurationValues>(() =>
    initialPurchasingConfigurationValues("scorecard"),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const handledActionToken = useRef(0)

  const selectableVendors = useMemo(
    () =>
      vendors.filter(
        (row) =>
          row.active !== false &&
          row.deletedAt == null &&
          row.deleted_at == null &&
          (row.isVendor === true ||
            row.is_vendor === true ||
            Number(row.supplierRank ?? row.supplier_rank ?? 0) > 0),
      ),
    [vendors],
  )
  const selectableProducts = useMemo(
    () => products.filter((row) => row.active !== false && (row.purchaseOk === true || row.purchase_ok === true)),
    [products],
  )
  const selectableWarehouses = useMemo(
    () => warehouses.filter((row) => row.active !== false),
    [warehouses],
  )

  useEffect(() => {
    if (!actionRequest || actionRequest.token === handledActionToken.current) return
    handledActionToken.current = actionRequest.token
    setKind(actionRequest.kind)
    setValues(initialPurchasingConfigurationValues(actionRequest.kind))
    setError(null)
    setNotice(null)
  }, [actionRequest])

  const setValue = (key: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const switchKind = (next: PurchasingConfigurationKind) => {
    setKind(next)
    setValues(initialPurchasingConfigurationValues(next))
    setError(null)
    setNotice(null)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const submission = buildPurchasingConfigurationSubmission(kind, values)
      switch (submission.kind) {
        case "contract":
          await onCreateContract({
            ...submission.params,
            dateStart: dateTimestamp(submission.params.dateStart),
            dateEnd: dateTimestamp(submission.params.dateEnd, true),
          })
          break
        case "scorecard":
          await onUpsertScorecard(submission.params)
          break
        case "riskFlag":
          await onSetRiskFlag(submission.params)
          break
        case "approvalDelegate":
          await onSetApprovalDelegate(submission.params)
          break
        case "commodityIndex":
          await onSetCommodityIndex(submission.params)
          break
        case "consignment":
          await onCreateConsignment(submission.params)
          break
        case "integrationIntent":
          await onCreateIntegrationIntent(submission.params)
          break
      }
      setValues(initialPurchasingConfigurationValues(kind))
      setNotice(`${KIND_LABELS[kind]} saved`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save configuration")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={embedded ? "space-y-4" : "rounded-xl border bg-card p-5 shadow-sm"}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Purchasing configuration</h2>
        <p className="text-muted-foreground text-sm">
          Maintain vendor controls, sourcing settings, and integration requests.
        </p>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="purchasing-configuration-kind">Configuration type</Label>
          <select
            id="purchasing-configuration-kind"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            value={kind}
            onChange={(event) => switchKind(event.target.value as PurchasingConfigurationKind)}
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {(kind === "contract" || kind === "consignment") ? (
          <div className="space-y-1.5">
            <Label htmlFor="purchasing-configuration-name">
              {kind === "contract" ? "Contract name" : "Agreement name"}
            </Label>
            <Input id="purchasing-configuration-name" value={String(values.name ?? "")} onChange={(event) => setValue("name", event.target.value)} required />
          </div>
        ) : null}

        {kind === "contract" || kind === "scorecard" || kind === "riskFlag" || kind === "consignment" ? (
          <SelectField id="purchasing-configuration-vendor" label="Vendor" value={String(values.partnerId ?? "")} rows={selectableVendors} fallback="Vendor" onChange={(value) => setValue("partnerId", value)} />
        ) : null}

        {kind === "contract" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="purchasing-contract-start">Start date</Label><Input id="purchasing-contract-start" type="date" value={String(values.dateStart ?? "")} onChange={(event) => setValue("dateStart", event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-contract-end">End date</Label><Input id="purchasing-contract-end" type="date" value={String(values.dateEnd ?? "")} onChange={(event) => setValue("dateEnd", event.target.value)} /></div>
          </div>
        ) : null}

        {kind === "scorecard" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="purchasing-score-otif">OTIF score</Label><Input id="purchasing-score-otif" type="number" min="0" max="100" step="0.01" value={String(values.otifScore ?? "")} onChange={(event) => setValue("otifScore", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-score-quality">Quality score</Label><Input id="purchasing-score-quality" type="number" min="0" max="100" step="0.01" value={String(values.qualityScore ?? "")} onChange={(event) => setValue("qualityScore", event.target.value)} required /></div>
          </div>
        ) : null}

        {kind === "riskFlag" ? (
          <>
            <div className="space-y-1.5"><Label htmlFor="purchasing-risk-level">Risk level</Label><select id="purchasing-risk-level" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={String(values.riskLevel ?? "medium")} onChange={(event) => setValue("riskLevel", event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-risk-reason">Reason</Label><Input id="purchasing-risk-reason" value={String(values.reason ?? "")} onChange={(event) => setValue("reason", event.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.isFlagged === true} onChange={(event) => setValue("isFlagged", event.target.checked)} /> Vendor is flagged</label>
          </>
        ) : null}

        {kind === "approvalDelegate" ? (
          <>
            <div className="space-y-1.5"><Label htmlFor="purchasing-principal">Principal identity</Label><Input id="purchasing-principal" value={String(values.principalIdentity ?? "")} onChange={(event) => setValue("principalIdentity", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-delegate">Delegate identity</Label><Input id="purchasing-delegate" value={String(values.delegateIdentity ?? "")} onChange={(event) => setValue("delegateIdentity", event.target.value)} required /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.isActive === true} onChange={(event) => setValue("isActive", event.target.checked)} /> Delegation is active</label>
          </>
        ) : null}

        {kind === "commodityIndex" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="purchasing-commodity-code">Commodity code</Label><Input id="purchasing-commodity-code" value={String(values.code ?? "")} onChange={(event) => setValue("code", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-commodity-rate">Rate</Label><Input id="purchasing-commodity-rate" type="number" step="any" value={String(values.rate ?? "")} onChange={(event) => setValue("rate", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-commodity-date">As-of date</Label><Input id="purchasing-commodity-date" type="date" value={String(values.asOf ?? "")} onChange={(event) => setValue("asOf", event.target.value)} required /></div>
          </div>
        ) : null}

        {kind === "consignment" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField id="purchasing-consignment-product" label="Product" value={String(values.productId ?? "")} rows={selectableProducts} fallback="Product" onChange={(value) => setValue("productId", value)} />
            <SelectField id="purchasing-consignment-warehouse" label="Warehouse" value={String(values.warehouseId ?? "")} rows={selectableWarehouses} fallback="Warehouse" onChange={(value) => setValue("warehouseId", value)} />
          </div>
        ) : null}

        {kind === "integrationIntent" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="purchasing-intent-provider">Provider</Label><Input id="purchasing-intent-provider" value={String(values.provider ?? "")} onChange={(event) => setValue("provider", event.target.value)} required /></div>
              <div className="space-y-1.5"><Label htmlFor="purchasing-intent-type">Intent type</Label><Input id="purchasing-intent-type" value={String(values.intentType ?? "")} onChange={(event) => setValue("intentType", event.target.value)} required /></div>
            </div>
            <SelectField id="purchasing-intent-order" label="Purchase order" value={String(values.purchaseOrderId ?? "")} rows={purchaseOrders} fallback="Purchase order" optional onChange={(value) => setValue("purchaseOrderId", value)} />
            <div className="space-y-1.5"><Label htmlFor="purchasing-intent-key">Idempotency key</Label><Input id="purchasing-intent-key" value={String(values.idempotencyKey ?? "")} onChange={(event) => setValue("idempotencyKey", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-intent-payload">Request payload</Label><textarea id="purchasing-intent-payload" className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm" value={String(values.requestPayload ?? "")} onChange={(event) => setValue("requestPayload", event.target.value)} /></div>
          </>
        ) : null}

        {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-emerald-600">{notice}</p> : null}
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : `Save ${KIND_LABELS[kind].toLowerCase()}`}</Button>
      </form>
    </section>
  )
}
