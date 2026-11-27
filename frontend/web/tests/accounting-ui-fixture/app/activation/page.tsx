"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { AssistantNativeFormProvider, useAssistantNativeFormController } from "../../../../../packages/ui/src/components/assistant-native-form-provider"
import { ActivationChecklistPanel } from "../../../../app/(modules)/overview/activation-checklist-panel"

const api = createLumiereApiClient({ baseUrl: "" })
const user = { id: "fixture-actor", roles: [], email: "fixture@example.test", name: "Fixture", status: "active" as const, department: "", lastLogin: "", createdAt: "", updatedAt: "" }
const resources = ["contact", "sale_order", "hr_expense", "account_move", "financial_report", "warehouse", "stock_location", "module:inventory", "module:sales", "pricelist", "product_pricelist"]
const policies = resources.flatMap(resource => (["read", "create"] as const).map(action => ({ id: `${resource}:${action}`, subject: user.id, resource, action, effect: "allow" as const })))

const session = { identity: user.id, connected: true, organizationId: 1, companyIds: [2, 3] }

export default function ActivationFixture() {
  return <ErpSessionProvider value={session}><ActivationFixtureContent /></ErpSessionProvider>
}

function ActivationFixtureContent() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }))
  const { activeCompanyId, setActiveCompanyId } = useErpSession()
  const [noCompany, setNoCompany] = useState(false)
  const companyId = noCompany ? null : activeCompanyId ?? null
  const setCompanyId = (id: number) => { setNoCompany(false); setActiveCompanyId?.(id) }
  const [ready, setReady] = useState(true)
  const [warehouseSetupAllowed, setWarehouseSetupAllowed] = useState(true)
  const [pricingSetupAllowed, setPricingSetupAllowed] = useState(true)
  const [compact, setCompact] = useState(false)
  const nativeForms = useAssistantNativeFormController(companyId == null ? null : `fixture-actor:1:${companyId}`)
  return <QueryClientProvider client={client}><LumiereApiProvider client={api}><I18nProvider>
    <RBACProvider initialUser={user} initialRoles={[]} initialPolicies={policies.filter(policy => (warehouseSetupAllowed || policy.id !== "warehouse:create") && (pricingSetupAllowed || policy.id !== "pricelist:create"))} permissionsReady={ready}>
      <AssistantNativeFormProvider value={nativeForms}>
      <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
        <p data-testid="activation-fixture-disclosure" className="text-sm">Synthetic UI fixture. No authentication or backend business operations.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setCompanyId(2)}>Company 2</button>
          <button onClick={() => setCompanyId(3)}>Company 3</button>
          <button onClick={() => setNoCompany(true)}>No company</button>
          <button onClick={() => setWarehouseSetupAllowed(value => !value)}>Toggle warehouse setup permission</button>
          <button onClick={() => setPricingSetupAllowed(value => !value)}>Toggle price setup permission</button>
          <button onClick={() => setReady(value => !value)}>Toggle permissions</button>
          <button onClick={() => setCompact(value => !value)}>Compact completed setup</button>
        </div>
        <ActivationChecklistPanel organizationId={1} companyId={companyId} collapseWhenReady={compact} />
      </main>
      </AssistantNativeFormProvider>
    </RBACProvider>
  </I18nProvider></LumiereApiProvider></QueryClientProvider>
}
