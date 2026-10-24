"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { WorkBoardWorkspace } from "../../../../components/work-board/work-board-workspace"
import { ModuleWorkView } from "../../../../components/work-board/module-work-view"
import { useModuleTab } from "../../../../hooks/use-module-tab"
import type { ModuleConfig } from "../../../../../packages/ui/src/lib/module-types"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import type {
  PolicyRule,
  User,
} from "../../../../../packages/ui/src/lib/rbac-types"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { NavigationGuardProvider } from "../../../../../packages/ui/src/forms/navigation-guard-provider"
import type { WorkScope } from "@lumiere/query-hooks/hooks/work-board-model"
import { invalidateStdbQueryResources } from "@lumiere/query-hooks/hooks/stdb"
import {
  realtimeAuthorityKey,
  type RealtimeAuthorityState,
} from "@lumiere/query-hooks/hooks/realtime"

const fixtureApi = createLumiereApiClient({ baseUrl: "" })
const firstIdentity = "ab".repeat(32)
const secondIdentity = "cd".repeat(32)
const scopes: WorkScope[] = [
  "finance",
  "purchasing",
  "sales",
  "accounting",
  "expenses",
]
const moduleFixtureTabs = ["overview", "work"]

function EmbeddedModuleFixture() {
  const [configured, setConfigured] = useState(true)
  // Keep `work` in this controlled parent's allowlist even after removal. The
  // actual module wrapper must retire the view and choose an available tab.
  const { activeTab, setActiveTab } = useModuleTab("overview", moduleFixtureTabs)
  useEffect(() => {
    const channel = new BroadcastChannel("synthetic-work-board-controls")
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "configuration") setConfigured((current) => !current)
    }
    return () => channel.close()
  }, [])
  const config = useMemo<ModuleConfig>(
    () => ({
      id: "fixture-purchasing",
      title: "Purchasing fixture",
      defaultTab: "overview",
      tabs: [
        {
          id: "overview",
          label: "Overview",
          type: "custom",
          customContent: (
            <p data-testid="module-work-fixture-overview">
              Ordinary purchasing overview
            </p>
          ),
        },
      ],
      workspaceNav: {
        workspaces: [
          { id: "overview", label: "Overview", tabIds: ["overview"] },
        ],
      },
      workBoard: configured
        ? {
            scope: "purchasing",
            label: "Kanban",
            sources: ["workflow"],
            defaultLayout: "list",
            workflowColumnOrder: ["Claimed", "Open"],
            workflowColumnLabels: { Claimed: "Awaiting purchasing review" },
          }
        : undefined,
    }),
    [configured],
  )
  return (
    <>
      <button
        type="button"
        className="rounded border px-3 py-2 text-sm"
        onClick={() => setConfigured((current) => !current)}
      >
        {configured
          ? "Disable synthetic Kanban view"
          : "Enable synthetic Kanban view"}
      </button>
      <ModuleWorkView
        organizationId={7}
        config={config}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
      />
    </>
  )
}

function fixtureUser(identity: string): User {
  return {
    id: identity,
    name: "Synthetic finance reviewer",
    email: "reviewer@example.test",
    roles: ["fixture-reviewer"],
    status: "active",
    createdAt: "2026-10-22T09:00:00Z",
    updatedAt: "2026-10-22T09:00:00Z",
  }
}

function FixtureRBAC({
  identity,
  user,
  policies,
  children,
}: {
  identity: string
  user: User
  policies: PolicyRule[]
  children: React.ReactNode
}) {
  const query = useQuery({
    queryKey: ["auth-access", 7, identity],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/session/field-access", {
        signal,
        headers: { "x-fixture-actor": identity },
      })
      if (!response.ok) throw new Error("Synthetic authority refresh failed")
      const body = (await response.json()) as {
        identityHex: string
        organizationId: number
      }
      if (body.identityHex !== identity || body.organizationId !== 7)
        throw new Error("Synthetic authority context changed")
      return body
    },
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: 15_000,
    retry: false,
  })
  const available = !query.isError && !!query.data
  return (
    <RBACProvider
      initialUser={available ? user : null}
      initialRoles={[]}
      initialPolicies={available ? policies : []}
      permissionsReady={available}
    >
      {children}
    </RBACProvider>
  )
}

