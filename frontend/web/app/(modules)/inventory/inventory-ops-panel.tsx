"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  useApplyWarehouseSyncIntent,
  useCreateWarehouseSyncIntent,
  useInventoryExceptionsExpiredLots,
  useInventoryExceptionsOpenQc,
  useInventoryExceptionsShortAtp,
  useRefreshInventoryExceptions,
  useResolveInventoryException,
  useWarehouseSyncIntentsPending,
} from "@lumiere/query-hooks/hooks/inventory"
import { Button, useRBAC } from "@lumiere/ui"
import { useTranslation } from "@lumiere/i18n"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import type { WarehouseSyncIntent } from "@lumiere/stdb/types"
import { identityToHex } from "@lumiere/ui/lib/identity-label"
import { CaptureSyncBadge } from "../../../components/capture/capture-sync-badge"
import { useBrowserOnline } from "@/hooks/use-browser-online"
import {
  getOrCreateDeviceId,
  listQueuedWarehouseOutbox,
  markWarehouseOutboxError,
  markWarehouseOutboxSynced,
} from "../../../lib/warehouse-sync-outbox"
import { TablePager, usePagedRows } from "@lumiere/ui/components/table-pager"

export type InventoryOpsQueueId = "short_atp" | "expired_lots" | "open_qc"

const QUEUE_IDS: InventoryOpsQueueId[] = [
  "short_atp",
  "expired_lots",
  "open_qc",
]

const QUEUE_LABELS: Record<InventoryOpsQueueId, string> = {
  short_atp: "Short ATP",
  expired_lots: "Expired lots",
  open_qc: "Open QC fails",
}

function rowId(row: Record<string, unknown>): string {
  return String(row.id ?? "")
}

export interface InventoryOpsPanelProps {
  activeQueue?: InventoryOpsQueueId
  onQueueChange?: (queue: InventoryOpsQueueId) => void
}

