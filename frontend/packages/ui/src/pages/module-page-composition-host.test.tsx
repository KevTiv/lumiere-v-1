import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModulePageCompositionProvider,
  useModulePageComposition,
} from "../../../../web/lib/module-page-composition";
import { ModulePageComposition } from "./page-composition-host";
import type { DashboardSection, DashboardWidget } from "../lib/dashboard-types";
import type {
  PersonalPageLayoutResponse,
  SavePersonalPageLayoutRequest,
} from "@lumiere/presentation-core/personal-page-layout";

const fixture = vi.hoisted(() => ({
  company: 1,
  denied: new Set<string>(),
  rows: [] as Record<string, unknown>[],
  apiFetch: vi.fn(),
  fetchQueryList: vi.fn(),
  sources: {
    dataSources: { sale_order: [{ amount_total: 120, state: "sale" }] },
    sourceStates: { sale_order: { status: "ready", rowCount: 1 } },
  },
  requestResult: "",
}));
vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => ({ identity: "actor-a", organizationId: 1 }),
}));
vi.mock("@lumiere/query-hooks/hooks/use-operating-company", () => ({
  useOperatingCompanyId: () => fixture.company,
}));
vi.mock("@lumiere/query-hooks/hooks/stdb", () => ({
  stdbQueryKey: (resource: string, org: bigint) => [
    "stdb",
    resource,
    String(org),
  ],
}));
vi.mock("@lumiere/query-hooks/http", () => ({
  apiFetch: fixture.apiFetch,
  fetchQueryList: fixture.fetchQueryList,
}));
vi.mock("@lumiere/ui/lib/rbac-context", () => ({
  useRBAC: () => ({
    permissionsReady: true,
    checkPermission: (resource: string, action: string) => ({
      allowed:
        !fixture.denied.has(resource) &&
        !fixture.denied.has(`${resource}:${action}`),
    }),
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(
        options?.defaultValue ?? (key === "common.cancel" ? "Cancel" : key),
      ).replace(/\{\{(\w+)\}\}/g, (_, field: string) =>
        String(options?.[field] ?? ""),
      ),
  }),
}));
vi.mock("@/hooks/use-stored-dashboard-data-sources", () => ({
  useStoredDashboardDataSources: () => fixture.sources,
}));
vi.mock("./dashboard-widget-renderer", () => ({
  DashboardWidgetRenderer: ({ widget }: { widget: DashboardWidget }) => (
    <h3>{widget.title}</h3>
  ),
}));
vi.mock("@/app/(modules)/reports/query-builder", () => ({
  QueryBuilder: ({
    onCreated,
  }: {
    onCreated: (id: string) => Promise<void>;
  }) => (
    <button
      onClick={() => {
        fixture.rows.push({
          id: "9007199254740993",
          organizationId: "1",
          companyId: "1",
          isActive: true,
          name: "New revenue",
          model: "sale_order",
          widgetType: "kpi",
          aggregation: "count",
          fields: [],
        });
        void onCreated("9007199254740993");
      }}
    >
      Save configured metric
    </button>
  ),
}));

const sections: DashboardSection[] = [
  {
    id: "summary",
    title: "Sales",
    widgets: [
      {
        id: "revenue",
        type: "kpi",
        title: "Revenue",
        width: "1/2",
        data: { value: 120, label: "Revenue" },
      },
    ],
  },
];
const pages = new Map<string, PersonalPageLayoutResponse>();
const writes: { companyId: string; body: SavePersonalPageLayoutRequest }[] = [];
const clients: QueryClient[] = [];

function Assistant() {
  const composer = useModulePageComposition()!;
  return (
    <>
      <button
        onClick={() => {
          fixture.requestResult = composer.requestPage({
            requestId: "chat-add",
            scopeKey: composer.scopeKey!,
            moduleId: "sales",
            pageId: "dashboard",
            kind: "add_widget",
            widgetKey: "saved:42",
          });
        }}
      >
        Add from chat
      </button>
      <output data-testid="registered-page">
        {composer.page?.moduleId}:{composer.page?.pageId}
      </output>
    </>
  );
}

