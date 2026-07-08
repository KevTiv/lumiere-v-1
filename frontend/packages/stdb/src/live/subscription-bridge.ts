import type { QueryClient } from "@tanstack/react-query"

import type { DbConnection } from "../generated"
import {
  refreshResourcesForTable,
  seedSubscribedResources,
  type QueryKeyFactory,
} from "./cache-patch"
import type { ResourceScopeContext } from "./projection"
import { resourcesForTable } from "./table-resource-index"
import { setSubscriptionReady } from "./state"
import { TableWireRegistry } from "./table-wire-registry"
import { tablesForSubscribedResources } from "./wire-tables"

export interface SubscriptionBridgeConfig {
  organizationId: number
  companyIds?: readonly number[]
  keysFor: QueryKeyFactory
}

export class SubscriptionCacheBridge {
  private readonly wireRegistry = new TableWireRegistry()
  private config: SubscriptionBridgeConfig | null = null
  private conn: DbConnection | null = null

  constructor(private readonly qc: QueryClient) {}

  private scopeContext(): ResourceScopeContext | null {
    if (!this.config) return null
    return {
      organizationId: this.config.organizationId,
      companyIds: this.config.companyIds,
    }
  }

  private onTableChange(table: string): void {
    const ctx = this.scopeContext()
    if (!ctx || !this.conn || !this.config) return
    refreshResourcesForTable(
      this.qc,
      this.conn,
      ctx,
      table,
      resourcesForTable(table),
      this.config.keysFor,
    )
  }

  /** Initial boot subscription applied — seed session/RBAC caches and wire tables. */
  onBootApplied(conn: DbConnection, config: SubscriptionBridgeConfig, bootResources: readonly string[]): void {
    this.conn = conn
    this.config = config

    const ctx = this.scopeContext()!
    seedSubscribedResources(this.qc, conn, ctx, bootResources, config.keysFor)
    this.wireRegistry.wireMore(conn, tablesForSubscribedResources(bootResources), (table) => {
      this.onTableChange(table)
    })

    setSubscriptionReady(true)
  }

  /** Incremental module subscription — seed new resources and wire any new tables. */
  addResources(conn: DbConnection, resources: readonly string[]): void {
    if (!this.config || resources.length === 0) return
    this.conn = conn

    const ctx = this.scopeContext()!
    seedSubscribedResources(this.qc, conn, ctx, resources, this.config.keysFor)
    this.wireRegistry.wireMore(conn, tablesForSubscribedResources(resources), (table) => {
      this.onTableChange(table)
    })
  }

  onDisconnect(): void {
    this.wireRegistry.dispose()
    this.conn = null
    this.config = null
    setSubscriptionReady(false)
  }
}