export function InventoryOpsPanel({
  activeQueue: controlledQueue,
  onQueueChange,
}: InventoryOpsPanelProps) {
  const { t } = useTranslation()
  const online = useBrowserOnline()
  const { organizationId, identity, activeCompanyReady } = useErpSession()
  const { checkPermission, permissionsReady } = useRBAC()
  const orgIdNum =
    organizationId != null && organizationId > 0 ? organizationId : 0
  const orgId = BigInt(orgIdNum)
  const operatingCompanyId = useOperatingCompanyBigInt(orgIdNum) ?? 0n
  const actorIdentity = activeCompanyReady !== false ? (identity ?? "") : ""
  const owner = { actorIdentity, companyId: String(operatingCompanyId) }
  const maySync = Boolean(
    actorIdentity &&
    orgId &&
    operatingCompanyId &&
    permissionsReady !== false &&
    checkPermission("stock_picking", "write").allowed,
  )
  const scope = JSON.stringify([
    String(orgId),
    owner.companyId,
    actorIdentity,
    maySync,
  ])
  const liveScope = useRef(scope)
  liveScope.current = scope
  useEffect(() => {
    liveScope.current = scope
    return () => {
      liveScope.current = ""
    }
  }, [scope])
  const ownsIntent = (row: WarehouseSyncIntent) =>
    Boolean(
      actorIdentity &&
      operatingCompanyId &&
      String(row.organizationId) === String(orgId) &&
      String(row.companyId) === owner.companyId &&
      identityToHex(row.createUid).replace(/^0x/, "") ===
        identityToHex(actorIdentity).replace(/^0x/, ""),
    )
  const [localQueue, setLocalQueue] = useState<InventoryOpsQueueId>("short_atp")
  const activeQueue = controlledQueue ?? localQueue
  const setQueue = (q: InventoryOpsQueueId) => {
    onQueueChange?.(q)
    if (controlledQueue == null) setLocalQueue(q)
  }

  const shortAtp = useInventoryExceptionsShortAtp(orgId)
  const expiredLots = useInventoryExceptionsExpiredLots(orgId)
  const openQc = useInventoryExceptionsOpenQc(orgId)
  const refresh = useRefreshInventoryExceptions(orgId, operatingCompanyId)
  const resolve = useResolveInventoryException(orgId, operatingCompanyId)
  const pendingSync = useWarehouseSyncIntentsPending(orgId)
  const createSync = useCreateWarehouseSyncIntent(orgId, operatingCompanyId)
  const applySync = useApplyWarehouseSyncIntent(orgId, operatingCompanyId)
  const [actionError, setActionError] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncingKey, setSyncingKey] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{
    scope: string
    count: number
  } | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const pendingRows = (pendingSync.data ?? []).filter(ownsIntent)
  useEffect(() => {
    try {
      setDeviceId(getOrCreateDeviceId())
    } catch {
      setActionError(
        t("captureSync.storageUnavailable", {
          defaultValue: "Recovery storage is unavailable on this device.",
        }),
      )
    }
  }, [t])
  const localQueued = deviceId
    ? listQueuedWarehouseOutbox(String(orgId), deviceId, owner)
    : []
  const retryable = localQueued.filter(
    (item) => item.syncState === "queued" || item.syncState === "error",
  )

  const rows = useMemo(
    () => {
    switch (activeQueue) {
      case "short_atp":
        return shortAtp.data ?? []
      case "expired_lots":
        return expiredLots.data ?? []
      case "open_qc":
        return openQc.data ?? []
    }
  }, [activeQueue, shortAtp.data, expiredLots.data, openQc.data])
  const pendingPager = usePagedRows(pendingRows)
  const rowsPager = usePagedRows(rows)

  const counts = {
    short_atp: shortAtp.data?.length ?? 0,
    expired_lots: expiredLots.data?.length ?? 0,
    open_qc: openQc.data?.length ?? 0,
  }

  const assertSyncScope = () => {
    if (!maySync || liveScope.current !== scope || !navigator.onLine) {
      throw new Error(
        t("captureSync.warehouseOffline", {
          defaultValue:
            "Reconnect and confirm your active company before syncing warehouse captures.",
        }),
      )
    }
  }
  const readIntents = () =>
    fetchQueryList(
      "/api/query/warehouse-sync-intents",
      t("captureSync.warehouseReadFailed", {
        defaultValue:
          "Warehouse sync could not be confirmed. Check its status again before creating a new capture.",
      }),
    )
  const readIntent = async (id: string) => {
    const rows = await readIntents()
    return rows.find((row) => rowId(row) === id && ownsIntent(row))
  }
  const applyIntent = async (intent: WarehouseSyncIntent) => {
    assertSyncScope()
    await applySync.mutateAsync(rowId(intent))
    const result = await readIntent(rowId(intent))
    if (
      !result ||
      (result.status !== "applied" && result.status !== "failed")
    ) {
      throw new Error(
        t("captureSync.warehouseReadFailed", {
          defaultValue:
            "Warehouse sync could not be confirmed. Check its status again before creating a new capture.",
        }),
      )
    }
    return result
  }

  const flushLocalOutbox = async () => {
    if (!deviceId || syncBusy) return
    setSyncBusy(true)
    setActionError(null)
    setSyncResult(null)
    let confirmed = 0
    try {
      for (const item of retryable) {
        assertSyncScope()
        setSyncingKey(item.idempotencyKey)
        const payload = JSON.stringify(item.payload)
        const findIntent = async () =>
          (await readIntents()).filter(
            (row) => row.idempotencyKey === item.idempotencyKey,
          )
        try {
          let matches = await findIntent()
          if (matches.length === 0) {
            assertSyncScope()
            await createSync.mutateAsync({
            warehouseId: BigInt(item.warehouseId),
            opType: item.opType,
            idempotencyKey: item.idempotencyKey,
            deviceId: item.deviceId,
            payload,
              metadata: undefined,
            })
            matches = await findIntent()
          }
          const intent = matches[0]
          if (
            matches.length > 1 ||
            (intent &&
              (!ownsIntent(intent) ||
                intent.deviceId !== item.deviceId ||
                String(intent.warehouseId) !== String(item.warehouseId) ||
                intent.opType !== item.opType ||
                intent.payload !== payload))
          ) {
            markWarehouseOutboxError(
              String(orgId),
              deviceId,
              item.idempotencyKey,
              owner,
              t("captureSync.warehouseConflict", {
                defaultValue:
                  "The saved sync request differs from this capture. Review the warehouse record before creating a new capture.",
              }),
              "conflict",
            )
            continue
          }
          if (!intent)
            throw new Error(
              t("captureSync.warehouseReadFailed", {
                defaultValue:
                  "Warehouse sync could not be confirmed. Check its status again before creating a new capture.",
              }),
            )
          const result =
            intent.status === "pending" ? await applyIntent(intent) : intent
          if (result.status === "failed") {
            markWarehouseOutboxError(
              String(orgId),
              deviceId,
              item.idempotencyKey,
              owner,
              result.lastError ??
                t("captureSync.warehouseRejected", {
                  defaultValue:
                    "The server rejected this capture. Review the warehouse record before creating a new capture.",
                }),
              "rejected",
            )
            continue
          }
          if (result.status !== "applied")
            throw new Error(
              t("captureSync.warehouseReadFailed", {
                defaultValue:
                  "Warehouse sync could not be confirmed. Check its status again before creating a new capture.",
              }),
            )
          markWarehouseOutboxSynced(
            String(orgId),
            deviceId,
            item.idempotencyKey,
            owner,
          )
          confirmed++
        } catch (error) {
          markWarehouseOutboxError(
            String(orgId),
            deviceId,
            item.idempotencyKey,
            owner,
            error instanceof Error ? error.message : String(error),
          )
        }
      }
      if (confirmed > 0) setSyncResult({ scope, count: confirmed })
    } catch (error) {
      if (liveScope.current === scope)
        setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncingKey(null)
      setSyncBusy(false)
      if (liveScope.current === scope) void pendingSync.refetch()
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4" data-testid="inventory-ops-panel">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {QUEUE_IDS.map((id) => (
              <Button
                key={id}
                type="button"
                variant={activeQueue === id ? "default" : "outline"}
                size="sm"
                data-testid={`inventory-ops-queue-${id}`}
                onClick={() => setQueue(id)}
              >
                {QUEUE_LABELS[id]} ({counts[id]})
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!operatingCompanyId || refresh.isPending}
            onClick={async () => {
              try {
                setActionError(null)
                await refresh.mutateAsync({ upsertOnly: false, metadata: undefined,
                })
              } catch (e) {
                setActionError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh queues"}
          </Button>
        </div>

        {actionError ? (
          <p className="text-sm text-destructive" role="alert">
            {actionError}
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Summary</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                    No open exceptions in this queue.
                  </td>
                </tr>
              ) : (
                rowsPager.pageRows.map((row) => {
                  const id = rowId(row)
                  return (
                    <tr key={id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {String(row.summary ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        {String(row.productId ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        {String(row.exceptionType ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!operatingCompanyId || resolve.isPending}
                          onClick={async () => {
                            try {
                              setActionError(null)
                              await resolve.mutateAsync(id)
                            } catch (e) {
                              if (liveScope.current === scope)
                                setActionError(
                                e instanceof Error ? e.message : String(e),
                              )
                            }
                          }}
                        >
                          Resolve
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          <TablePager {...rowsPager} />
        </div>
      </div>

      <div
        className="flex flex-col gap-3"
        data-testid="inventory-ops-warehouse-sync"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">
              {t("captureSync.warehouseTitle", {
                defaultValue: "Warehouse sync",
              })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("captureSync.warehouseQueue", {
                defaultValue:
                  "{{local}} on this device · {{server}} pending on the server",
                local: localQueued.length,
                server: pendingRows.length,
              })}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!maySync ||
              !online ||
              syncBusy ||
              applySync.isPending ||
              retryable.length === 0
            }
            onClick={() => void flushLocalOutbox()}
          >
            {t("captureSync.syncPending", {
              defaultValue: "Sync pending captures",
            })}
          </Button>
        </div>
        {!online ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("captureSync.warehouseOffline", {
              defaultValue:
                "Reconnect and confirm your active company before syncing warehouse captures.",
            })}
          </p>
        ) : null}
        {syncResult?.scope === scope ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <CaptureSyncBadge state="synced" />
            {syncResult.count}
          </p>
        ) : null}
        {localQueued.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {localQueued.map((item) => (
              <li
                key={item.idempotencyKey}
                className="space-y-1 p-3 text-sm [overflow-wrap:anywhere]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {item.opType === "barcode_scan"
                    ? t("captureSync.barcode", { defaultValue: "Barcode scan" })
                    : t("captureSync.countLine", {
                        defaultValue: "Count line",
                      })}
                  <CaptureSyncBadge
                    state={
                      syncingKey === item.idempotencyKey
                        ? "syncing"
                        : item.syncState === "conflict"
                          ? "conflict"
                          : item.syncState === "error" ||
                              item.syncState === "rejected"
                            ? "failed"
                            : "pending"
                    }
                  />
                </div>
                {item.lastError ? (
                  <p className="text-muted-foreground">{item.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Op</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                    No pending server sync intents.
                  </td>
                </tr>
              ) : (
                pendingPager.pageRows.map((row) => {
                  const id = rowId(row)
                  return (
                    <tr key={id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">
                        {String(row.idempotencyKey ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        {String(row.opType ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        <CaptureSyncBadge
                          state={row.status === "failed" ? "failed" : "pending"}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!maySync ||
                            !online || applySync.isPending ||
                            syncBusy
                          }
                          onClick={async () => {
                            try {
                              setActionError(null)
                              const result = await applyIntent(row)
                              if (liveScope.current === scope) {
                                if (result.status === "applied")
                                  setSyncResult({ scope, count: 1 })
                                else
                                  setActionError(
                                    result.lastError ??
                                      t("captureSync.warehouseRejected", {
                                        defaultValue:
                                          "The server rejected this capture. Review the warehouse record before creating a new capture.",
                                      }),
                                  )
                                void pendingSync.refetch()
                              }
                            } catch (e) {
                              setActionError(
                                e instanceof Error ? e.message : String(e),
                              )
                            }
                          }}
                        >
                          Apply
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          <TablePager {...pendingPager} />
        </div>
      </div>
    </div>
  )
}
