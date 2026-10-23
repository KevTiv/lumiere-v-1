"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "@lumiere/i18n"
import { Button, Input, Label, type EntityRow } from "@lumiere/ui"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import {
  buildPurchasingConfigurationSubmission,
  initialPurchasingConfigurationValues,
  type PurchasingConfigurationKind,
  type PurchasingConfigurationSubmission,
  type PurchasingConfigurationValues,
} from "./purchasing-configuration"

/** Radix Select cannot use "" as an item value; stands in for an unset optional reference. */
const NONE_VALUE = "__none__"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DatePicker } from "@lumiere/ui/components/date-picker"

type Row = EntityRow

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

const KIND_LABEL_KEYS: Record<PurchasingConfigurationKind, { key: string; defaultValue: string }> = {
  contract: { key: "purchasing.configuration.kinds.contract", defaultValue: "Purchase contract" },
  scorecard: { key: "purchasing.configuration.kinds.scorecard", defaultValue: "Vendor scorecard" },
  riskFlag: { key: "purchasing.configuration.kinds.riskFlag", defaultValue: "Vendor risk flag" },
  approvalDelegate: { key: "purchasing.configuration.kinds.approvalDelegate", defaultValue: "Approval delegate" },
  commodityIndex: { key: "purchasing.configuration.kinds.commodityIndex", defaultValue: "Commodity price index" },
  consignment: { key: "purchasing.configuration.kinds.consignment", defaultValue: "Consignment agreement" },
  integrationIntent: { key: "purchasing.configuration.kinds.integrationIntent", defaultValue: "Integration intent" },
}

function kindLabel(kind: PurchasingConfigurationKind, t: TFunction): string {
  const { key, defaultValue } = KIND_LABEL_KEYS[kind]
  return t(key, { defaultValue })
}

function rowId(row: Row) {
  return String(row.id ?? "")
}

function rowLabel(row: Row, fallback: string) {
  return String(
    row.displayName ?? row.display_name ?? row.name ?? row.code ?? `${fallback} ${rowId(row)}`,
  )
}

