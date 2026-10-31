"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErpSessionProvider } from "@lumiere/erp-session";
import { I18nProvider, useTranslation } from "@lumiere/i18n";
import { ModuleView, CurrencyFormatProvider } from "@lumiere/ui";
import { RBACProvider } from "@lumiere/ui/lib/rbac-context";
import { ThemeProvider } from "@lumiere/ui/components/theme-provider";
import { fleetVehiclesTableConfig } from "@lumiere/ui/lib/fleet-entity-configs";
import { productsTableConfig } from "@lumiere/ui/lib/inventory-entity-configs";
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types";
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state";
import {
  fleetModuleConfig,
  inventoryModuleConfig,
} from "../../../../lib/module-dashboard-configs";
import {
  productCatalogCategoryRows,
  productCatalogRows,
  productCatalogTable,
  productCatalogWorkspace,
} from "../../../../app/(modules)/inventory/product-catalog";
import {
  warehouseRows,
  warehouseWorkspace,
} from "../../../../app/(modules)/inventory/warehouse-workspace";
import {
  fleetHistoryRows,
  fleetVehicleRows,
  fleetVehicleTypes,
} from "../../../../app/(modules)/fleet/fleet-workspace";

// Deliberately synthetic. No request hook or mutation owner is mounted here.
const products = [
  {
    id: "41",
    name: "Arabica coffee beans",
    defaultCode: "COF-001",
    type: "product",
    categId: "12",
    uomId: "13",
    standardPrice: 4800,
    saleOk: true,
    purchaseOk: true,
    active: true,
  },
  {
    id: "42",
    name: "Black tea",
    defaultCode: "TEA-002",
    type: "product",
    categId: "12",
    uomId: "13",
    standardPrice: 3200,
    saleOk: true,
    purchaseOk: true,
    active: true,
  },
  {
    id: "43",
    name: "Reusable delivery crate",
    defaultCode: "PKG-003",
    type: "consu",
    categId: "14",
    uomId: "15",
    standardPrice: 7500,
    saleOk: false,
    purchaseOk: true,
    active: true,
  },
  {
    id: "44",
    name: "Vehicle inspection",
    defaultCode: "SVC-004",
    type: "service",
    categId: "16",
    uomId: "15",
    standardPrice: 20000,
    saleOk: true,
    purchaseOk: false,
    active: false,
  },
];
const categories = [
  { id: "12", name: "Beverages" },
  { id: "14", name: "Packaging" },
  { id: "16", name: "Services" },
];
const units = [
  { id: "13", name: "kg" },
  { id: "15", name: "Unit" },
];
const vehicles = [
  {
    id: "71",
    name: "Kigali delivery van",
    license_plate: "RAG 281 C",
    vehicle_type: "van",
    driver_name: "Alex Mugisha",
    status: "Active",
    odometer_km: 18420,
    last_position_at: "2026-10-30T08:30:00Z",
  },
  {
    id: "72",
    name: "Musanze supply truck",
    license_plate: "RAD 442 A",
    vehicle_type: "truck",
    driver_name: "Sam Uwimana",
    status: "Maintenance",
    odometer_km: 52600,
    last_position_at: "2026-10-29T14:10:00Z",
  },
  {
    id: "73",
    name: "City service car",
    license_plate: "RAE 018 B",
    vehicle_type: "car",
    driver_name: "",
    status: "Idle",
    odometer_km: 9100,
  },
];
const services = [
  {
    id: "81",
    vehicle_id: "71",
    service_type_id: "91",
    serviced_at: "2026-10-30T08:30:00Z",
    odometer_km: 18420,
    provider: "Kigali garage",
    cost_amount: 45000,
    currency_id: "92",
    account_move_id: "9007199254740993",
    notes: "Oil and filter replacement",
  },
];
const locations = [
  {
    id: "21",
    name: "Stock",
    completeName: "Kigali / Stock",
    usage: "internal",
  },
  {
    id: "22",
    name: "Stock",
    completeName: "Musanze / Stock",
    usage: "internal",
  },
];
const stock = [
  {
    id: "101",
    productId: "41",
    locationId: "21",
    quantity: 120,
    reservedQuantity: 20,
    availableQuantity: 100,
    inventoryQuantity: 118,
    inventoryQuantitySet: true,
    value: 576000,
  },
  {
    id: "102",
    productId: "42",
    locationId: "21",
    quantity: 80,
    reservedQuantity: 5,
    availableQuantity: 75,
    inventoryQuantity: 80,
    inventoryQuantitySet: true,
    value: 256000,
  },
  {
    id: "103",
    productId: "43",
    locationId: "22",
    quantity: 24,
    reservedQuantity: 4,
    availableQuantity: 20,
    inventoryQuantity: 23,
    inventoryQuantitySet: true,
    value: 180000,
  },
];

