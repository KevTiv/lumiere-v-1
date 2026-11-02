import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { ModuleConfig } from "../lib/module-types"
import type { ModuleDataState } from "../lib/module-data-state"
import type { Role, User } from "../lib/rbac-types"
import { RBACProvider } from "../lib/rbac-context"
import {
  AssistantNativeFormProvider,
  useAssistantNativeFormController,
} from "../components/assistant-native-form-provider"

vi.mock("next/navigation", () => ({
  usePathname: () => "/sales",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=orders"),
}))
vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => ({
    identity: "actor-one",
    organizationId: 11,
    companyIds: [22],
  }),
}))
vi.mock("@lumiere/query-hooks/ai-ui-context", () => ({
  buildEntitySelection: vi.fn(),
  resolveAiEntityType: () => "sale_order",
}))
vi.mock("@lumiere/query-hooks/erp-ai-selection-context", () => ({
  useErpAiSelectionReporter: () => null,
  useErpAiSelectionState: () => ({ selection: null }),
}))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock("../lib/module-url-filters", () => ({
  useModuleUrlFilters: () => ({}),
  useClearModuleUrlFilter: () => vi.fn(),
}))
vi.mock("../entity-views/entity-view", () => ({
  EntityView: ({ headerAction }: { headerAction?: ReactNode }) => (
    <div>{headerAction}</div>
  ),
}))
vi.mock("../entity-views/entity-record-sheet", () => ({
  EntityRecordSheet: () => null,
}))
vi.mock("./dashboard-grid", () => ({ DashboardGrid: () => null }))
vi.mock("./dashboard-header", () => ({ DashboardHeader: () => null }))
vi.mock("../lib/export-dashboard-png", () => ({
  exportDashboardToPng: vi.fn(),
}))

import { ModuleView } from "./module-view"

// Production bridge, ModuleView, permission owner and FormModal/ModularForm.
// Synthetic module fields isolate orchestration; no native persistence is claimed.
const config: ModuleConfig = {
  id: "sales",
  title: "Sales",
  tabs: [
    {
      id: "orders",
      label: "Orders",
      type: "entity",
      entityConfig: {
        id: "orders-table",
        title: "Orders",
        view: { mode: "table", rowKey: "id", columns: [] },
      },
      createLabel: "New order",
      createAction: "createSaleOrder",
      createPermission: { resource: "sale_order", action: "create" },
      createForm: {
        id: "assistant-test-order",
        title: "Native order editor",
        submitLabel: "Save order",
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
    },
  ],
}
const user: User = {
  id: "actor-one",
  email: "actor@example.test",
  name: "Actor",
  roles: ["clerk"],
  status: "active",
  createdAt: "",
  updatedAt: "",
}
const role = (allowed: boolean): Role => ({
  id: "clerk",
  name: "Clerk",
  description: "",
  color: "blue",
  createdAt: "",
  updatedAt: "",
  permissions: allowed
    ? [
        {
          id: "create-order",
          subject: "clerk",
          resource: "sale_order",
          action: "create",
          effect: "allow",
        },
      ]
    : [],
})

function Fixture({
  scope = "actor-one:11:22",
  allowed = true,
  permissionsReady = true,
  state = { status: "ready" },
  submit = vi.fn(),
  bindSubmit = true,
}: {
  scope?: string
  allowed?: boolean
  permissionsReady?: boolean
  state?: ModuleDataState
  submit?: (
    tabId: string,
    action: string,
    values: Record<string, unknown>,
  ) => void
  bindSubmit?: boolean
}) {
  const controller = useAssistantNativeFormController(scope)
  return (
    <AssistantNativeFormProvider value={controller}>
      <button
        type="button"
        data-testid="request-native-form"
        onClick={() =>
          controller.requestForm({
            requestId: "first",
            scopeKey: scope,
            moduleId: "sales",
            tabId: "orders",
            prompt: "Create an order with my reference",
          })
        }
      >
        Prepare native form
      </button>
      <button
        type="button"
        data-testid="request-another-form"
        onClick={() =>
          controller.requestForm({
            requestId: "second",
            scopeKey: scope,
            moduleId: "sales",
            tabId: "orders",
            prompt: "Replace my existing reference",
          })
        }
      >
        Prepare another form
      </button>
      <output data-testid="native-form-outcome">
        {controller.outcome?.status ?? "none"}
      </output>
      <output data-testid="native-form-pending">
        {controller.pending?.requestId ?? "none"}
      </output>
      <RBACProvider
        initialUser={user}
        initialRoles={[role(allowed)]}
        initialPolicies={[]}
        permissionsReady={permissionsReady}
      >
        <ModuleView
          config={config}
          activeTab="orders"
          data={{ orders: [] }}
          dataState={{ orders: state }}
          onFormSubmit={bindSubmit ? submit : undefined}
        />
      </RBACProvider>
    </AssistantNativeFormProvider>
  )
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined")
    Object.defineProperty(globalThis, "PointerEvent", {
      value: MouseEvent,
      configurable: true,
    })
})
afterEach(cleanup)

