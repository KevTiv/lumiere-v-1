"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { InventoryClient } from "../../../../app/(modules)/inventory/inventory-client"

const api = createLumiereApiClient({ baseUrl: "" })
const session = { identity: "ab".repeat(32), connected: true, organizationId: 7, companyIds: [11, 22] }

function Workspace() {
  const { activeCompanyId, setActiveCompanyId } = useErpSession()
  return (
    <>
      <button type="button" onClick={() => setActiveCompanyId?.(activeCompanyId === 11 ? 22 : 11)}>
        Switch company
      </button>
      <InventoryClient workspace="warehouse" organizationId={7} />
    </>
  )
}

export default function WarehouseCompanyScopeFixture() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <LumiereApiProvider client={api}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider language="en">
          <ErpSessionProvider value={session}>
            <RBACProvider useDefaultFixtures>
              <Workspace />
            </RBACProvider>
          </ErpSessionProvider>
        </I18nProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
  )
}
