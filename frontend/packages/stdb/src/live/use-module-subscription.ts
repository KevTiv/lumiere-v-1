"use client"

import { useEffect, useMemo } from "react"

import { useLiveSubscription } from "./subscription-registry"

/**
 * Subscribe to module workspace resources when the route client mounts.
 * Idempotent — safe to call on every render; resources stay subscribed for the session.
 */
export function useModuleSubscription(resources: readonly string[]): void {
  const { ensureModuleResources } = useLiveSubscription()
  const stableKey = useMemo(() => resources.join("\0"), [resources])

  useEffect(() => {
    if (resources.length === 0) return
    ensureModuleResources(resources)
  }, [ensureModuleResources, stableKey, resources])
}
