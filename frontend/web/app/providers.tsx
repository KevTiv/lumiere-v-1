"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import {
  RBACProvider,
  ThemeProvider,
  type User,
  type Role,
} from "@lumiere/ui"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { LumiereApiProvider } from "@lumiere/api-client"
import { useStdbQuery } from "@lumiere/query-hooks/hooks/stdb"
import { webApi } from "@/lib/lumiere-web-http"

// ─── REST-based RBAC Bridge ───────────────────────────────────────────────────
const getRBACRoles = (rolesData: Record<string, unknown>[]) => {
  const colors = ["blue", "green", "orange", "red", "purple", "teal"] as const
  return (rolesData as Record<string, unknown>[]).map((role, i) => ({
    id: String(role.id ?? ""),
    name: String(role.name ?? ""),
    description: String(role.description ?? ""),
    isSystem: Boolean(role.isSystem),
    color: colors[i % colors.length],
    permissions: [],
    createdAt: String(role.createdAt ?? new Date().toISOString()),
    updatedAt: String(role.updatedAt ?? new Date().toISOString()),
  }))
}

const getRBACUser = (rbacRoles: Role[], serverRoleNames?: string[], serverIdentity?: string) => {
  if (!serverIdentity) return null
  const names = serverRoleNames ?? []
  const assignedRoleIds = rbacRoles
    .filter((r) => names.includes(r.name))
    .map((r) => r.id)

  return {
    id: serverIdentity,
    email: "",
    name: "",
    roles: assignedRoleIds,
    status: "active" as const,
    department: "",
    lastLogin: new Date().toISOString(),
  } as User
}
/**
 * Replaces the former WebSocket-based StdbRBACBridge.
 * Role definitions are fetched from /api/query/roles via React Query.
 * The current user is built from server-resolved identity + role names
 * (passed down from the RSC layout, which already calls the REST API).
 */
function RBACBridge({
  children,
  serverIdentity,
  serverRoleNames,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
}) {
  const { data: rolesData = [] } = useStdbQuery('roles', 0)

  const rbacRoles = useMemo<Role[]>(() => {
    return getRBACRoles(rolesData);
  }, [rolesData])

  const rbacUser = useMemo(() => {
    return getRBACUser(rbacRoles, serverRoleNames, serverIdentity)
  }, [serverIdentity, serverRoleNames, rbacRoles])

  return (
    <RBACProvider
      initialUser={rbacUser ?? undefined}
      initialRoles={rbacRoles.length > 0 ? rbacRoles : undefined}
    >
      {children}
    </RBACProvider>
  )
}

// ─── Root providers ───────────────────────────────────────────────────────────

export function Providers({
  children,
  serverIdentity,
  serverRoleNames,
  organizationId,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
  organizationId?: number
  /** @deprecated WebSocket stack removed (Phase 5); ignored */
  companyIds?: readonly number[]
  /** @deprecated WebSocket stack removed (Phase 5); ignored */
  stdbModule?: string
}) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <I18nProvider>
      <ThemeProvider>
        <LumiereApiProvider client={webApi}>
          <QueryClientProvider client={queryClient}>
            <ErpSessionProvider
              value={{
                identity: serverIdentity ?? null,
                connected: Boolean(serverIdentity),
                organizationId: organizationId ?? undefined,
              }}
            >
              <RBACBridge serverIdentity={serverIdentity} serverRoleNames={serverRoleNames}>
                {children}
              </RBACBridge>
            </ErpSessionProvider>
          </QueryClientProvider>

        </LumiereApiProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