function dateTimestamp(value: string | null, t: TFunction, endOfDay = false): unknown | null {
  if (!value) return null
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`)
  if (Number.isNaN(date.getTime())) throw new Error(t("purchasing.configuration.errors.validDate", { defaultValue: "Enter a valid date" }))
  return stbTimestampFromDate(date)
}

function SelectField({
  id,
  label,
  value,
  rows,
  fallback,
  optional = false,
  t,
  onChange,
}: {
  id: string
  label: string
  value: string
  rows: Row[]
  fallback: string
  optional?: boolean
  t: TFunction
  onChange: (value: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          inputMode="numeric"
          placeholder={optional ? t("purchasing.configuration.placeholders.optionalRecordId", { defaultValue: "Optional record id" }) : t("purchasing.configuration.placeholders.recordId", { defaultValue: "{{label}} id", label })}
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
      <Select
        value={optional && value === "" ? NONE_VALUE : value}
        onValueChange={(next) => onChange(next === NONE_VALUE ? "" : next)}
        required={!optional}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={t("purchasing.configuration.placeholders.select", { defaultValue: "Select {{label}}", label: label.toLowerCase() })} />
        </SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value={NONE_VALUE}>{t("purchasing.configuration.none", { defaultValue: "None" })}</SelectItem> : null}
          {rows.map((row) => (
            <SelectItem key={rowId(row)} value={rowId(row)}>
              {rowLabel(row, fallback)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  const { t } = useTranslation()
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
            dateStart: dateTimestamp(submission.params.dateStart, t),
            dateEnd: dateTimestamp(submission.params.dateEnd, t, true),
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
      setNotice(t("purchasing.configuration.saved", { defaultValue: "{{kind}} saved", kind: kindLabel(kind, t) }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("purchasing.configuration.errors.save", { defaultValue: "Unable to save configuration" }))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={embedded ? "space-y-4" : "rounded-xl border bg-card p-5 shadow-sm"}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t("purchasing.configuration.title", { defaultValue: "Purchasing configuration" })}</h2>
        <p className="text-muted-foreground text-sm">
          {t("purchasing.configuration.description", { defaultValue: "Maintain vendor controls, sourcing settings, and integration requests." })}
        </p>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="purchasing-configuration-kind">{t("purchasing.configuration.fields.type", { defaultValue: "Configuration type" })}</Label>
          <Select value={kind} onValueChange={(value) => switchKind(value as PurchasingConfigurationKind)}>
            <SelectTrigger id="purchasing-configuration-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL_KEYS) as PurchasingConfigurationKind[]).map((value) => (
                <SelectItem key={value} value={value}>{kindLabel(value, t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(kind === "contract" || kind === "consignment") ? (
          <div className="space-y-1.5">
            <Label htmlFor="purchasing-configuration-name">
              {kind === "contract" ? t("purchasing.configuration.fields.contractName", { defaultValue: "Contract name" }) : t("purchasing.configuration.fields.agreementName", { defaultValue: "Agreement name" })}
            </Label>
            <Input id="purchasing-configuration-name" value={String(values.name ?? "")} onChange={(event) => setValue("name", event.target.value)} required />
          </div>
        ) : null}

        {kind === "contract" || kind === "scorecard" || kind === "riskFlag" || kind === "consignment" ? (
          <SelectField id="purchasing-configuration-vendor" label={t("purchasing.configuration.fields.vendor", { defaultValue: "Vendor" })} value={String(values.partnerId ?? "")} rows={selectableVendors} fallback={t("purchasing.configuration.fields.vendor", { defaultValue: "Vendor" })} onChange={(value) => setValue("partnerId", value)} t={t} />
        ) : null}

        {kind === "contract" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="purchasing-contract-start">{t("purchasing.configuration.fields.startDate", { defaultValue: "Start date" })}</Label><DatePicker id="purchasing-contract-start" value={String(values.dateStart ?? "")} onChange={(value) => setValue("dateStart", value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-contract-end">{t("purchasing.configuration.fields.endDate", { defaultValue: "End date" })}</Label><DatePicker id="purchasing-contract-end" value={String(values.dateEnd ?? "")} onChange={(value) => setValue("dateEnd", value)} /></div>
          </div>
        ) : null}

        {kind === "scorecard" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="purchasing-score-otif">{t("purchasing.configuration.fields.otifScore", { defaultValue: "OTIF score" })}</Label><Input id="purchasing-score-otif" type="number" min="0" max="100" step="0.01" value={String(values.otifScore ?? "")} onChange={(event) => setValue("otifScore", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-score-quality">{t("purchasing.configuration.fields.qualityScore", { defaultValue: "Quality score" })}</Label><Input id="purchasing-score-quality" type="number" min="0" max="100" step="0.01" value={String(values.qualityScore ?? "")} onChange={(event) => setValue("qualityScore", event.target.value)} required /></div>
          </div>
        ) : null}

        {kind === "riskFlag" ? (
          <>
            <div className="space-y-1.5"><Label htmlFor="purchasing-risk-level">{t("purchasing.configuration.fields.riskLevel", { defaultValue: "Risk level" })}</Label><Select value={String(values.riskLevel ?? "medium")} onValueChange={(value) => setValue("riskLevel", value)}><SelectTrigger id="purchasing-risk-level"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">{t("purchasing.configuration.risk.low", { defaultValue: "Low" })}</SelectItem><SelectItem value="medium">{t("purchasing.configuration.risk.medium", { defaultValue: "Medium" })}</SelectItem><SelectItem value="high">{t("purchasing.configuration.risk.high", { defaultValue: "High" })}</SelectItem><SelectItem value="critical">{t("purchasing.configuration.risk.critical", { defaultValue: "Critical" })}</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-risk-reason">{t("purchasing.configuration.fields.reason", { defaultValue: "Reason" })}</Label><Input id="purchasing-risk-reason" value={String(values.reason ?? "")} onChange={(event) => setValue("reason", event.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.isFlagged === true} onChange={(event) => setValue("isFlagged", event.target.checked)} /> {t("purchasing.configuration.fields.vendorFlagged", { defaultValue: "Vendor is flagged" })}</label>
          </>
        ) : null}

        {kind === "approvalDelegate" ? (
          <>
            <div className="space-y-1.5"><Label htmlFor="purchasing-principal">{t("purchasing.configuration.fields.principalIdentity", { defaultValue: "Principal identity" })}</Label><Input id="purchasing-principal" value={String(values.principalIdentity ?? "")} onChange={(event) => setValue("principalIdentity", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-delegate">{t("purchasing.configuration.fields.delegateIdentity", { defaultValue: "Delegate identity" })}</Label><Input id="purchasing-delegate" value={String(values.delegateIdentity ?? "")} onChange={(event) => setValue("delegateIdentity", event.target.value)} required /></div>
            {values.isActive === true ? <>
              <div className="space-y-1.5"><Label htmlFor="purchasing-delegation-start">{t("purchasing.configuration.fields.delegationStarts", { defaultValue: "Starts" })}</Label><Input id="purchasing-delegation-start" type="datetime-local" value={String(values.validFrom ?? "")} onChange={(event) => setValue("validFrom", event.target.value)} required /></div>
              <div className="space-y-1.5"><Label htmlFor="purchasing-delegation-end">{t("purchasing.configuration.fields.delegationEnds", { defaultValue: "Ends" })}</Label><Input id="purchasing-delegation-end" type="datetime-local" value={String(values.validUntil ?? "")} onChange={(event) => setValue("validUntil", event.target.value)} required /></div>
              <div className="space-y-1.5"><Label htmlFor="purchasing-delegation-reason">{t("purchasing.configuration.fields.delegationReason", { defaultValue: "Reason" })}</Label><Input id="purchasing-delegation-reason" value={String(values.reason ?? "")} onChange={(event) => setValue("reason", event.target.value)} required /></div>
            </> : null}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.isActive === true} onChange={(event) => setValue("isActive", event.target.checked)} /> {t("purchasing.configuration.fields.delegationActive", { defaultValue: "Delegation is active" })}</label>
          </>
        ) : null}

        {kind === "commodityIndex" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="purchasing-commodity-code">{t("purchasing.configuration.fields.commodityCode", { defaultValue: "Commodity code" })}</Label><Input id="purchasing-commodity-code" value={String(values.code ?? "")} onChange={(event) => setValue("code", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-commodity-rate">{t("purchasing.configuration.fields.rate", { defaultValue: "Rate" })}</Label><Input id="purchasing-commodity-rate" type="number" step="any" value={String(values.rate ?? "")} onChange={(event) => setValue("rate", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-commodity-date">{t("purchasing.configuration.fields.asOfDate", { defaultValue: "As-of date" })}</Label><DatePicker id="purchasing-commodity-date" value={String(values.asOf ?? "")} onChange={(value) => setValue("asOf", value)} required /></div>
          </div>
        ) : null}

        {kind === "consignment" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField id="purchasing-consignment-product" label={t("purchasing.configuration.fields.product", { defaultValue: "Product" })} value={String(values.productId ?? "")} rows={selectableProducts} fallback={t("purchasing.configuration.fields.product", { defaultValue: "Product" })} onChange={(value) => setValue("productId", value)} t={t} />
            <SelectField id="purchasing-consignment-warehouse" label={t("purchasing.configuration.fields.warehouse", { defaultValue: "Warehouse" })} value={String(values.warehouseId ?? "")} rows={selectableWarehouses} fallback={t("purchasing.configuration.fields.warehouse", { defaultValue: "Warehouse" })} onChange={(value) => setValue("warehouseId", value)} t={t} />
          </div>
        ) : null}

        {kind === "integrationIntent" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="purchasing-intent-provider">{t("purchasing.configuration.fields.provider", { defaultValue: "Provider" })}</Label><Input id="purchasing-intent-provider" value={String(values.provider ?? "")} onChange={(event) => setValue("provider", event.target.value)} required /></div>
              <div className="space-y-1.5"><Label htmlFor="purchasing-intent-type">{t("purchasing.configuration.fields.intentType", { defaultValue: "Intent type" })}</Label><Input id="purchasing-intent-type" value={String(values.intentType ?? "")} onChange={(event) => setValue("intentType", event.target.value)} required /></div>
            </div>
            <SelectField id="purchasing-intent-order" label={t("purchasing.configuration.fields.purchaseOrder", { defaultValue: "Purchase order" })} value={String(values.purchaseOrderId ?? "")} rows={purchaseOrders} fallback={t("purchasing.configuration.fields.purchaseOrder", { defaultValue: "Purchase order" })} optional onChange={(value) => setValue("purchaseOrderId", value)} t={t} />
            <div className="space-y-1.5"><Label htmlFor="purchasing-intent-key">{t("purchasing.configuration.fields.idempotencyKey", { defaultValue: "Idempotency key" })}</Label><Input id="purchasing-intent-key" value={String(values.idempotencyKey ?? "")} onChange={(event) => setValue("idempotencyKey", event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="purchasing-intent-payload">{t("purchasing.configuration.fields.requestPayload", { defaultValue: "Request payload" })}</Label><textarea id="purchasing-intent-payload" className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm" value={String(values.requestPayload ?? "")} onChange={(event) => setValue("requestPayload", event.target.value)} /></div>
          </>
        ) : null}

        {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-emerald-600">{notice}</p> : null}
        <Button type="submit" disabled={pending}>{pending ? t("purchasing.configuration.actions.saving", { defaultValue: "Saving…" }) : t("purchasing.configuration.actions.save", { defaultValue: "Save {{kind}}", kind: kindLabel(kind, t).toLowerCase() })}</Button>
      </form>
    </section>
  )
}