describe("assistant requests through the native module form owner", () => {
  it("opens the existing editor once and does not submit or apply the assistant text", async () => {
    const submit = vi.fn()
    render(<Fixture submit={submit} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    expect(
      await screen.findByTestId("form-modal-assistant-test-order"),
    ).toBeTruthy()
    expect(
      screen.getAllByTestId("form-modal-assistant-test-order"),
    ).toHaveLength(1)
    expect(
      (screen.getByTestId("form-field-reference") as HTMLInputElement).value,
    ).toBe("")
    expect(screen.getByTestId("native-form-outcome").textContent).toBe("opened")
    expect(submit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId("form-field-reference"), {
      target: { value: "Reviewed order" },
    })
    fireEvent.click(screen.getByTestId("form-submit-assistant-test-order"))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("orders", "createSaleOrder", {
        reference: "Reviewed order",
      }),
    )
  })

  it("cannot use the assistant request to bypass the native create permission", async () => {
    render(<Fixture allowed={false} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    await waitFor(() =>
      expect(screen.getByTestId("native-form-outcome").textContent).toBe(
        "denied",
      ),
    )
    expect(screen.queryByTestId("form-modal-assistant-test-order")).toBeNull()
  })

  it("retains a pending request while permissions load and drops it on scope change", async () => {
    const view = render(<Fixture permissionsReady={false} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    expect(screen.getByTestId("native-form-pending").textContent).toBe("first")
    expect(screen.queryByTestId("form-modal-assistant-test-order")).toBeNull()
    view.rerender(<Fixture scope="actor-two:11:33" permissionsReady />)
    await waitFor(() =>
      expect(screen.getByTestId("native-form-pending").textContent).toBe(
        "none",
      ),
    )
    expect(screen.queryByTestId("form-modal-assistant-test-order")).toBeNull()
  })

  it("does not open a form from a denied collection", async () => {
    render(<Fixture state={{ status: "denied" }} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    await waitFor(() =>
      expect(screen.getByTestId("native-form-outcome").textContent).toBe(
        "denied",
      ),
    )
    expect(screen.queryByTestId("form-modal-assistant-test-order")).toBeNull()
  })

  it("does not advertise a working editor when there is no native submit binding", async () => {
    render(<Fixture bindSubmit={false} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    await waitFor(() =>
      expect(screen.getByTestId("native-form-outcome").textContent).toBe(
        "unavailable",
      ),
    )
    expect(screen.queryByTestId("form-modal-assistant-test-order")).toBeNull()
  })

  it("does not carry an opened assistant editor into another actor or company scope", async () => {
    const submit = vi.fn()
    const view = render(<Fixture submit={submit} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    fireEvent.change(await screen.findByTestId("form-field-reference"), {
      target: { value: "Prior company draft" },
    })
    view.rerender(<Fixture scope="actor-two:11:33" submit={submit} />)
    await waitFor(() =>
      expect(
        screen.queryByTestId("form-modal-assistant-test-order"),
      ).toBeNull(),
    )
    expect(submit).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue("Prior company draft")).toBeNull()
  })

  it("hides the assistant-owned editor when its native create permission is revoked", async () => {
    const submit = vi.fn()
    const view = render(<Fixture submit={submit} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    fireEvent.change(await screen.findByTestId("form-field-reference"), { target: { value: "Permission changed" } })
    view.rerender(<Fixture allowed={false} submit={submit} />)
    await waitFor(() => expect(screen.queryByTestId("form-modal-assistant-test-order")).toBeNull())
    expect(submit).not.toHaveBeenCalled()
  })

  it("preserves dirty native fields and the discard guard when another request arrives", async () => {
    const submit = vi.fn()
    render(<Fixture submit={submit} />)
    fireEvent.click(screen.getByTestId("request-native-form"))
    fireEvent.change(await screen.findByTestId("form-field-reference"), {
      target: { value: "My retained draft" },
    })
    fireEvent.click(screen.getByTestId("request-another-form"))
    await waitFor(() =>
      expect(screen.getByTestId("native-form-outcome").textContent).toBe(
        "busy",
      ),
    )
    expect(
      (screen.getByTestId("form-field-reference") as HTMLInputElement).value,
    ).toBe("My retained draft")
    expect(
      screen.getAllByTestId("form-modal-assistant-test-order"),
    ).toHaveLength(1)
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(await screen.findByTestId("discard-changes-dialog")).toBeTruthy()
    fireEvent.click(screen.getByTestId("discard-changes-keep"))
    expect(
      (screen.getByTestId("form-field-reference") as HTMLInputElement).value,
    ).toBe("My retained draft")
  })
})
