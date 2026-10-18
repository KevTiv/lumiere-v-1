"use client"

import { NavigationGuardProvider } from "@lumiere/ui"

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import {
  RBACProvider,
  SonnerToaster,
  ThemeProvider,
  type User,
  type Role,
  type PolicyRule,
  type BackendRoleRow,
  mapBackendRolesToRoles,
  buildRbacUserFromServer,
  permissionStringsToPolicyRules,
} from "@lumiere/ui"
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session"
import { LumiereApiProvider } from "@lumiere/api-client"
import { useStdbQuery, useStdbReducer, realtimeQueryKeysForResource } from "@lumiere/query-hooks/hooks/stdb"
import { usePolicySnapshot } from "@/lib/use-policy-snapshot"
import { useLumiereRealtime } from "@lumiere/query-hooks/hooks/realtime"
import type { FieldAccessContext } from "@lumiere/stdb/field-policy"
import {
  StdbSubscriptionProvider,
  useSubscriptionCache,
} from "@lumiere/stdb/live"
import { FULL_CLIENT_SUBSCRIPTION_RESOURCES } from "@lumiere/stdb/erp-subscriptions"
import { useStdbConnection } from "@lumiere/stdb"
import { useWorkOsAuthMode } from '@/lib/auth-mode-context'
import { webApi } from "@/lib/lumiere-web-http"
import { PostHogPageView } from "@/lib/posthog-pageview"
import { sessionPolicySnapshotNeedsRefresh } from "@/lib/session-company-scope"