function Controls({
  onSwitchActor,
  onToggleAccess,
  onRefreshAuthorization,
  allowed,
}: {
  onSwitchActor: () => void
  onToggleAccess: () => void
  onRefreshAuthorization: () => void
  allowed: boolean
}) {
  const session = useErpSession()
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = new BroadcastChannel("synthetic-work-board-controls")
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "refresh")
        for (const resource of ["workflow-human-tasks", "activities"]) {
          void queryClient.invalidateQueries({ queryKey: [resource] })
        }
      if (event.data === "realtime-source")
        invalidateStdbQueryResources(queryClient, 7, ["purchase-orders"])
      if (event.data === "realtime-auth")
        invalidateStdbQueryResources(queryClient, 7, ["auth"])
      if (
        event.data === "socket-reconnecting" ||
        event.data === "socket-subscribed" ||
        event.data === "socket-retry" ||
        event.data === "socket-initial-unavailable"
      ) {
        const key = realtimeAuthorityKey(
          7,
          session.activeCompanyId ?? 0,
          session.identity ?? "",
        )
        const previous = queryClient.getQueryData<RealtimeAuthorityState>(key)
        queryClient.setQueryData<RealtimeAuthorityState>(key, {
          generation:
            event.data === "socket-initial-unavailable"
              ? 0
              : event.data === "socket-retry"
                ? (previous?.generation ?? 0)
                : (previous?.generation ?? 0) + 1,
          phase:
            event.data === "socket-subscribed"
              ? "subscribed"
              : event.data === "socket-retry"
                ? "connecting"
                : "reconnecting",
        })
      }
      if (event.data === "company")
        session.setActiveCompanyId?.(session.activeCompanyId === 11 ? 22 : 11)
      if (event.data === "actor") onSwitchActor()
      if (event.data === "access") onToggleAccess()
      if (event.data === "authorization") onRefreshAuthorization()
    }
    return () => channel.close()
  }, [
    queryClient,
    session,
    onSwitchActor,
    onToggleAccess,
    onRefreshAuthorization,
  ])
  return (
    <section
      aria-label="Synthetic work board controls"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <button
        type="button"
        className="rounded border px-3 py-2"
        onClick={() =>
          session.setActiveCompanyId?.(session.activeCompanyId === 11 ? 22 : 11)
        }
      >
        Switch synthetic company
      </button>
      <button
        type="button"
        className="rounded border px-3 py-2"
        onClick={onSwitchActor}
      >
        Switch synthetic actor
      </button>
      <button
        type="button"
        className="rounded border px-3 py-2"
        onClick={onToggleAccess}
      >
        {allowed ? "Revoke synthetic access" : "Restore synthetic access"}
      </button>
      <button
        type="button"
        className="rounded border px-3 py-2"
        onClick={onRefreshAuthorization}
      >
        Refresh synthetic authorization
      </button>
      <button
        type="button"
        className="rounded border px-3 py-2"
        onClick={() =>
          void queryClient.invalidateQueries({
            queryKey: ["workflow-human-tasks"],
          })
        }
      >
        Refresh synthetic rows
      </button>
      <output
        data-testid="work-board-fixture-scope"
        className="w-full break-all text-xs text-muted-foreground"
      >
        Company {session.activeCompanyId ?? "none"}; actor {session.identity}
      </output>
    </section>
  )
}

/** Production workspace with explicit synthetic session/grants; HTTP is intercepted by Playwright. */
export default function WorkBoardFixture() {
  const params = useSearchParams()
  const moduleHost = params.get("fixtureHost") === "module"
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const [identity, setIdentity] = useState(firstIdentity)
  const [scope, setScope] = useState<WorkScope>("finance")
  const [allowed, setAllowed] = useState(true)
  const [authorizationVersion, setAuthorizationVersion] = useState(1)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const user = useMemo(() => fixtureUser(identity), [identity])
  const policies = useMemo<PolicyRule[]>(
    () =>
      allowed
        ? [
            "workflow_human_task",
            "workflow_human_tasks",
            "module:workflows",
            "module:purchasing",
            "module:sales",
            "module:accounting",
            "module:expenses",
            "activity",
            "purchase_order",
            "sale_order",
            "account_move",
            "hr_expense_sheet",
          ]
            .map(
              (resource, index): PolicyRule => ({
                id: `fixture-work-read-${authorizationVersion}-${index}`,
                subject: "fixture-reviewer",
                resource,
                action: "read",
                effect: "allow",
              }),
            )
            .concat([
              {
                id: `fixture-activity-write-${authorizationVersion}`,
                subject: "fixture-reviewer",
                resource: "activity",
                action: "write",
                effect: "allow",
              },
            ])
        : [],
    [allowed, authorizationVersion],
  )

  return (
    <LumiereApiProvider client={fixtureApi}>
      <QueryClientProvider client={client}>
        <I18nProvider language="en">
          <FixtureRBAC identity={identity} user={user} policies={policies}>
            <ErpSessionProvider
              value={{
                identity,
                connected: true,
                organizationId: 7,
                companyIds: [11, 22],
              }}
            >
              <ThemeProvider
                defaultTheme="light"
                storageKey="lumiere-work-board-fixture"
              >
                <NavigationGuardProvider>
                  <main className="mx-auto min-w-0 max-w-screen-2xl space-y-4 p-4 sm:p-6">
                    <p
                      data-testid="work-board-fixture-disclosure"
                      data-hydrated={hydrated}
                      className="text-xs text-muted-foreground"
                    >
                      Synthetic work board UI. Session, permissions and HTTP
                      responses are fixture boundaries; this does not
                      authenticate or prove ERP backend behavior.
                    </p>
                    <Controls
                      onSwitchActor={() =>
                        setIdentity((current) =>
                          current === firstIdentity
                            ? secondIdentity
                            : firstIdentity,
                        )
                      }
                      onToggleAccess={() => setAllowed((current) => !current)}
                      onRefreshAuthorization={() =>
                        setAuthorizationVersion((current) => current + 1)
                      }
                      allowed={allowed}
                    />
                    {moduleHost ? (
                      <EmbeddedModuleFixture />
                    ) : (
                      <>
                        <label className="inline-flex items-center gap-2 text-sm">
                          Synthetic module scope
                          <select
                            aria-label="Synthetic module scope"
                            className="min-h-11 rounded border bg-background px-2"
                            value={scope}
                            onChange={(event) =>
                              setScope(event.target.value as WorkScope)
                            }
                          >
                            {scopes.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                        <WorkBoardWorkspace
                          key={scope}
                          organizationId={7}
                          scope={scope}
                          initialView="eligible"
                        />
                      </>
                    )}
                  </main>
                </NavigationGuardProvider>
              </ThemeProvider>
            </ErpSessionProvider>
          </FixtureRBAC>
        </I18nProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
  )
}
