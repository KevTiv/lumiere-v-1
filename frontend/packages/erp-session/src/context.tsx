"use client"

import type React from "react"
import { createContext, useContext } from "react"

/** Session slice mirrored from the app’s SpacetimeDB bridge (no WS types here). */
export interface ErpSessionState {
  identity: string | null
  connected: boolean
  organizationId?: number
  companyIds?: readonly number[]
}

const defaultState: ErpSessionState = {
  identity: null,
  connected: false,
  organizationId: undefined,
}

const ErpSessionContext = createContext<ErpSessionState>(defaultState)

export function ErpSessionProvider({
  value,
  children,
}: {
  value: ErpSessionState
  children: React.ReactNode
}) {
  return <ErpSessionContext.Provider value={value}>{children}</ErpSessionContext.Provider>
}

export function useErpSession(): ErpSessionState {
  return useContext(ErpSessionContext)
}
