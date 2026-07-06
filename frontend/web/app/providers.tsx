"use client"

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"
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
} from "@lumiere/ui"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { LumiereApiProvider } from "@lumiere/api-client"
import { useStdbQuery } from "@lumiere/query-hooks/hooks/stdb"
import { usePolicySnapshot } from "@/lib/use-policy-snapshot"
import { useLumiereRealtime } from "@lumiere/query-hooks/hooks/realtime"
import { FULL_CLIENT_SUBSCRIPTION_RESOURCES } from "@lumiere/stdb/erp-subscriptions"
import { webApi } from "@/lib/lumiere-web-http"
import { PostHogPageView } from "@/lib/posthog-pageview"

// ─── REST-based RBAC Bridge ───────────────────────────────────────────────────
function RBACBridge({
  children,
  serverIdentity,
  serverRoleNames,
  organizationId,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
  organizationId?: number
}) {
  const hasIdentity = Boolean(serverIdentity && serverIdentity !== "unknown")
  const { data: rolesData = [] } = useStdbQuery("roles", 0, {
    enabled: hasIdentity,
  })

  const { orgPolicyRules } = usePolicySnapshot(organizationId, serverIdentity)

  const rbacRoles = useMemo<Role[]>(() => {
    return mapBackendRolesToRoles(rolesData as BackendRoleRow[])
  }, [rolesData])

  const rbacUser = useMemo<User | null>(() => {
    return buildRbacUserFromServer(rbacRoles, serverRoleNames, serverIdentity)
  }, [serverIdentity, serverRoleNames, rbacRoles])

  const mergedPolicies = useMemo<PolicyRule[]>(() => {
    const rolePolicies = rbacRoles.flatMap((role) =>
      rbacUser?.roles.includes(role.id) ? role.permissions : [],
    )
    return [...rolePolicies, ...orgPolicyRules]
  }, [rbacRoles, rbacUser, orgPolicyRules])

  return (
    <RBACProvider
      initialUser={hasIdentity ? rbacUser : null}
      initialRoles={hasIdentity ? rbacRoles : undefined}
      initialPolicies={hasIdentity ? mergedPolicies : undefined}
    >
      {children}
    </RBACProvider>
  )
}

/** api-server `/v1/realtime/ws` (browser connects directly) → invalidate `useStdbQuery` rows. */
function LumiereRealtimeBridge({
  organizationId,
  companyIds,
}: {
  organizationId?: number
  companyIds?: readonly number[]
}) {
  const queryClient = useQueryClient()
  const resources = useMemo(() => FULL_CLIENT_SUBSCRIPTION_RESOURCES, [])
  useLumiereRealtime({
    queryClient,
    organizationId,
    companyIds,
    resources,
    enabled: organizationId != null && organizationId > 0,
  })
  return null
}

// ─── Root providers ───────────────────────────────────────────────────────────

export function Providers({
  children,
  serverIdentity,
  serverRoleNames,
  organizationId,
  companyIds,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
  organizationId?: number
  /** Company row ids for realtime subscription context (fixed-assets, intercompany, …). */
  companyIds?: readonly number[]
}) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <I18nProvider>
      <ThemeProvider>
        <SonnerToaster />
        <Suspense fallback={null}>
          <PostHogPageView />
        </Suspense>
        <LumiereApiProvider client={webApi}>
          <QueryClientProvider client={queryClient}>
            <LumiereRealtimeBridge organizationId={organizationId} companyIds={companyIds} />
            <ErpSessionProvider
              value={{
                identity: serverIdentity ?? null,
                connected: Boolean(serverIdentity && serverIdentity !== "unknown"),
                organizationId: organizationId ?? undefined,
                companyIds,
              }}
            >
              <RBACBridge
                serverIdentity={serverIdentity}
                serverRoleNames={serverRoleNames}
                organizationId={organizationId}
              >
                {children}
              </RBACBridge>
            </ErpSessionProvider>
          </QueryClientProvider>

        </LumiereApiProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
