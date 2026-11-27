"use client"

import { useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { CurrencyFormatProvider } from "@lumiere/ui"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { VehiclePageClient } from "../../../../../app/(modules)/fleet/vehicles/[id]/vehicle-page-client"

const api = createLumiereApiClient({ baseUrl: "" })
const session = { identity: "ab".repeat(32), connected: true, organizationId: 7, companyIds: [11] }
const user = {
  id: session.identity,
  name: "Fleet user",
  email: "fleet@example.test",
  status: "active" as const,
  createdAt: "",
  updatedAt: "",
}

export default function FleetServiceRecoveryFixture() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const { id } = useParams<{ id: string }>()
  const owner = useSearchParams().get("role") !== "operator"

  return (
    <LumiereApiProvider client={api}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider language="en">
          <ErpSessionProvider value={session}>
            <RBACProvider
              initialUser={{ ...user, roles: owner ? ["owner"] : [] }}
              initialPolicies={[
                {
                  id: "owner-grant",
                  subject: "owner",
                  resource: "*",
                  action: "*",
                  effect: "allow",
                },
                {
                  id: "fleet-write",
                  subject: user.id,
                  resource: "fleet_vehicle",
                  action: "write",
                  effect: "allow",
                },
              ]}
            >
              <CurrencyFormatProvider defaultCode="RWF" locale="en">
                <VehiclePageClient organizationId={7} vehicleId={id} />
              </CurrencyFormatProvider>
            </RBACProvider>
          </ErpSessionProvider>
        </I18nProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
  )
}
