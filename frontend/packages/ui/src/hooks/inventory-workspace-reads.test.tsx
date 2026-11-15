import { createElement, type ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "../../../query-hooks/node_modules/@tanstack/react-query";
import { isInventoryWorkspaceReadEnabled, type InventoryWorkspace } from "../../../stdb/src/subscriptions/inventory-workspace";

const state = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ activeCompanyId: 41, activeCompanyReady: true }) }));
vi.mock("../../../query-hooks/src/http", () => ({
  apiFetch: vi.fn(), fetchQueryList: state.rows, rqBigIntKey: String,
  coalesceQueryInitialData: (rows: unknown) => rows,
}));
import { useProducts } from "../../../query-hooks/src/hooks/inventory/products";
import { useQualityAlerts, useQualityChecks } from "../../../query-hooks/src/hooks/inventory/quality";
import { usePickingWaves, useStockLocations, useStockQuants } from "../../../query-hooks/src/hooks/inventory/stock-operations";
import { useWarehouse3D } from "../../../query-hooks/src/hooks/inventory/warehouses";

afterEach(() => { cleanup(); state.rows.mockReset(); });

it("activates bounded reads across workspace changes and keeps excluded reads idle after invalidation", async () => {
  state.rows.mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(({ workspace }: { workspace: InventoryWorkspace }) => {
    const enabled = (resource: string) => isInventoryWorkspaceReadEnabled(workspace, resource);
    const products = useProducts(7n, undefined, enabled("products"));
    const quants = useStockQuants(7n, undefined, enabled("stock-quants"));
    const locations = useStockLocations(7n, undefined, enabled("stock-locations"));
    const quality = useQualityChecks(7n, undefined, enabled("quality-checks"));
    const waves = usePickingWaves(7n, undefined, enabled("picking-waves"));
    const view = useWarehouse3D(7n, 41n, 5n, workspace === "inventory");
    return { products, quants, locations, quality, waves, view };
  }, { initialProps: { workspace: "products" }, wrapper });
  await waitFor(() => expect(hook.result.current.products.isSuccess).toBe(true));
  expect(state.rows.mock.calls.map(([path]) => path)).toEqual(["/api/query/products"]);
  expect(hook.result.current.quants.fetchStatus).toBe("idle");

  hook.rerender({ workspace: "warehouse" });
  await waitFor(() => expect(hook.result.current.quants.isSuccess).toBe(true));
  expect(state.rows.mock.calls.map(([path]) => path)).toContain("/api/query/stock-locations?companyId=41");
  await client.invalidateQueries();
  expect(state.rows.mock.calls.map(([path]) => path)).not.toContain("/api/query/quality-checks");
  expect(state.rows.mock.calls.map(([path]) => path)).not.toContain("/api/query/picking-waves");
  expect(state.rows.mock.calls.map(([path]) => path)).not.toContain("/api/query/warehouse-3d-zones");
  expect(hook.result.current.quality.data).toBeUndefined();

  hook.rerender({ workspace: "inventory" });
  await waitFor(() => expect(hook.result.current.quality.isSuccess).toBe(true));
  expect(state.rows.mock.calls.map(([path]) => path)).toContain("/api/query/picking-waves");
  expect(state.rows.mock.calls.map(([path]) => path)).toContain("/api/query/warehouse-3d-zones");
  client.clear();
});

it("preserves a denied required read as an error rather than inventing empty stock", async () => {
  state.rows.mockRejectedValue(new Error("Stock read denied"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useStockQuants(7n, undefined, isInventoryWorkspaceReadEnabled("warehouse", "stock-quants")), { wrapper });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  client.clear();
});

it("keeps quality alerts independent from quality checks and caches them per company", async () => {
  state.rows.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/query/quality-checks")) {
      throw Object.assign(new Error("Checks denied"), { status: 403 });
    }
    if (path === "/api/query/quality-alerts?companyId=41") return [{ id: "501" }];
    if (path === "/api/query/quality-alerts?companyId=42") {
      throw Object.assign(new Error("Alerts failed"), { status: 500 });
    }
    return [];
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(({ companyId }: { companyId: bigint }) => ({
    checks: useQualityChecks(7n, undefined, true, companyId),
    alerts: useQualityAlerts(7n, undefined, true, companyId),
  }), { initialProps: { companyId: 41n }, wrapper });

  await waitFor(() => expect(hook.result.current.checks.isError).toBe(true));
  expect(hook.result.current.alerts.data).toEqual([{ id: "501" }]);
  hook.rerender({ companyId: 42n });
  await waitFor(() => expect(hook.result.current.alerts.isError).toBe(true));
  expect(hook.result.current.alerts.data).toBeUndefined();

  hook.rerender({ companyId: 43n });
  await waitFor(() => expect(hook.result.current.alerts.isSuccess).toBe(true));
  expect(hook.result.current.alerts.data).toEqual([]);
  client.clear();
});
