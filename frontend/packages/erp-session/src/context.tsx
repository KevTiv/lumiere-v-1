"use client"

import type React from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  clearStoredActiveCompany,
  readStoredActiveCompany,
  writeStoredActiveCompany,
} from "./active-company-storage"

/** Session slice mirrored from the app’s SpacetimeDB bridge (no WS types here). */
export interface ErpSessionState {
  identity: string | null
  connected: boolean
  organizationId?: number
  companyIds?: readonly number[]
  /** User-selected operating company (legal entity), persisted in localStorage. */
  activeCompanyId?: number | null
  /** Whether active company has been loaded from storage for the current org. */
  activeCompanyReady?: boolean
  setActiveCompanyId?: (companyId: number) => void
}

const defaultState: ErpSessionState = {
  identity: null,
  connected: false,
  organizationId: undefined,
  activeCompanyId: null,
  activeCompanyReady: false,
}

const ErpSessionContext = createContext<ErpSessionState>(defaultState)

function normalizeCompanyIds(companyIds?: readonly number[]): number[] {
  return (companyIds ?? [])
    .map((id) => (typeof id === "number" && Number.isFinite(id) ? Math.floor(id) : Number(id)))
    .filter((id) => Number.isFinite(id) && id > 0)
}

export function ErpSessionProvider({
  value,
  children,
}: {
  value: Omit<ErpSessionState, "activeCompanyId" | "activeCompanyReady" | "setActiveCompanyId">
  children: React.ReactNode
}) {
  const organizationId = value.organizationId
  const [activeCompanyId, setActiveCompanyIdState] = useState<number | null>(null)
  const [activeCompanyReady, setActiveCompanyReady] = useState(false)

  useEffect(() => {
    if (organizationId == null || organizationId <= 0) {
      setActiveCompanyIdState(null)
      setActiveCompanyReady(true)
      return
    }

    setActiveCompanyReady(false)
    const stored = readStoredActiveCompany(organizationId)
    setActiveCompanyIdState(stored)
    setActiveCompanyReady(true)
  }, [organizationId])

  useEffect(() => {
    if (!activeCompanyReady || organizationId == null || organizationId <= 0) return
    if (activeCompanyId == null) return

    const allowed = normalizeCompanyIds(value.companyIds)
    if (allowed.length === 0) return
    if (allowed.includes(activeCompanyId)) return

    const fallback = allowed[0] ?? null
    setActiveCompanyIdState(fallback)
    if (fallback != null) writeStoredActiveCompany(organizationId, fallback)
    else clearStoredActiveCompany()
  }, [activeCompanyId, activeCompanyReady, organizationId, value.companyIds])

  const setActiveCompanyId = useCallback(
    (companyId: number) => {
      if (organizationId == null || organizationId <= 0) return
      const next = Math.floor(companyId)
      if (!Number.isFinite(next) || next <= 0) return
      setActiveCompanyIdState(next)
      writeStoredActiveCompany(organizationId, next)
    },
    [organizationId],
  )

  const contextValue = useMemo<ErpSessionState>(
    () => ({
      ...value,
      activeCompanyId,
      activeCompanyReady,
      setActiveCompanyId,
    }),
    [activeCompanyId, activeCompanyReady, setActiveCompanyId, value],
  )

  return <ErpSessionContext.Provider value={contextValue}>{children}</ErpSessionContext.Provider>
}

export function useErpSession(): ErpSessionState {
  return useContext(ErpSessionContext)
}
