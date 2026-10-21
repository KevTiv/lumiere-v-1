import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityAction, EntityRow, EntityTableConfig } from "../lib/entity-view-types"
import type { PolicyRule, Role, User } from "../lib/rbac-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"

vi.mock("../components/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}))
vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const rows: EntityRow[] = [{ id: "1", reference: "SO-001", state: "open" }]

const user: User = {
  id: "u1", email: "u@x.io", name: "U", roles: ["r1"], status: "active", createdAt: "", updatedAt: "",
}
const rule = (action: PolicyRule["action"]): PolicyRule => ({
  id: "p1", subject: "r1", resource: "sale_order", action, effect: "allow",
})
const role = (action: PolicyRule["action"]): Role => ({
  id: "r1", name: "Clerk", description: "", color: "blue", permissions: [rule(action)], createdAt: "", updatedAt: "",
})

function renderTable(
  config: Partial<EntityTableConfig>,
  data: EntityRow[],
  opts: { grant?: PolicyRule["action"]; props?: Partial<React.ComponentProps<typeof EntityTable>> } = {},
) {
  const full: EntityTableConfig = {
    mode: "table",
    rowKey: "id",
    columns: [{ key: "reference", label: "Reference" }],
    searchable: true,
    searchKeys: ["reference"],
    ...config,
  }
  return render(
    <RBACProvider initialUser={user} initialRoles={[role(opts.grant ?? "create")]} initialPolicies={[]}>
      <EntityTable config={full} data={data} {...opts.props} />
    </RBACProvider>,
  )
}

afterEach(cleanup)

const newAction = (onClick = vi.fn()): EntityAction => ({
  id: "new-order",
  label: "New order",
  permission: { resource: "sale_order", action: "create" },
  onClick,
})
const importAction = (onClick = vi.fn()): EntityAction => ({
  id: "csv-orders",
  label: "Import CSV",
  permission: { resource: "sale_order", action: "create" },
  onClick,
})

describe("EntityTable first-time empty state", () => {
  it("shows the onboarding card with the primary action's handler and the import action", () => {
    const onNew = vi.fn()
    const onImport = vi.fn()
    renderTable(
      {
        actions: [newAction(onNew), importAction(onImport)],
        emptyState: {
          title: "No orders yet",
          description: "Orders turn quotes into revenue.",
          primaryActionId: "new-order",
          secondaryActionId: "csv-orders",
          learnHint: "Quotes become orders once confirmed.",
        },
      },
      [],
    )
    expect(screen.getByTestId("entity-empty-first-time")).toBeTruthy()
    expect(screen.getByText("Orders turn quotes into revenue.")).toBeTruthy()
    expect(screen.getByTestId("entity-empty-hint")).toBeTruthy()
    fireEvent.click(screen.getByTestId("entity-empty-cta"))
    fireEvent.click(screen.getByTestId("entity-empty-secondary-cta"))
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledTimes(1)
  })

  it("replaces the CTA with a read-only message when the user lacks the action's permission", () => {
    renderTable(
      {
        actions: [newAction()],
        emptyState: { title: "No orders yet", primaryActionId: "new-order", readOnlyMessage: "Read only" },
      },
      [],
      { grant: "read" },
    )
    expect(screen.queryByTestId("entity-empty-cta")).toBeNull()
    expect(screen.getByTestId("entity-empty-read-only").textContent).toBe("Read only")
  })

  it("gates a legacy handler by emptyState.permission", () => {
    const onAction = vi.fn()
    const emptyState = {
      title: "No orders yet",
      actionLabel: "New order",
      onAction,
      permission: { resource: "sale_order", action: "create" as const },
    }
    renderTable({ emptyState }, [], { grant: "read" })
    expect(screen.queryByTestId("entity-empty-cta")).toBeNull()
    cleanup()
    renderTable({ emptyState }, [])
    fireEvent.click(screen.getByTestId("entity-empty-cta"))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it("keeps the plain 'No records yet' fallback without a configured empty state", () => {
    renderTable({}, [])
    expect(screen.getByText("No records yet")).toBeTruthy()
    expect(screen.getByTestId("entity-empty-first-time")).toBeTruthy()
  })
})

describe("EntityTable no-results state", () => {
  it("offers Clear filters when a search hides every row, and restores the rows", () => {
    renderTable({ emptyState: { title: "No orders yet" } }, rows)
    fireEvent.change(screen.getByRole("textbox", { name: "Search records" }), { target: { value: "zzz" } })
    expect(screen.getByTestId("entity-empty-no-results")).toBeTruthy()
    expect(screen.queryByTestId("entity-empty-first-time")).toBeNull()
    fireEvent.click(screen.getByTestId("entity-empty-clear-filters"))
    expect(screen.queryByTestId("entity-empty-no-results")).toBeNull()
    expect(screen.getByText("SO-001")).toBeTruthy()
  })

  it("treats an empty dataset behind a KPI tile as no-results and clears the tile", () => {
    const onClear = vi.fn()
    renderTable({ emptyState: { title: "No orders yet" } }, [], {
      props: { externalFilter: { active: true, onClear } },
    })
    expect(screen.getByTestId("entity-empty-no-results")).toBeTruthy()
    fireEvent.click(screen.getByTestId("entity-empty-clear-filters"))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("clears a parent-owned filter at its source", () => {
    const onInitialFilterClear = vi.fn()
    renderTable({}, rows, { props: { initialFilters: { state: "nope" }, onInitialFilterClear } })
    fireEvent.click(screen.getByTestId("entity-empty-clear-filters"))
    expect(onInitialFilterClear).toHaveBeenCalledWith("state")
  })
})
