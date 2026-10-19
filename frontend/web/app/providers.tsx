"use client"

import { NavigationGuardProvider } from "@lumiere/ui"

import { QueryClient, QueryClientProvider, useQueryClient, useQuery } from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import {
  RBACProvider,
  SonnerToaster,
  ThemeProvider,
  type User,
  type Role,
  type PolicyRule,
  mapBackendRolesToRoles,
} from "@lumiere/ui"
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session"
import { LumiereApiProvider } from "@lumiere/api-client"
import { realtimeQueryKeysForResource } from "@lumiere/query-hooks/hooks/stdb"
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
import { apiFetch } from "@/lib/api-fetch"
import { EFFECTIVE_ACCESS_ROLE_ID } from "@lumiere/ui/lib/runtime-form-role"

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
  const accessQuery = useQuery({
    queryKey: ['auth-access', organizationId, serverIdentity],
    enabled: hasIdentity && Boolean(organizationId),
    queryFn: async () => {
      const response = await apiFetch('/api/session/field-access')
      if (!response.ok) throw new Error('Unable to resolve current permissions')
      const result = await response.json() as { identityHex: string; organizationId?: number; fieldAccess?: FieldAccessContext }
      if (result.identityHex !== serverIdentity || result.organizationId !== organizationId || !result.fieldAccess) {
        throw new Error('Session identity or organization changed')
      }
      return result.fieldAccess
    },
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
    retry: false,
  })
  const access = accessQuery.isError ? undefined : accessQuery.data
  const rbacRoles = useMemo<Role[]>(() => access ? mapBackendRolesToRoles([{
    id: EFFECTIVE_ACCESS_ROLE_ID, name: 'Effective permissions', isActive: true,
    permissions: [...access.rolePermissions],
  }]) : [], [access])
  const rbacUser = useMemo<User | null>(() => access && serverIdentity ? {
    id: serverIdentity, email: '', name: '', roles: [EFFECTIVE_ACCESS_ROLE_ID, ...(access.roleIds ?? [access.roleId]).map(String)],
    status: 'active', department: '', isSuperuser: access.isSuperuser,
    lastLogin: '', createdAt: '', updatedAt: '',
  } : null, [access, serverIdentity])
  const policies = useMemo<PolicyRule[]>(() => (access?.orgPermissions ?? []).map((grant, index) => ({
    id: `effective-grant-${index}`, subject: serverIdentity ?? '', resource: grant.resource,
    action: (grant.action === 'all' ? '*' : grant.action) as PolicyRule['action'],
    effect: grant.allow ? 'allow' : 'deny',
  })), [access, serverIdentity])
  return (
    <RBACProvider initialUser={rbacUser} initialRoles={rbacRoles} initialPolicies={policies}
      permissionsReady={!hasIdentity || Boolean(access)}>
      {children}
    </RBACProvider>
  )
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
  organizationId,
  companyIds,
  fieldAccess,
}: {
  children: React.ReactNode
  serverIdentity?: string
  serverRoleNames?: string[]
  organizationId?: number
  companyIds?: readonly number[]
  fieldAccess?: FieldAccessContext
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
                <RBACBridge
                  serverIdentity={serverIdentity}
                  serverRoleNames={serverRoleNames}
                  organizationId={organizationId}
                >
                  <NavigationGuardProvider>{children}</NavigationGuardProvider>
                </RBACBridge>
              </ErpSessionBridge>
            </StdbSubscriptionProvider>
          </QueryClientProvider>
        </LumiereApiProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
