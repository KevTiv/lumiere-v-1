"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { I18nProvider } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ActivationChecklistPanel } from "../../../../app/(modules)/overview/activation-checklist-panel"

const api = createLumiereApiClient({ baseUrl: "" })
const user = { id: "fixture-actor", roles: [], email: "fixture@example.test", name: "Fixture", status: "active" as const, department: "", lastLogin: "", createdAt: "", updatedAt: "" }
const resources = ["contact", "sale_order", "hr_expense", "account_move", "financial_report"]
const policies = resources.flatMap(resource => (["read", "create"] as const).map(action => ({ id: `${resource}:${action}`, subject: user.id, resource, action, effect: "allow" as const })))

export default function ActivationFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }))
  const [companyId, setCompanyId] = useState<number | null>(2)
  const [ready, setReady] = useState(true)
  return <QueryClientProvider client={client}><LumiereApiProvider client={api}><I18nProvider>
    <RBACProvider initialUser={user} initialRoles={[]} initialPolicies={policies} permissionsReady={ready}>
      <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
        <p data-testid="activation-fixture-disclosure" className="text-sm">Synthetic UI fixture. No authentication or backend business operations.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setCompanyId(2)}>Company 2</button>
          <button onClick={() => setCompanyId(3)}>Company 3</button>
          <button onClick={() => setCompanyId(null)}>No company</button>
          <button onClick={() => setReady(value => !value)}>Toggle permissions</button>
        </div>
        <ActivationChecklistPanel organizationId={1} companyId={companyId} />
      </main>
    </RBACProvider>
  </I18nProvider></LumiereApiProvider></QueryClientProvider>
}
