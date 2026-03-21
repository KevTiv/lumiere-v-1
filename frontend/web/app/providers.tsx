"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import {
  StdbConnectionProvider,
  useStdbConnection,
  useUserProfile,
  useCasbinRules,
  useStdbRoles,
  useUserRoleAssignments,
  useUserOrganization,
  type CasbinRule,
  type StdbRole,
} from "@lumiere/stdb"
import {
  RBACProvider,
  type User,
  type Role,
  type PolicyRule,
  type Resource,
  type Action,
} from "@lumiere/ui"
import { saveStdbSession } from "@/app/actions/save-stdb-token"

// ─── Casbin → RBAC mapping ───────────────────────────────────────────────────

/**
 * Maps a casbin_rule row (ptype="p") to a PolicyRule.
 * Casbin policy format: ptype=p, v0=subject, v1=resource, v2=action, v3=effect
 */
function mapCasbinRulesToPolicies(rules: CasbinRule[]): PolicyRule[] {
  return rules
    .filter((r) => r.ptype === "p" && r.v0 && r.v1 && r.v2)
    .map((r) => ({
      id: String(r.id),
      subject: r.v0 ?? "*",
      resource: (r.v1 ?? "*") as Resource | "*",
      action: (r.v2 ?? "*") as Action | "*",
      effect: (r.v3 === "deny" ? "deny" : "allow") as "allow" | "deny",
    }))
}

/**
 * Maps stdb Role rows to RBAC Role objects.
 * Permissions come from casbin_rule rows where v0 = role name.
 */
function mapStdbRolesToRbacRoles(
  stdbRoles: StdbRole[],
  casbinRules: CasbinRule[],
): Role[] {
  const colors = ["blue", "green", "orange", "red", "purple", "teal"] as const

  return stdbRoles.map((role, i) => {
    const rolePermissions = casbinRules
      .filter((r) => r.ptype === "p" && r.v0 === role.name)
      .map((r) => ({
        id: String(r.id),
        subject: r.v0 ?? "*",
        resource: (r.v1 ?? "*") as Resource | "*",
        action: (r.v2 ?? "*") as Action | "*",
        effect: (r.v3 === "deny" ? "deny" : "allow") as "allow" | "deny",
      }))

    return {
      id: String(role.id),
      name: role.name,
      description: role.description ?? "",
      isSystem: role.isSystem,
      color: colors[i % colors.length],
      permissions: rolePermissions,
      createdAt: new Date(Number(role.createdAt.microsSinceUnixEpoch) / 1000).toISOString(),
      updatedAt: new Date(Number(role.updatedAt.microsSinceUnixEpoch) / 1000).toISOString(),
    }
  })
}

// ─── Bridge provider ──────────────────────────────────────────────────────────

/**
 * Reads live data from SpacetimeDB and feeds it into RBACProvider.
 * Falls back to RBACProvider mock defaults when not connected.
 */
function StdbRBACBridge({ children }: { children: React.ReactNode }) {
  const { connected } = useStdbConnection()

  const profile = useUserProfile()
  const casbinRules = useCasbinRules()
  const stdbRoles = useStdbRoles()
  const roleAssignments = useUserRoleAssignments()
  const orgMembership = useUserOrganization()

  const rbacUser = useMemo<User | null>(() => {
    if (!profile || !connected) return null

    // Find the user's role IDs from assignments
    const assignedRoleIds = roleAssignments
      .filter((a) => a.isActive)
      .map((a) => String(a.roleId))

    return {
      id: profile.identity.toHexString(),
      email: profile.email,
      name: profile.name,
      avatar: profile.avatarUrl ?? undefined,
      roles: assignedRoleIds,
      status: profile.isActive ? "active" : "inactive",
      department: orgMembership?.jobTitle ?? undefined,
      lastLogin: profile.lastLogin
        ? new Date(Number(profile.lastLogin.microsSinceUnixEpoch) / 1000).toISOString()
        : undefined,
      createdAt: new Date(Number(profile.createdAt.microsSinceUnixEpoch) / 1000).toISOString(),
      updatedAt: new Date(Number(profile.updatedAt.microsSinceUnixEpoch) / 1000).toISOString(),
    }
  }, [profile, roleAssignments, orgMembership, connected])

  const rbacRoles = useMemo<Role[]>(() => {
    if (!connected || stdbRoles.length === 0) return []
    return mapStdbRolesToRbacRoles(stdbRoles, casbinRules)
  }, [stdbRoles, casbinRules, connected])

  const rbacPolicies = useMemo<PolicyRule[]>(() => {
    if (!connected) return []
    // Standalone policies not tied to a role (ptype=p, v0 = identity hex)
    return mapCasbinRulesToPolicies(
      casbinRules.filter((r) => {
        // Exclude role-named subjects (those are captured in role.permissions)
        const isRoleName = stdbRoles.some((role) => role.name === r.v0)
        return !isRoleName
      }),
    )
  }, [casbinRules, stdbRoles, connected])

  // When connected with real data, pass it; otherwise let RBACProvider use defaults
  const hasRealData = connected && rbacUser !== null

  return (
    <RBACProvider
      initialUser={hasRealData ? rbacUser : undefined}
      initialRoles={hasRealData && rbacRoles.length > 0 ? rbacRoles : undefined}
      initialPolicies={hasRealData ? rbacPolicies : undefined}
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
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
}) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <I18nProvider>
    <QueryClientProvider client={queryClient}>
      <StdbConnectionProvider
        onTokenPersisted={saveStdbSession}
        serverIdentity={serverIdentity}
        serverRoleNames={serverRoleNames}
      >
        <StdbRBACBridge>
          {children}
        </StdbRBACBridge>
      </StdbConnectionProvider>
    </QueryClientProvider>
    </I18nProvider>
  )
}
