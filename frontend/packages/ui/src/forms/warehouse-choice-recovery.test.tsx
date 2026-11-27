import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { useWarehouseChoice } from "../../../../web/lib/use-warehouse-choice"
import { withFormChoiceSetup } from "../lib/form-choice-setup"
import { mergeSelectOptionsForFields } from "../lib/form-config-merge"
import type { FormConfig } from "../lib/form-types"
import { FormModal } from "./form-modal"

const source = vi.hoisted(() => ({
  data: [] as Array<{ id: string; organizationId: string; companyId: string; name: string; active: boolean }>,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: undefined as { status: number } | undefined,
  refetch: vi.fn(),
  canSetUp: true,
}))
const useWarehouses = vi.hoisted(() => vi.fn(() => source))

vi.mock("@lumiere/query-hooks/hooks/inventory", () => ({ useWarehouses }))
vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => ({ activeCompanyReady: true, organizationId: 4 }),
}))
vi.mock("@lumiere/ui/lib/rbac-context", () => ({
  useRBAC: () => ({
    permissionsReady: true,
    checkPermission: (resource: string, action: string) => ({
      allowed: source.canSetUp || resource !== "warehouse" || action !== "create",
    }),
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

const config: FormConfig = {
  id: "test-quotation",
  title: "Quotation",
  submitLabel: "Save",
  sections: [{ id: "identity", fields: [
    { id: "reference", name: "reference", type: "text", label: "Reference" },
    { id: "warehouseId", name: "warehouseId", type: "select", label: "Warehouse", required: true, searchable: true, options: [] },
  ] }],
}

function Quotation({ save }: { save: (values: Record<string, unknown>) => void }) {
  const warehouse = useWarehouseChoice(4n, 22n)
  const currentConfig = withFormChoiceSetup(
    mergeSelectOptionsForFields(config, { warehouseId: warehouse.options }),
    { warehouseId: warehouse.help },
  )
  return <FormModal open onOpenChange={() => {}} config={currentConfig} onSubmit={save} draft={false} showSubmitSuccessToast={false} />
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  source.data = []
  source.isError = false
  source.isLoading = false
  source.isFetching = false
  source.error = undefined
  source.canSetUp = true
  vi.clearAllMocks()
})

it("preserves quotation inputs until the authorized company warehouse reads back", async () => {
  const save = vi.fn()
  const { rerender } = render(<Quotation save={save} />)
  const link = screen.getByRole("link", { name: /Warehouse setup/ })
  expect(link.getAttribute("href")).toBe("/warehouse?tab=warehouses&companyId=22")
  expect(link.getAttribute("target")).toBe("_blank")
  expect(useWarehouses).toHaveBeenCalledWith(4n, undefined, true, 22n)
  fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "Keep this" } })

  source.isFetching = true
  source.data = [{ id: "1", organizationId: "4", companyId: "23", name: "Other company", active: true }]
  rerender(<Quotation save={save} />)
  expect(screen.getByText("Checking warehouses for this company…")).toBeTruthy()
  expect(screen.queryByRole("link", { name: /Warehouse setup/ })).toBeNull()
  expect(save).not.toHaveBeenCalled()

  source.isFetching = false
  source.data.push({ id: "9007199254740999", organizationId: "4", companyId: "22", name: "Central warehouse", active: true })
  source.data = [...source.data]
  rerender(<Quotation save={save} />)
  expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe("Keep this")
  fireEvent.click(screen.getByTestId("form-field-warehouseId"))
  expect(screen.queryByRole("option", { name: "Other company" })).toBeNull()
  fireEvent.click(await screen.findByRole("option", { name: "Central warehouse" }))
  fireEvent.click(screen.getByTestId("form-submit-test-quotation"))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ reference: "Keep this", warehouseId: "9007199254740999" }))
})

it("offers retry for a failed read and explains both denial and genuine emptiness", () => {
  const save = vi.fn()
  source.isError = true
  source.error = { status: 500 }
  const { rerender } = render(<Quotation save={save} />)
  expect(screen.getByText(/Warehouses could not be verified/)).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  expect(source.refetch).toHaveBeenCalledOnce()
  source.error = { status: 403 }
  rerender(<Quotation save={save} />)
  expect(screen.getByText(/You do not have permission to view warehouses/)).toBeTruthy()
  expect(screen.queryByRole("link", { name: /Warehouse setup/ })).toBeNull()
  source.isError = false
  source.canSetUp = false
  rerender(<Quotation save={save} />)
  expect(screen.getByText(/Ask your administrator to complete Warehouse setup/)).toBeTruthy()
  expect(screen.queryByRole("link", { name: /Warehouse setup/ })).toBeNull()
})
