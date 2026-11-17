"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { AIChatPanel } from "@lumiere/ui/ai-chat/ai-chat-panel"
import type { ChatNativeActionOutcome } from "@lumiere/ui/lib/ai-chat-types"
import { ModuleView } from "@lumiere/ui/pages/module-view"
import type { ChatMessage } from "@lumiere/ui/lib/ai-chat-types"
import type { ModuleConfig } from "@lumiere/ui/lib/module-types"
import type { Role } from "@lumiere/ui/lib/rbac-types"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider, useRBAC } from "@lumiere/ui/lib/rbac-context"
import { NavigationGuardProvider } from "@lumiere/ui/forms/navigation-guard-provider"
import {
  AssistantNativeFormProvider,
  useAssistantNativeFormController,
} from "@lumiere/ui/components/assistant-native-form-provider"
import {
  decodeAssistantAction,
  getAssistantCapability,
  type AssistantAction,
} from "@lumiere/query-hooks/assistant-actions"
import { saleOrderHref } from "@lumiere/erp-shared/record-links"
import { webApi } from "../../../../lib/lumiere-web-http"

const originalScope = {
  actorId: "ab".repeat(32),
  organizationId: "8001",
  companyId: "9001",
}
const nativeAction: AssistantAction = {
  version: 1,
  kind: "open_form",
  capabilityKey: "sales.order.create",
  scope: originalScope,
  prompt: "Prepare a sales order with a reference I will review",
}
const messages: ChatMessage[] = [
  {
    id: "fixture-answer",
    role: "assistant",
    content: "Prepare the existing native order editor.",
    timestamp: new Date(0),
    actions: [
      {
        id: "fixture-form-action",
        type: "native",
        label: "Prepare sales order",
        nativeAction,
      },
    ],
  },
]
const config: ModuleConfig = {
  id: "sales",
  title: "Assistant native action fixture",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Overview",
      type: "custom",
      customContent: <p>Open the order editor from the assistant.</p>,
    },
    {
      id: "orders",
      label: "Orders",
      type: "entity",
      createLabel: "New order",
      createAction: "createSaleOrder",
      createPermission: { resource: "sale_order", action: "create" },
      createForm: {
        id: "assistant-fixture-order",
        title: "Native fixture order editor",
        submitLabel: "Save fixture order",
        sections: [
          {
            id: "main",
            fields: [
              {
                id: "reference",
                name: "reference",
                label: "Order reference",
                type: "text",
                required: true,
              },
            ],
          },
        ],
      },
      entityConfig: {
        id: "fixture-orders",
        entityType: "sale_order",
        title: "Orders",
        view: {
          mode: "table",
          rowKey: "id",
          columns: [{ key: "name", label: "Order" }],
        },
      },
    },
  ],
}

