"use client"

import type React from "react"
import { createContext, useContext } from "react"

export interface LiveSubscriptionContextValue {
  /** Subscribe to additional query resources (idempotent; retained for the session). */
  ensureModuleResources: (resources: readonly string[]) => void
}

const LiveSubscriptionContext = createContext<LiveSubscriptionContextValue>({
  ensureModuleResources: () => {},
})

export function LiveSubscriptionProvider({
  value,
  children,
}: {
  value: LiveSubscriptionContextValue
  children: React.ReactNode
}) {
  return (
    <LiveSubscriptionContext.Provider value={value}>
      {children}
    </LiveSubscriptionContext.Provider>
  )
}

export function useLiveSubscription(): LiveSubscriptionContextValue {
  return useContext(LiveSubscriptionContext)
}
