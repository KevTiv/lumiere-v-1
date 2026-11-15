"use client"

import { useErpSession } from "@lumiere/erp-session"
import { useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { companyHandoff } from "./company-handoff"

export function useCompanyHandoff() {
  const { activeCompanyId, activeCompanyReady, companyIds, setActiveCompanyId } =
    useErpSession()
  const searchParams = useSearchParams()
  const handoff = companyHandoff(`?${searchParams?.toString() ?? ""}`, companyIds)

  useEffect(() => {
    if (!activeCompanyReady || !setActiveCompanyId) return
    const handoff = companyHandoff(window.location.href, companyIds)
    if (!handoff) return
    if (activeCompanyId !== handoff.companyId) {
      setActiveCompanyId(handoff.companyId)
      return
    }
    window.history.replaceState(window.history.state, "", handoff.href)
  }, [activeCompanyId, activeCompanyReady, companyIds, searchParams, setActiveCompanyId])

  return Boolean(handoff && (!activeCompanyReady || activeCompanyId !== handoff.companyId))
}