function App({ client }: { client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ModulePageCompositionProvider>
        <Assistant />
        <ModulePageComposition
          moduleId="sales"
          pageId="dashboard"
          title="Sales"
          sections={sections}
        >
          <p>Native sales content</p>
        </ModulePageComposition>
      </ModulePageCompositionProvider>
    </QueryClientProvider>
  );
}

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  return { ...render(<App client={client} />), client };
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
}
async function ready() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Edit page" })).toBeTruthy(),
  );
}

beforeEach(() => {
  fixture.company = 1;
  fixture.denied.clear();
  fixture.rows = [
    {
      id: "42",
      organizationId: "1",
      companyId: "1",
      isActive: true,
      name: "Order count",
      model: "sale_order",
      widgetType: "kpi",
      aggregation: "count",
      fields: [],
    },
  ];
  fixture.requestResult = "";
  pages.clear();
  writes.length = 0;
  fixture.fetchQueryList
    .mockReset()
    .mockImplementation(async () => fixture.rows);
  fixture.apiFetch
    .mockReset()
    .mockImplementation(async (path: string, init?: RequestInit) => {
      const companyId = new URL(path, "http://fixture").searchParams.get(
        "companyId",
      )!;
      const previous = pages.get(companyId) ?? {
        companyId,
        moduleId: "sales",
        pageId: "dashboard",
        revision: null,
        layout: null,
      };
      if (init?.method !== "PUT") return Response.json(previous);
      const body = JSON.parse(
        String(init.body),
      ) as SavePersonalPageLayoutRequest;
      writes.push({ companyId, body });
      if (body.expectedRevision !== previous.revision)
        return Response.json({ error: "Page changed" }, { status: 409 });
      const next = {
        ...previous,
        revision: String(Number(previous.revision ?? "0") + 1),
        layout: body.layout,
      };
      pages.set(companyId, next);
      return Response.json(next);
    });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("module page production host", () => {
  it("offers only active widget definitions with a verified current or shared company scope", async () => {
    const base = fixture.rows[0];
    fixture.rows.push(
      { ...base, id: "43", name: "Shared metric", companyId: null },
      { ...base, id: "44", name: "Other company metric", companyId: "2" },
      {
        ...base,
        id: "45",
        name: "Other organization metric",
        organizationId: "2",
      },
      { ...base, id: "46", name: "Unknown scope metric", companyId: undefined },
      { ...base, id: "47", name: "Conflicting scope metric", company_id: "2" },
      { ...base, id: "48", name: "Inactive metric", isActive: false },
      { ...base, id: "0049", name: "Noncanonical metric" },
    );
    mount();
    await ready();
    click("Edit page");
    click("Add widget");
    const gallery = within(screen.getByRole("dialog"));
    await waitFor(() =>
      expect(gallery.getByText("Shared metric")).toBeTruthy(),
    );
    expect(gallery.getByText("Order count")).toBeTruthy();
    for (const name of [
      "Other company metric",
      "Other organization metric",
      "Unknown scope metric",
      "Conflicting scope metric",
      "Inactive metric",
      "Noncanonical metric",
    ]) {
      expect(gallery.queryByText(name)).toBeNull();
    }
    expect(writes).toHaveLength(0);
  });

  it("stages a chat-selected saved widget, saves with CAS and restores it from the API on remount", async () => {
    const first = mount();
    await ready();
    await waitFor(() =>
      expect(screen.getByTestId("registered-page").textContent).toBe(
        "sales:dashboard",
      ),
    );
    click("Add from chat");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done" })).toBeTruthy(),
    );
    expect(fixture.requestResult).toBe("pending");
    expect(writes).toHaveLength(0);
    await waitFor(() => expect(screen.getByText("Order count")).toBeTruthy());
    click("Done");
    await ready();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      companyId: "1",
      body: {
        expectedRevision: null,
        layout: {
          schemaVersion: 1,
          moduleId: "sales",
          pageId: "dashboard",
          widgets: [
            {
              id: "builtin:summary:revenue",
              source: "builtin",
              widgetId: "revenue",
              width: 6,
            },
            expect.objectContaining({
              source: "saved",
              widgetId: "42",
              width: 6,
            }),
          ],
        },
      },
    });
    first.unmount();
    mount();
    await ready();
    expect(screen.getByText("Order count")).toBeTruthy();
    expect(screen.queryByText("Native sales content")).toBeNull();
  });

  it("adds a newly created metric only after authorized canonical readback and keeps its u64 identity", async () => {
    mount();
    await ready();
    click("Edit page");
    click("Add widget");
    const gallery = screen.getByRole("dialog");
    fireEvent.click(
      within(gallery).getByRole("button", { name: "Create new widget" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save configured metric" }),
      ).toBeTruthy(),
    );
    click("Save configured metric");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save configured metric" }),
      ).toBeNull(),
    );
    expect(writes).toHaveLength(0);
    click("Done");
    await ready();
    expect(writes[0]?.body.layout?.widgets.at(-1)?.widgetId).toBe(
      "9007199254740993",
    );
    expect(
      fixture.fetchQueryList.mock.calls.every(([url]) =>
        String(url).includes("companyId=1"),
      ),
    ).toBe(true);
  });

  it("keeps the draft after a competing revision and reopens the new saved revision after Cancel", async () => {
    mount();
    await ready();
    click("Edit page");
    click("Remove Revenue");
    pages.set("1", {
      companyId: "1",
      moduleId: "sales",
      pageId: "dashboard",
      revision: "9",
      layout: null,
    });
    click("Done");
    await waitFor(() =>
      expect(
        screen.getByText(/This page was changed in another session/),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(writes).toHaveLength(1);
    click("Cancel");
    await ready();
    click("Edit page");
    click("Remove Revenue");
    click("Done");
    await ready();
    expect(writes.at(-1)?.body.expectedRevision).toBe("9");
  });

  it("discards another company's unsaved view and hides editing after module permission is removed", async () => {
    const app = mount();
    await ready();
    click("Add from chat");
    await waitFor(() => expect(screen.getByText("Order count")).toBeTruthy());
    fixture.company = 2;
    app.rerender(<App client={app.client} />);
    await ready();
    expect(screen.queryByText("Order count")).toBeNull();
    expect(screen.getByText("Native sales content")).toBeTruthy();
    expect(writes).toHaveLength(0);
    await act(async () => {
      fixture.denied.add("module:sales");
      app.rerender(<App client={app.client} />);
    });
    expect(screen.queryByRole("button", { name: "Edit page" })).toBeNull();
    expect(screen.getByText("Native sales content")).toBeTruthy();
  });

  it("requires native create permission and hides cached widget data after read permission is removed", async () => {
    pages.set("1", {
      companyId: "1",
      moduleId: "sales",
      pageId: "dashboard",
      revision: "2",
      layout: {
        schemaVersion: 1,
        moduleId: "sales",
        pageId: "dashboard",
        widgets: [
          {
            id: "saved-order-count",
            source: "saved",
            widgetId: "42",
            width: 6,
          },
        ],
      },
    });
    fixture.denied.add("dashboard_widget:create");
    const app = mount();
    await ready();
    await waitFor(() => expect(screen.getByText("Order count")).toBeTruthy());
    click("Edit page");
    click("Add widget");
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", {
        name: "Create new widget",
      }),
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => {
      fixture.denied.add("dashboard_widget:read");
      app.rerender(<App client={app.client} />);
    });
    expect(screen.queryByText("Order count")).toBeNull();
    expect(screen.getByText("Widget unavailable")).toBeTruthy();
    expect(writes).toHaveLength(0);
  });
});