// ─── REST-based RBAC Bridge ───────────────────────────────────────────────────
function RBACBridge({
  children,
  serverIdentity,
  serverRoleIds,
  serverPermissions,
  organizationId,
  authorityUnavailable,
  onAuthorityUnavailable,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleIds?: readonly number[]
  serverPermissions?: readonly string[]
  organizationId?: number
  authorityUnavailable: boolean
  onAuthorityUnavailable: () => void
}) {
  const hasIdentity = Boolean(serverIdentity && serverIdentity !== "unknown")
  const { data: rolesData = [], isLoading: rolesLoading } = useStdbQuery("roles", 0, {
    enabled: hasIdentity,
  })
  const { data: assignmentsData = [], isLoading: assignmentsLoading } = useStdbQuery(
    "user-roles",
    organizationId ?? 0,
    { enabled: hasIdentity && organizationId != null && organizationId > 0 },
  )
  const { data: membershipsData = [], isLoading: membershipsLoading } = useStdbQuery(
    "user-organization",
    organizationId ?? 0,
    { enabled: hasIdentity && organizationId != null && organizationId > 0 },
  )
  const assignmentSignature = useMemo(() => JSON.stringify(
    assignmentsData,
    (_key, value) => typeof value === "bigint" ? value.toString() : value,
  ), [assignmentsData])
  const initialAssignmentSignature = useRef<string | null>(null)
  useEffect(() => {
    if (assignmentsLoading) return
    if (initialAssignmentSignature.current == null) {
      initialAssignmentSignature.current = assignmentSignature
      return
    }
    if (initialAssignmentSignature.current !== assignmentSignature) window.location.reload()
  }, [assignmentSignature, assignmentsLoading])
  const membershipSignature = useMemo(() => JSON.stringify(
    membershipsData,
    (_key, value) => typeof value === "bigint" ? value.toString() : value,
  ), [membershipsData])
  const initialMembershipSignature = useRef<string | null>(null)
  useEffect(() => {
    if (membershipsLoading) return
    if (initialMembershipSignature.current == null) {
      initialMembershipSignature.current = membershipSignature
      return
    }
    if (initialMembershipSignature.current !== membershipSignature) window.location.reload()
  }, [membershipSignature, membershipsLoading])

  const {
    orgPolicyRules,
    snapshot,
    versionHash,
    isLoading: policiesLoading,
  } = usePolicySnapshot(organizationId, serverIdentity)
  const snapshotRefreshedAt = snapshot?.refreshedAt
  const snapshotSignature = useMemo(() => JSON.stringify(
    [versionHash, snapshotRefreshedAt],
    (_key, value) => typeof value === "bigint" ? value.toString() : value,
  ), [versionHash, snapshotRefreshedAt])
  const initialSnapshotSignature = useRef<string | null>(null)
  useEffect(() => {
    if (policiesLoading) return
    if (initialSnapshotSignature.current == null) {
      initialSnapshotSignature.current = snapshotSignature
      return
    }
    if (initialSnapshotSignature.current !== snapshotSignature) window.location.reload()
  }, [policiesLoading, snapshotSignature])

  const { mutate: refreshExpiredSnapshot } = useStdbReducer("refresh_policy_snapshot")
  const expiredSnapshotRefreshStarted = useRef(false)
  const snapshotNeedsRefresh = useMemo(() => sessionPolicySnapshotNeedsRefresh({
    assignments: assignmentsData,
    refreshedAt: snapshotRefreshedAt,
  }), [assignmentsData, snapshotRefreshedAt])
  useEffect(() => {
    if (assignmentsLoading || policiesLoading || !snapshotNeedsRefresh) return
    if (expiredSnapshotRefreshStarted.current) return
    expiredSnapshotRefreshStarted.current = true
    refreshExpiredSnapshot({}, {
      onSuccess: () => window.location.reload(),
      onError: onAuthorityUnavailable,
    })
  }, [assignmentsLoading, onAuthorityUnavailable, policiesLoading, refreshExpiredSnapshot, snapshotNeedsRefresh])

  const rbacRoles = useMemo<Role[]>(() => {
    return mapBackendRolesToRoles(rolesData as unknown as BackendRoleRow[])
  }, [rolesData])

  const rbacUser = useMemo<User | null>(() => {
    return buildRbacUserFromServer(rbacRoles, serverRoleIds, serverIdentity)
  }, [serverIdentity, serverRoleIds, rbacRoles])

  const mergedPolicies = useMemo<PolicyRule[]>(() => {
    const rolePolicies = rbacRoles.flatMap((role) =>
      rbacUser?.roles.includes(role.id) ? role.permissions : [],
    )
    const effectiveRolePolicies = rbacUser
      ? permissionStringsToPolicyRules(rbacUser.id, serverPermissions ?? [])
      : []
    return [...rolePolicies, ...effectiveRolePolicies, ...orgPolicyRules]
  }, [rbacRoles, rbacUser, serverPermissions, orgPolicyRules])

  return (
    <RBACProvider
      initialUser={hasIdentity && !authorityUnavailable ? rbacUser : null}
      initialRoles={hasIdentity ? rbacRoles : undefined}
      initialPolicies={hasIdentity && !authorityUnavailable ? mergedPolicies : []}
      permissionsReady={!hasIdentity || !(rolesLoading || assignmentsLoading || membershipsLoading || policiesLoading)}
    >
      {children}
    </RBACProvider>
  )
}

function AuthorityExpiryRefresh({
  expiresAtMicros,
  onUnavailable,
}: {
  expiresAtMicros?: number | null
  onUnavailable: () => void
}) {
  const { mutate: refreshPolicySnapshot } = useStdbReducer("refresh_policy_snapshot")
  useEffect(() => {
    if (expiresAtMicros == null) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      const remainingMs = Math.ceil(expiresAtMicros / 1_000 - Date.now())
      if (remainingMs <= 0) {
        refreshPolicySnapshot({}, {
          onSuccess: () => window.location.reload(),
          onError: onUnavailable,
        })
        return
      }
      timeout = setTimeout(arm, Math.min(remainingMs, 2_147_000_000))
    }
    arm()
    return () => {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }, [expiresAtMicros, onUnavailable, refreshPolicySnapshot])
  return null
}

