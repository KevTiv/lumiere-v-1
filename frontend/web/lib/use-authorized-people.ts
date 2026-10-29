"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { apiFetch } from "./api-fetch"
import { authorizedPeopleOptions, selectedPerson, type DirectoryPerson } from "./authorized-people"

/** Reads the existing field-projected, membership-scoped directory; never grants directory access. */
export function useAuthorizedPeople(organizationId: number, enabled = true) {
  const session = useErpSession()
  const { currentUser, roles, policies, permissionsReady, checkPermission } = useRBAC()
  const allowed = permissionsReady === true && session.organizationId === organizationId && currentUser?.id === session.identity
    && checkPermission("user_organization", "read").allowed
  const scopeKey = JSON.stringify([organizationId, session.identity, session.activeCompanyId, currentUser, roles, policies, allowed])
  const liveScope = useRef(scopeKey)
  liveScope.current = scopeKey
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const query = useQuery({
    queryKey: ["alpha-authorized-people", organizationId, session.identity, session.activeCompanyId, JSON.stringify({ currentUser, roles, policies })],
    enabled: enabled && allowed,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const rows: DirectoryPerson[] = []
      // Refuse an incomplete directory rather than choosing people from a truncated page.
      for (let offset = 0; offset < 10_000; offset += 100) {
        const response = await apiFetch(`/api/settings/users?limit=100&offset=${offset}`, { signal })
        if (!response.ok) throw new Error("The authorized people directory could not be loaded")
        const body = await response.json() as { data?: DirectoryPerson[] }
        if (!Array.isArray(body.data)) throw new Error("The people directory response is incomplete")
        rows.push(...body.data)
        if (body.data.length < 100) return authorizedPeopleOptions(rows, organizationId)
      }
      throw new Error("The people directory is too large to verify here")
    },
  })
  const status = !allowed ? "denied" : query.isError ? "error" : query.isPending || query.isFetching ? "loading" : "ready"
  const validateSelection = async (values: readonly unknown[]): Promise<string[]> => {
    if (!mounted.current || !allowed || liveScope.current !== scopeKey) throw new Error("Your access changed. Reopen this form before choosing people.")
    const refreshed = await query.refetch()
    if (!mounted.current || liveScope.current !== scopeKey || refreshed.isError || !refreshed.data) throw new Error("People could not be verified. Your entries have been retained.")
    const identities = values.map((value) => selectedPerson(value, refreshed.data))
    if (identities.some((identity) => identity == null)) throw new Error("Choose active people from the current authorized directory.")
    return identities.filter((identity): identity is string => identity != null)
  }
  return { ...query, status, options: status === "ready" ? query.data ?? [] : [], validateSelection }
}
