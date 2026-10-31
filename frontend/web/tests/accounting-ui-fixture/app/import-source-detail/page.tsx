"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { CurrencyFormatProvider } from "@lumiere/ui/lib/currency-context"
import {
  productDetailConfig,
  productsTableConfig,
  stockLocationDetailConfig,
  stockLocationsTableConfig,
} from "@lumiere/ui/lib/inventory-entity-configs"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import type { ModuleConfig } from "@lumiere/ui/lib/module-types"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { ModuleView } from "@lumiere/ui/pages/module-view"
import { webApi } from "../../../../lib/lumiere-web-http"

function useFixtureRows(resource: "products" | "stock-locations") {
  const { identity, organizationId, activeCompanyId, activeCompanyReady } =
    useErpSession()
  return useQuery({
    queryKey: [
      "import-source-detail-fixture",
      resource,
      identity,
      organizationId,
      activeCompanyId,
    ],
    enabled: activeCompanyReady && identity != null && activeCompanyId != null,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/query/${resource}?companyId=${activeCompanyId}`,
        {
          signal,
          headers: {
            "x-fixture-actor": identity ?? "",
            "x-fixture-organization": String(organizationId),
          },
        },
      )
      if (!response.ok) throw new Error("Synthetic record read failed")
      const body = (await response.json()) as {
        data: Record<string, unknown>[]
      }
      return body.data
    },
  })
}

function DetailWorkspace({
  onActorSwitch,
  onOrganizationSwitch,
}: {
  onActorSwitch: () => void
  onOrganizationSwitch: () => void
}) {
  const { t } = useTranslation()
  const { identity, organizationId, activeCompanyId, setActiveCompanyId } =
    useErpSession()
  const products = moduleCollection(useFixtureRows("products"))
  const locations = moduleCollection(useFixtureRows("stock-locations"))
  useEffect(() => {
    // A session can change outside the open modal, for example in another tab.
    const channel = new BroadcastChannel("synthetic-import-detail-controls")
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "actor") onActorSwitch()
      if (event.data === "company") setActiveCompanyId?.(9002)
      if (event.data === "organization") onOrganizationSwitch()
    }
    return () => channel.close()
  }, [onActorSwitch, onOrganizationSwitch, setActiveCompanyId])
  const config = useMemo<ModuleConfig>(
    () => ({
      id: "import-source-detail-fixture",
      title: "Imported records",
      defaultTab: "products",
      tabs: [
        {
          id: "products",
          label: "Products",
          type: "entity",
          entityConfig: productsTableConfig(t),
          recordSheet: {
            titleKey: "name",
            detailConfig: productDetailConfig(t),
            auditTableName: "product",
          },
        },
        {
          id: "locations",
          label: "Locations",
          type: "entity",
          entityConfig: stockLocationsTableConfig(t),
          recordSheet: {
            titleKey: "name",
            detailConfig: stockLocationDetailConfig(t),
            auditTableName: "stock_location",
          },
        },
      ],
    }),
    [t],
  )
  return (
    <main className="p-6">
      <p className="mb-4 text-sm text-muted-foreground">
        Synthetic authorized records; production inventory tables and record
        detail sheets. No live ERP effects.
      </p>
      <div className="mb-4 flex gap-4">
        <button type="button" onClick={onActorSwitch}>
          Change detail actor
        </button>
        <button type="button" onClick={() => setActiveCompanyId?.(9002)}>
          Change detail company
        </button>
        <button type="button" onClick={onOrganizationSwitch}>
          Change observed organization
        </button>
      </div>
      <CurrencyFormatProvider defaultCode="RWF" locale="en">
        <ModuleView
          // Mirror InventoryClient's loaded organization (8001) during a session switch.
          key={`${identity ?? "anonymous"}:${organizationId ?? "no-organization"}:8001:${activeCompanyId}`}
          config={config}
          data={{ products: products.rows, locations: locations.rows }}
          dataState={{ products: products.state, locations: locations.state }}
        />
      </CurrencyFormatProvider>
    </main>
  )
}

export default function Page() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  )
  const [actor, setActor] = useState("ab".repeat(32))
  const [organization, setOrganization] = useState(8001)
  const switchActor = useCallback(() => setActor("cd".repeat(32)), [])
  const switchOrganization = useCallback(() => setOrganization(8002), [])
  return (
    <LumiereApiProvider client={webApi}>
      <QueryClientProvider client={client}>
        <I18nProvider language="en">
          <RBACProvider useDefaultFixtures>
            <ErpSessionProvider
              value={{
                identity: actor,
                connected: true,
                organizationId: organization,
                companyIds: [9001, 9002],
              }}
            >
              <ThemeProvider defaultTheme="light">
                <DetailWorkspace
                  onActorSwitch={switchActor}
                  onOrganizationSwitch={switchOrganization}
                />
              </ThemeProvider>
            </ErpSessionProvider>
          </RBACProvider>
        </I18nProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
  )
}
