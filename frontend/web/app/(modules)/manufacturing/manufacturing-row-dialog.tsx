"use client"

import { useEffect, useMemo, useState } from "react"
import type { TFunction } from "i18next"
import {
  FormModal,
  manufacturingOrderRowActionForm,
  manufacturingBomRowActionForm,
  manufacturingWorkorderRowActionForm,
  manufacturingWorkcenterRowActionForm,
} from "@lumiere/ui"
import type { ManufacturingMutations } from "@/hooks/manufacturing"
import type { QueryRows } from "@/lib/query-fetch"
import { submitManufacturingRowAction } from "@/lib/manufacturing-row-action-submit"

type TabEntity = "orders" | "boms" | "workorders" | "workcenters"

export interface ManufacturingRowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabId: string | null
  row: Record<string, unknown> | null
  workcenters: QueryRows
  iotDevices: QueryRows
  mutations: ManufacturingMutations
  t: TFunction
}

function rowId(row: Record<string, unknown>): string {
  const v = row.id
  return v != null ? String(v) : ""
}

function stateStr(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const keys = Object.keys(v as object)
    if (keys.length === 1) return keys[0] ?? ""
  }
  return String(v)
}

function workcenterIdOnDevice(d: Record<string, unknown>): string {
  const w = d.workcenterId ?? d.workcenter_id
  return w != null && String(w) !== "" ? String(w) : ""
}

export function ManufacturingRowDialog({
  open,
  onOpenChange,
  tabId,
  row,
  workcenters,
  iotDevices,
  mutations,
  t,
}: ManufacturingRowDialogProps) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const entity = tabId as TabEntity | null
  const id = row ? rowId(row) : ""
  const state = row ? stateStr(row.state) : ""

  useEffect(() => {
    if (open) setSubmitError(null)
  }, [open, tabId, id])

  const workcenterOptions = useMemo(
    () =>
      workcenters
        .map((w) => ({
          value: String(w.id ?? ""),
          label: String(w.name ?? w.code ?? `WC ${w.id}`),
        }))
        .filter((o) => o.value !== ""),
    [workcenters],
  )

  const iotDeviceOptions = useMemo(() => {
    const sorted = [...iotDevices].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
    )
    const opts = sorted
      .map((d) => {
        const id = d.id != null ? String(d.id) : ""
        const ident = String(d.identifier ?? id)
        const name = String(d.name ?? t("manufacturing.rowActions.iotDeviceUntitled"))
        return { value: id, label: ident ? `${name} (${ident})` : name }
      })
      .filter((o) => o.value !== "")
    if (opts.length > 0) return opts
    return [{ value: "", label: t("manufacturing.rowActions.noIotDevices"), disabled: true as const }]
  }, [iotDevices, t])

  const linkedDeviceIdForWc = useMemo(() => {
    if (!row || entity !== "workcenters") return ""
    const wid = rowId(row)
    const linked = iotDevices.find((d) => workcenterIdOnDevice(d as Record<string, unknown>) === wid)
    const lid = linked?.id
    return lid != null ? String(lid) : ""
  }, [row, entity, iotDevices])

  const formConfig = useMemo(() => {
    if (!row || !entity) return null
    if (entity === "orders") {
      const pq = row.productQty
      const qp = row.qtyProduced
      const defaultProduceQty =
        pq != null && qp != null
          ? Math.max(0.0001, Number(pq) - Number(qp) || 1)
          : 1
      return manufacturingOrderRowActionForm(t, {
        recordId: id,
        state,
        defaultProduceQty,
        workcenterOptions,
      })
    }
    if (entity === "boms") {
      return manufacturingBomRowActionForm(t, {
        recordId: id,
        defaultProductQty: Number(row.productQty ?? 1) || 1,
      })
    }
    if (entity === "workorders") {
      return manufacturingWorkorderRowActionForm(t, { recordId: id, state })
    }
    if (entity === "workcenters") {
      return manufacturingWorkcenterRowActionForm(t, {
        recordId: id,
        defaultName: String(row.name ?? ""),
        iotDeviceOptions,
        linkedDeviceId: linkedDeviceIdForWc || undefined,
      })
    }
    return null
  }, [row, entity, id, state, t, workcenterOptions, iotDeviceOptions, linkedDeviceIdForWc])

  if (!formConfig || !tabId) return null

  return (
    <FormModal
      key={`${tabId}-${id}-${open}`}
      open={open}
      onOpenChange={onOpenChange}
      config={formConfig}
      closeOnSubmit={false}
      submitError={submitError}
      onSubmit={async (data) => {
        setSubmitError(null)
        try {
          await submitManufacturingRowAction(tabId, data, mutations)
          onOpenChange(false)
        } catch (e) {
          setSubmitError(e instanceof Error ? e.message : String(e))
        }
      }}
    />
  )
}
