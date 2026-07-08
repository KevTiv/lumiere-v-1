"use client"

import type React from "react"
import { createContext, useContext } from "react"

export interface SubscriptionCacheState {
  /** True after the STDB subscription `onApplied` callback has seeded React Query caches. */
  subscriptionReady: boolean
}

const SubscriptionCacheContext = createContext<SubscriptionCacheState>({
  subscriptionReady: false,
})

export function SubscriptionCacheProvider({
  value,
  children,
}: {
  value: SubscriptionCacheState
  children: React.ReactNode
}) {
  return (
    <SubscriptionCacheContext.Provider value={value}>
      {children}
    </SubscriptionCacheContext.Provider>
  )
}

export function useSubscriptionCache(): SubscriptionCacheState {
  return useContext(SubscriptionCacheContext)
}
