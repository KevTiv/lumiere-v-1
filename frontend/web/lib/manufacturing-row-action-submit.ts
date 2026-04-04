import type { ManufacturingMutations } from "@/hooks/manufacturing"

function num(v: unknown, fallback = 0): number {
  if (v === "" || v === null || v === undefined) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function trimOpt(v: unknown): string | undefined {
  const s = String(v ?? "").trim()
  return s === "" ? undefined : s
}

function parseU64List(raw: unknown): number[] {
  const str = String(raw ?? "").trim()
  if (!str) return []
  const out: number[] = []
  for (const p of str.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const n = Number(p)
    if (Number.isFinite(n) && n >= 0) out.push(Math.floor(n))
  }
  return out
}

function idFrom(values: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = values[k]
    if (v != null && String(v) !== "") return String(v)
  }
  return ""
}

export async function submitManufacturingRowAction(
  tabId: string,
  values: Record<string, unknown>,
  m: ManufacturingMutations,
): Promise<void> {
  if (tabId === "orders") {
    const moId = idFrom(values, ["moRecordId"])
    const action = String(values.moAction ?? "")
    switch (action) {
      case "check_availability":
        await m.checkMoAvailability.mutateAsync(moId)
        return
      case "confirm":
        await m.confirmMo.mutateAsync(moId)
        return
      case "start":
        await m.startMo.mutateAsync(moId)
        return
      case "produce":
        await m.produceMo.mutateAsync({ moId, qty: num(values.produceQty, 0) || 0.0001 })
        return
      case "consume":
        await m.consumeMoMaterials.mutateAsync(moId)
        return
      case "finish":
        await m.finishMo.mutateAsync(moId)
        return
      case "cancel":
        await m.cancelMo.mutateAsync(moId)
        return
      case "create_workorder": {
        const wc = String(values.woWorkcenterId ?? "")
        if (!wc) throw new Error("Select a work center")
        await m.createWorkorder.mutateAsync({
          workcenterId: Number(wc),
          productionId: Number(moId),
          durationExpected: num(values.woDuration, 0),
          name: String(values.woName ?? "Operation"),
          sequence: num(values.woSequence, 1) || 1,
          state: { Ready: [] },
          productionAvailability: "available",
          isUserWorking: false,
          isProduced: false,
          isLastUnfinishedWo: false,
          qualityCheckTodo: false,
          qualityCheckFail: false,
        })
        return
      }
      default:
        throw new Error("Unknown action")
    }
  }

  if (tabId === "boms") {
    const bomId = idFrom(values, ["bomRecordId"])
    const action = String(values.bomAction ?? "")
    switch (action) {
      case "update_qty": {
        const pq = num(values.bomProductQty, NaN)
        await m.updateBom.mutateAsync({
          bomId,
          params: { productQty: Number.isFinite(pq) ? pq : undefined },
        })
        return
      }
      case "compute_cost":
        await m.computeBomCost.mutateAsync(bomId)
        return
      case "explode":
        await m.explodeBom.mutateAsync(bomId)
        return
      case "delete":
        if (values.bomDeleteConfirmed !== true) {
          throw new Error("Confirm deletion before deleting this BOM")
        }
        await m.deleteBom.mutateAsync(bomId)
        return
      default:
        throw new Error("Unknown action")
    }
  }

  if (tabId === "workorders") {
    const woId = idFrom(values, ["woRecordId"])
    const action = String(values.woAction ?? "")
    if (action === "_none") throw new Error("No action available for this work order")
    if (action === "start") {
      await m.startWo.mutateAsync(woId)
      return
    }
    if (action === "finish") {
      await m.finishWo.mutateAsync(woId)
      return
    }
    throw new Error("Unknown action")
  }

  if (tabId === "workcenters") {
    const wcId = idFrom(values, ["wcRecordId"])
    const action = String(values.wcAction ?? "")
    switch (action) {
      case "save_name":
        await m.updateWorkcenter.mutateAsync({
          workcenterId: wcId,
          params: { name: String(values.wcName ?? "") },
        })
        return
      case "block":
        await m.blockWc.mutateAsync({
          workcenterId: wcId,
          reason: String(values.blockReason ?? "—"),
        })
        return
      case "unblock":
        await m.unblockWc.mutateAsync(wcId)
        return
      case "log_productivity": {
        const woid = String(values.logWorkorderId ?? "")
        if (!woid) throw new Error("Work order ID is required")
        await m.logProductivity.mutateAsync({
          workcenterId: wcId,
          params: {
            workorderId: Number(woid),
            lossId: num(values.logLossId, 0),
            duration: num(values.logDuration, 0),
          },
        })
        return
      }
      case "create_routing": {
        const name = String(values.routingOpName ?? "").trim()
        if (!name) throw new Error("Operation name is required")
        await m.createRoutingWorkcenter.mutateAsync({
          workcenterId: Number(wcId),
          name,
          worksheetType: String(values.routingWorksheetType ?? "text"),
          timeMode: String(values.routingTimeMode ?? "manual"),
          timeModeBatch: num(values.routingTimeModeBatch, 1) || 1,
          timeCycleManual: num(values.routingTimeCycleManual, 0),
          timeCycle: num(values.routingTimeCycle, 60),
          sequence: num(values.routingSequence, 10) || 1,
          worksheet: trimOpt(values.routingWorksheetBody),
          worksheetGoogleSlide: undefined,
          worksheetUrl: trimOpt(values.routingWorksheetUrl),
          blockedByOperationIds: parseU64List(values.routingBlockedByIds),
          metadata: undefined,
        })
        return
      }
      case "complete_productivity_log": {
        const logId = num(values.completeLogId, NaN)
        if (!Number.isFinite(logId)) throw new Error("Productivity log ID is required")
        await m.completeProductivityLog.mutateAsync(logId)
        return
      }
      case "link_iot_device": {
        const devId = String(values.linkDeviceId ?? "")
        if (!devId) throw new Error("Select an IoT device")
        await m.linkDeviceToWorkcenter.mutateAsync({
          deviceId: devId,
          workcenterId: wcId,
        })
        return
      }
      default:
        throw new Error("Unknown action")
    }
  }

  throw new Error("Unknown tab")
}
