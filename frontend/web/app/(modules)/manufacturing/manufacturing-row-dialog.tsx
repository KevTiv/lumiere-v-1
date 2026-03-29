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

export function ManufacturingRowDialog({
  open,
  onOpenChange,
  tabId,
  row,
  workcenters,
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
      })
    }
    return null
  }, [row, entity, id, state, t, workcenterOptions])

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
