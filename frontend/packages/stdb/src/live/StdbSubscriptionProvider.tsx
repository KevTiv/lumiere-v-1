"use client"

import { useQueryClient } from "@tanstack/react-query"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { FieldAccessContext } from "../field-policy"
import { StdbConnectionProvider } from "../context"
import type { DbConnection } from "../generated"
import type { QueryKeyFactory } from "./cache-patch"
import { BOOT_SUBSCRIPTION_RESOURCE_LIST } from "./boot-resources"
import { SubscriptionCacheProvider } from "./context"
import { SubscriptionCacheBridge } from "./subscription-bridge"
import { LiveSubscriptionProvider } from "./subscription-registry"
import { createLiveSubscriptionManager } from "./subscription-manager"
import { setSubscriptionReady } from "./state"

export type SubscriptionQueryKeyFactory = QueryKeyFactory

export interface StdbSubscriptionProviderProps {
  children: React.ReactNode
  stdbToken?: string
  fieldAccess?: FieldAccessContext
  organizationId?: number
  companyIds?: readonly number[]
  serverIdentity?: string
  serverRoleNames?: string[]
  keysFor: SubscriptionQueryKeyFactory
  host?: string
  moduleName?: string
}

export function StdbSubscriptionProvider({
  children,
  stdbToken,
  fieldAccess,
  organizationId,
  companyIds,
  serverIdentity,
  serverRoleNames,
  keysFor,
  host,
  moduleName,
}: StdbSubscriptionProviderProps) {
  const qc = useQueryClient()
  const bridgeRef = useRef<SubscriptionCacheBridge | null>(null)
  const managerRef = useRef<ReturnType<typeof createLiveSubscriptionManager> | null>(null)
  const [subscriptionReady, setReady] = useState(false)

  if (!bridgeRef.current) {
    bridgeRef.current = new SubscriptionCacheBridge(qc)
  }

  if (!managerRef.current && organizationId != null && organizationId > 0) {
    managerRef.current = createLiveSubscriptionManager({
      bridge: bridgeRef.current,
      organizationId,
      companyIds,
      serverIdentity,
      serverRoleNames,
      fieldAccess,
      keysFor,
    })
  }

  const enabled =
    Boolean(stdbToken) && organizationId != null && organizationId > 0

  useEffect(() => {
    if (!enabled) {
      managerRef.current?.onDisconnect()
      bridgeRef.current?.onDisconnect()
      setReady(false)
      setSubscriptionReady(false)
      managerRef.current = null
    }
  }, [enabled])

  const handleApplied = useCallback(
    (conn: DbConnection) => {
      if (!managerRef.current) return
      managerRef.current.onBootApplied(conn)
      setReady(true)
    },
    [],
  )

  const handleDisconnect = useCallback(() => {
    managerRef.current?.onDisconnect()
    setReady(false)
  }, [])

  const ensureModuleResources = useCallback((resources: readonly string[]) => {
    managerRef.current?.ensureModuleResources(resources)
  }, [])

  const liveValue = useMemo(
    () => ({ ensureModuleResources }),
    [ensureModuleResources],
  )

  const cacheValue = useMemo(
    () => ({ subscriptionReady: enabled && subscriptionReady }),
    [enabled, subscriptionReady],
  )

  if (!enabled) {
    return (
      <SubscriptionCacheProvider value={{ subscriptionReady: false }}>
        <LiveSubscriptionProvider value={{ ensureModuleResources: () => {} }}>
          {children}
        </LiveSubscriptionProvider>
      </SubscriptionCacheProvider>
    )
  }

  return (
    <SubscriptionCacheProvider value={cacheValue}>
      <LiveSubscriptionProvider value={liveValue}>
        <StdbConnectionProvider
          token={stdbToken}
          host={host}
          moduleName={moduleName}
          organizationId={organizationId}
          companyIds={companyIds}
          serverIdentity={serverIdentity}
          serverRoleNames={serverRoleNames}
          fieldAccess={fieldAccess}
          subscriptionResources={BOOT_SUBSCRIPTION_RESOURCE_LIST}
          onSubscriptionApplied={handleApplied}
          onSubscriptionDisconnect={handleDisconnect}
        >
          {children}
        </StdbConnectionProvider>
      </LiveSubscriptionProvider>
    </SubscriptionCacheProvider>
  )
}