function NativeWorkspace({
  actor,
  companyId,
}: {
  actor: string
  companyId: number
}) {
  const router = useRouter()
  const { checkPermission, permissionsReady } = useRBAC()
  const scope = useMemo(
    () => ({
      actorId: actor,
      organizationId: "8001",
      companyId: String(companyId),
    }),
    [actor, companyId],
  )
  const scopeKey = `${actor}:8001:${companyId}`
  const controller = useAssistantNativeFormController(scopeKey)
  const [chatOpen, setChatOpen] = useState(true)
  const [submissions, setSubmissions] = useState(0)
  const [requestCount, setRequestCount] = useState(0)
  const onNativeAction = (value: AssistantAction) => {
    const action = decodeAssistantAction(value, scope)
    const capability = action && getAssistantCapability(action.capabilityKey)
    const tab = capability && capability.tab
    if (!action || !capability || !tab)
      throw new Error("The action belongs to an earlier scope")
    if (
      !permissionsReady ||
      !checkPermission(
        capability.permission.resource,
        capability.permission.action,
      ).allowed
    )
      throw new Error("Native creation is unavailable")
    return new Promise<ChatNativeActionOutcome>((resolve) => {
      const status = controller.requestForm({
        requestId: crypto.randomUUID(),
        scopeKey,
        moduleId: capability.module,
        tabId: tab,
        prompt: action.prompt,
        onPresentationOutcome: resolve,
      })
      if (status !== "pending") {
        resolve(status)
        return
      }
      setRequestCount((count) => count + 1)
      // The fixture hosts the real Sales module owner under its isolated route.
      router.push(`/assistant-actions?tab=${encodeURIComponent(tab)}`)
    })
  }
  return (
    <AssistantNativeFormProvider value={controller}>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <section className="min-w-0 rounded-lg border p-3">
          <button type="button" onClick={() => setChatOpen(true)}>
            Open fixture assistant
          </button>
          <ModuleView
            config={config}
            data={{
              orders: [
                { id: "42", name: "Synthetic order 42" },
                { id: "99", name: "Synthetic order 99" },
              ],
            }}
            onFormSubmit={async () => {
              setSubmissions((count) => count + 1)
              throw new Error(
                "Fixture save rejected; retain your draft. No ERP command was sent.",
              )
            }}
          />
          <div className="flex flex-wrap gap-3 text-sm">
            <a href={saleOrderHref("42")}>Canonical order 42</a>
            <a href={saleOrderHref("99")}>Canonical order 99</a>
            <Link href="/assistant-actions?tab=dashboard">
              Return to fixture overview
            </Link>
          </div>
          <output data-testid="fixture-native-requests">{requestCount}</output>
          <output data-testid="fixture-native-submissions">
            {submissions}
          </output>
          <output data-testid="fixture-native-outcome">
            {controller.outcome?.status ?? "none"}
          </output>
        </section>
        <section className="relative flex min-h-[440px] min-w-0 flex-col overflow-hidden rounded-lg border lg:min-h-0">
          <AIChatPanel
            open={chatOpen}
            docked
            onClose={() => setChatOpen(false)}
            context={{ companyId, currentUser: actor }}
            initialMessages={messages}
            config={{ onNativeAction }}
          />
        </section>
      </div>
    </AssistantNativeFormProvider>
  )
}

export default function Page() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const [actor, setActor] = useState(originalScope.actorId)
  const [companyId, setCompanyId] = useState(9001)
  const [allowed, setAllowed] = useState(true)
  const user = useMemo(
    () => ({
      id: actor,
      name: "Fixture operator",
      email: "fixture@example.test",
      roles: ["operator"],
      status: "active" as const,
      createdAt: "",
      updatedAt: "",
    }),
    [actor],
  )
  const roles = useMemo<Role[]>(
    () => [
      {
        id: "operator",
        name: "Fixture operator",
        description: "",
        color: "blue",
        createdAt: "",
        updatedAt: "",
        permissions: [
          {
            id: "read-sales",
            subject: "operator",
            resource: "module:sales",
            action: "read" as const,
            effect: "allow" as const,
          },
          {
            id: "read-order",
            subject: "operator",
            resource: "sale_order",
            action: "read" as const,
            effect: "allow" as const,
          },
          ...(allowed
            ? [
                {
                  id: "create-order",
                  subject: "operator",
                  resource: "sale_order",
                  action: "create" as const,
                  effect: "allow" as const,
                },
              ]
            : []),
        ],
      },
    ],
    [allowed],
  )
  return (
    <LumiereApiProvider client={webApi}>
      <QueryClientProvider client={client}>
        <I18nProvider language="en">
          <RBACProvider
            initialUser={user}
            initialRoles={roles}
            initialPolicies={[]}
          >
            <ErpSessionProvider
              value={{
                identity: actor,
                connected: true,
                organizationId: 8001,
                companyIds: [companyId],
              }}
            >
              <ThemeProvider defaultTheme="light">
                <NavigationGuardProvider>
                  <main className="flex min-h-screen flex-col gap-3 p-3 lg:h-screen">
                    <p className="text-sm">
                      Production chat, native form and routing components with
                      synthetic fields. Saves deliberately fail; no ERP
                      persistence or live authorization is claimed.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => setAllowed(false)}>
                        Remove create permission
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActor("cd".repeat(32))
                          setCompanyId(9002)
                        }}
                      >
                        Change actor and company
                      </button>
                    </div>
                    <NativeWorkspace actor={actor} companyId={companyId} />
                  </main>
                </NavigationGuardProvider>
              </ThemeProvider>
            </ErpSessionProvider>
          </RBACProvider>
        </I18nProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
  )
}
