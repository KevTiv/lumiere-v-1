import type { FieldAccessContext } from "../field-policy"
import type { DbConnection } from "../generated"
import { createClientSubscriptions, type SubscriptionQueryContext } from "../queries/erp-subscriptions"
import type { QueryKeyFactory } from "./cache-patch"
import { BOOT_SUBSCRIPTION_RESOURCES } from "./boot-resources"
import { SubscriptionCacheBridge } from "./subscription-bridge"

export interface LiveSubscriptionManager {
  ensureModuleResources: (resources: readonly string[]) => void
  onBootApplied: (conn: DbConnection) => void
  onDisconnect: () => void
}

export function createLiveSubscriptionManager(input: {
  bridge: SubscriptionCacheBridge
  organizationId: number
  companyIds?: readonly number[]
  serverIdentity?: string
  serverRoleNames?: string[]
  fieldAccess?: FieldAccessContext
  keysFor: QueryKeyFactory
}): LiveSubscriptionManager {
  const subscribed = new Set<string>(BOOT_SUBSCRIPTION_RESOURCES)
  const pending: string[] = []
  let conn: DbConnection | null = null

  const queryContext = (): SubscriptionQueryContext => ({
    identityHex: input.serverIdentity,
    roleNames: input.serverRoleNames,
    organizationId: input.organizationId,
    companyIds: input.companyIds,
    fieldAccess: input.fieldAccess,
  })

  const bridgeConfig = () => ({
    organizationId: input.organizationId,
    companyIds: input.companyIds,
    keysFor: input.keysFor,
  })

  const subscribeSql = (resources: readonly string[]): void => {
    if (!conn || resources.length === 0) return
    const sql = createClientSubscriptions([...resources], queryContext())
    if (sql.length === 0) return

    conn
      .subscriptionBuilder()
      .onApplied(() => {
        input.bridge.addResources(conn!, resources)
      })
      .onError((err) => {
        console.error("[stdb] module subscription error", err)
      })
      .subscribe(sql)
  }

  const flushPending = (): void => {
    if (!conn || pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    subscribeSql(batch)
  }

  return {
    ensureModuleResources(resources: readonly string[]) {
      const novel = resources.filter((r) => !subscribed.has(r))
      if (novel.length === 0) return
      for (const r of novel) subscribed.add(r)

      if (!conn) {
        pending.push(...novel)
        return
      }
      subscribeSql(novel)
    },

    onBootApplied(connection: DbConnection) {
      conn = connection
      input.bridge.onBootApplied(connection, bridgeConfig(), BOOT_SUBSCRIPTION_RESOURCES)
      flushPending()
    },

    onDisconnect() {
      conn = null
      subscribed.clear()
      for (const r of BOOT_SUBSCRIPTION_RESOURCES) subscribed.add(r)
      pending.length = 0
      input.bridge.onDisconnect()
    },
  }
}
