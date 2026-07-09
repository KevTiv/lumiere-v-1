"use client"

import { useMemo } from "react"
import { useUsers } from "@lumiere/query-hooks/hooks/crm"
import { buildIdentityLabelMap } from "../lib/identity-label"

export function useIdentityLabelMap(organizationId: number | bigint): Map<string, string> {
  const orgId = typeof organizationId === "bigint" ? organizationId : BigInt(organizationId)
  const { data: users = [] } = useUsers(orgId)
  return useMemo(
    () => buildIdentityLabelMap(users as Record<string, unknown>[]),
    [users],
  )
}