function Preview() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const module = params.get("module") ?? "products";
  const [retryCount, setRetryCount] = useState(0);
  const inventory = inventoryModuleConfig(t);
  const catalog = productCatalogWorkspace(inventory, t);
  const rows = fleetVehicleRows(vehicles);
  const fleet = fleetModuleConfig(t);
  const config =
    module === "fleet"
      ? {
          ...fleet,
          tabs: fleet.tabs.map((tab) =>
            ["fleet-vehicles", "fleet-driver-assignment"].includes(tab.id)
              ? {
                  ...tab,
                  entityConfig: fleetVehiclesTableConfig(t, {
                    vehicleTypes: fleetVehicleTypes(rows),
                  }),
                }
              : tab,
          ),
        }
      : module === "warehouse"
        ? warehouseWorkspace(inventory, t, locations)
        : {
            ...catalog,
            tabs: catalog.tabs.map((tab) =>
              tab.id === "products"
                ? {
                    ...tab,
                    entityConfig: productCatalogTable(
                      productsTableConfig(t),
                      categories,
                      t,
                    ),
                  }
                : tab,
            ),
          };
  const history = fleetHistoryRows(services, {
    vehicles: rows,
    serviceTypes: [{ id: "91", name: "Scheduled maintenance" }],
    employees: [],
    currencies: [{ id: "92", code: "RWF" }],
  });
  const requestedState = params.get("state");
  const state: ModuleDataState =
    requestedState === "denied"
      ? { status: "denied" }
      : requestedState === "error" && retryCount === 0
        ? {
            status: "error",
            onRetry: () => setRetryCount((count) => count + 1),
          }
        : { status: "ready" };
  const data: Record<string, EntityRow[]> = {
    products: productCatalogRows(products, categories, units),
    "product-categories": productCatalogCategoryRows(categories),
    "fleet-vehicles": rows,
    "fleet-driver-assignment": rows,
    "fleet-service-records": history,
    "fleet-inspections": [],
    stock: warehouseRows(stock, products, locations, units),
    locations,
    warehouses: [
      { id: "31", name: "Kigali warehouse", code: "KGL", active: true },
      { id: "32", name: "Musanze warehouse", code: "MSZ", active: true },
    ],
    transfers: [
      {
        id: "51",
        name: "INT-00051",
        state: "assigned",
        origin: "Stock replenishment",
        locationId: "21",
        locationDestId: "22",
        scheduledDate: "2026-10-30T08:30:00Z",
      },
    ],
  };
  const tabData = Object.fromEntries(
    config.tabs.map((tab) => [
      tab.id,
      params.get("empty") === "1" ? [] : (data[tab.id] ?? []),
    ]),
  );
  return (
    <main className="mx-auto min-w-0 max-w-7xl space-y-6 p-4 md:p-6">
      <p
        className="text-sm text-muted-foreground"
        data-testid="preview-disclosure"
      >
        Synthetic Products, Fleet and Warehouse preview. Production components;
        no ERP operations.
      </p>
      <nav
        aria-label="Preview workspaces"
        className="flex flex-wrap gap-4 text-sm"
      >
        <Link href="/product-fleet?module=products&tab=products">Products</Link>
        <Link href="/product-fleet?module=fleet">Fleet</Link>
        <Link href="/product-fleet?module=warehouse">Warehouse</Link>
      </nav>
      <ModuleView
        key={module}
        config={config}
        data={tabData}
        dataState={Object.fromEntries(
          config.tabs.map((tab) => [tab.id, state]),
        )}
        onFormSubmit={async () => {
          throw new Error("Synthetic preview: no record was saved.");
        }}
      />
    </main>
  );
}

export default function Page() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <RBACProvider useDefaultFixtures>
          <ErpSessionProvider
            value={{
              identity: null,
              connected: false,
              organizationId: 7,
              companyIds: [11],
            }}
          >
            <ThemeProvider defaultTheme="light">
              <CurrencyFormatProvider defaultCode="RWF" locale="en">
                <Preview />
              </CurrencyFormatProvider>
            </ThemeProvider>
          </ErpSessionProvider>
        </RBACProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