/** api-server `/v1/realtime/ws` (browser connects directly) → invalidate `useStdbQuery` rows. */
function LumiereRealtimeBridge({
  organizationId,
}: {
  organizationId?: number
}) {
  const queryClient = useQueryClient()
  const workOsEnabled = useWorkOsAuthMode()
  const { activeCompanyId, activeCompanyReady, companyIds } = useErpSession()
  const resources = useMemo(() => FULL_CLIENT_SUBSCRIPTION_RESOURCES, [])
  useLumiereRealtime({
    queryClient,
    organizationId,
    companyIds,
    activeCompanyId: activeCompanyReady ? activeCompanyId : null,
    resources,
    enabled: organizationId != null && organizationId > 0,
    sameOrigin: workOsEnabled,
    beforeConnect: workOsEnabled ? async () => {
      const response = await fetch('/api/auth/realtime-session', { method: 'POST', credentials: 'same-origin' })
      if (!response.ok) throw new Error('Realtime session unavailable')
    } : undefined,
  })
  return null
}

function ErpSessionBridge({
  children,
  serverIdentity,
  organizationId,
  companyIds,
}: {
  children: React.ReactNode
  serverIdentity?: string
  organizationId?: number
  companyIds?: readonly number[]
}) {
  const { connected } = useStdbConnection()
  const { subscriptionReady } = useSubscriptionCache()

  return (
    <ErpSessionProvider
      value={{
        identity: serverIdentity ?? null,
        connected:
          connected
          || subscriptionReady
          || Boolean(serverIdentity && serverIdentity !== "unknown"),
        organizationId: organizationId ?? undefined,
        companyIds,
      }}
    >
      {children}
    </ErpSessionProvider>
  )
}

// ─── Root providers ───────────────────────────────────────────────────────────

export function Providers({
  children,
  serverIdentity,
  serverRoleNames,
  serverRoleIds,
  authorityExpiresAtMicros,
  organizationId,
  companyIds,
  fieldAccess,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
  serverRoleIds?: readonly number[]
  authorityExpiresAtMicros?: number | null
  organizationId?: number
  companyIds?: readonly number[]
  fieldAccess?: FieldAccessContext
}) {
  const [queryClient] = useState(() => new QueryClient())
  const [authorityUnavailable, setAuthorityUnavailable] = useState(false)
  const markAuthorityUnavailable = useCallback(() => {
    queryClient.clear()
    setAuthorityUnavailable(true)
  }, [queryClient])

  return (
    <I18nProvider>
      <ThemeProvider>
        <SonnerToaster />
        <Suspense fallback={null}>
          <PostHogPageView />
        </Suspense>
        <LumiereApiProvider client={webApi}>
          <QueryClientProvider client={queryClient}>
            {authorityUnavailable ? (
              <main data-testid="authority-unavailable" role="alert">
                Authorization state is unavailable. Reload to try again.
              </main>
            ) : (
              <StdbSubscriptionProvider
                fieldAccess={fieldAccess}
                organizationId={organizationId}
                companyIds={companyIds}
                serverIdentity={serverIdentity}
                serverRoleNames={serverRoleNames}
                keysFor={realtimeQueryKeysForResource}
              >
                <ErpSessionBridge
                  serverIdentity={serverIdentity}
                  organizationId={organizationId}
                  companyIds={companyIds}
                >
                  <LumiereRealtimeBridge organizationId={organizationId} />
                  <AuthorityExpiryRefresh
                    expiresAtMicros={authorityExpiresAtMicros}
                    onUnavailable={markAuthorityUnavailable}
                  />
                  <RBACBridge
                    serverIdentity={serverIdentity}
                    serverRoleIds={serverRoleIds}
                    serverPermissions={fieldAccess?.rolePermissions}
                    organizationId={organizationId}
                    authorityUnavailable={authorityUnavailable}
                    onAuthorityUnavailable={markAuthorityUnavailable}
                  >
                    <NavigationGuardProvider>{children}</NavigationGuardProvider>
                  </RBACBridge>
                </ErpSessionBridge>
              </StdbSubscriptionProvider>
            )}
          </QueryClientProvider>
        </LumiereApiProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
