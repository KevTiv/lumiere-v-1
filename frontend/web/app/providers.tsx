"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, useMemo } from "react"
import { I18nProvider } from "@lumiere/i18n"
import {
  RBACProvider,
  ThemeProvider,
  type User,
  type Role,
} from "@lumiere/ui"
import { StdbConnectionProvider, FULL_CLIENT_SUBSCRIPTION_RESOURCES } from "@lumiere/stdb"
import { useStdbQuery } from "@/hooks/stdb"
import { saveStdbSession } from "@/app/actions/save-stdb-token"

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
  companyIds,
  stdbModule,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
  organizationId?: number
  companyIds?: readonly number[]
  /** Must match server `STDB_MODULE` / upstream database name */
  stdbModule?: string
}) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <StdbConnectionProvider
            sameOriginStdbProxy
            moduleName={stdbModule}
            serverIdentity={serverIdentity}
            serverRoleNames={serverRoleNames}
            organizationId={organizationId}
            companyIds={companyIds}
            subscriptionResources={FULL_CLIENT_SUBSCRIPTION_RESOURCES}
            onTokenPersisted={(token, identityHex) => {
              void saveStdbSession(token, identityHex)
            }}
          >
            <RBACBridge serverIdentity={serverIdentity} serverRoleNames={serverRoleNames}>
              {children}
            </RBACBridge>
          </StdbConnectionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
