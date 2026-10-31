import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CompanySetupWorkspace } from "../../../../web/lib/company-setup-workspace"

const state = vi.hoisted(() => ({
  session: {
    identity: "owner-a",
    organizationId: 1,
    activeCompanyId: 7,
    activeCompanyReady: true,
  },
  allowed: true,
  refetch: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  companies: [
    {
      id: 7,
      name: "Mugisha Farm",
      code: "FARM",
      addressCountryCode: "RW",
      currencyId: 4,
      taxId: "",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
    },
    {
      id: 8,
      name: "Other company",
      code: "OTHER",
      addressCountryCode: "KE",
      currencyId: 4,
      taxId: "",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
    },
  ],
}))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => state.session }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }))
vi.mock("@lumiere/ui/lib/rbac-context", () => ({
  useRBAC: () => ({ checkPermission: () => ({ allowed: state.allowed }) }),
}))
vi.mock("@lumiere/query-hooks/hooks/organization-company", () => ({
  useCompanies: () => ({ data: state.companies, refetch: state.refetch }),
  useCreateCompany: () => ({ mutateAsync: state.create }),
  useUpdateCompany: () => ({ mutateAsync: state.update }),
}))
vi.mock("@lumiere/query-hooks/hooks/settings", () => ({
  useCurrencies: () => ({
    data: [{ id: 4, name: "Rwandan Franc", code: "RWF" }],
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/inventory/uom", () => ({
  useUoms: () => ({ data: [] }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const workspace = (organizationId = 1) => (
  <StrictMode>
    <CompanySetupWorkspace organizationId={organizationId} />
  </StrictMode>
)

beforeEach(() => {
  localStorage.clear()
  state.session = {
    identity: "owner-a",
    organizationId: 1,
    activeCompanyId: 7,
    activeCompanyReady: true,
  }
  state.allowed = true
  state.refresh.mockReset()
  state.refetch.mockReset()
  state.create.mockReset().mockResolvedValue(undefined)
  state.update.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, "locks")
})

async function confirmSetup(create: boolean) {
  if (create) {
    fireEvent.change(screen.getByLabelText("Company to set up"), {
      target: { value: "new" },
    })
    fireEvent.change(screen.getByLabelText("Company name"), {
      target: { value: "New farm" },
    })
    fireEvent.change(screen.getByLabelText("Company code"), {
      target: { value: "NEWFARM" },
    })
    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: "RW" },
    })
    fireEvent.change(screen.getByLabelText("Base currency"), {
      target: { value: "4" },
    })
  } else
    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: "KE" },
    })
  fireEvent.click(screen.getByRole("button", { name: "Review linked setup" }))
  fireEvent.click(
    screen.getByRole("button", {
      name: create ? "Confirm and create company" : "Confirm company details",
    }),
  )
}

describe("company setup operation lifetime", () => {
  it.each([false, true])("refreshes company admission after a saved create, including a lost reply: %s", async (lostReply) => {
    state.refetch.mockImplementation(async () => ({
      data: state.create.mock.calls.length
        ? [{ ...state.companies[0], ...state.create.mock.calls[0][0], id: 9 }]
        : state.companies,
    }))
    if (lostReply) state.create.mockRejectedValueOnce(new Error("lost reply"))
    render(workspace())
    await confirmSetup(true)
    if (lostReply) fireEvent.click(await screen.findByRole("button", { name: "Check saved company" }))
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce())
    expect(state.create).toHaveBeenCalledOnce()
  })

  it.each([
    "unmount",
    "actor roundtrip",
    "company roundtrip",
    "organization roundtrip",
    "permission roundtrip",
  ])(
    "does not dispatch an existing-company update after %s during the preflight read",
    async (change) => {
      const read = deferred<{ data: typeof state.companies }>()
      state.refetch.mockReturnValue(read.promise)
      const view = render(workspace())
      await confirmSetup(false)
      await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce())
      if (change === "unmount") view.unmount()
      else if (change === "company roundtrip") {
        state.session.activeCompanyId = 8
        view.rerender(workspace())
        state.session.activeCompanyId = 7
        view.rerender(workspace())
      } else if (change === "actor roundtrip") {
        state.session.identity = "owner-b"
        view.rerender(workspace())
        state.session.identity = "owner-a"
        view.rerender(workspace())
      } else if (change === "organization roundtrip") {
        state.session.organizationId = 2
        view.rerender(workspace(2))
        state.session.organizationId = 1
        view.rerender(workspace())
      } else {
        state.allowed = false
        view.rerender(workspace())
        state.allowed = true
        view.rerender(workspace())
      }
      await act(async () => {
        read.resolve({ data: state.companies })
        await read.promise
      })
      expect(state.update).not.toHaveBeenCalled()
      expect(state.create).not.toHaveBeenCalled()
    },
  )

  it("does not create a company after its preflight owner unmounts", async () => {
    const read = deferred<{ data: typeof state.companies }>()
    state.refetch.mockReturnValue(read.promise)
    const view = render(workspace())
    await confirmSetup(true)
    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => {
      read.resolve({ data: state.companies })
      await read.promise
    })
    expect(state.create).not.toHaveBeenCalled()
  })

  it("validates the captured lease again when the browser grants a save lock", async () => {
    const grant = deferred<void>()
    const request = vi.fn(
      (_key, _options, callback: (lock: unknown) => Promise<unknown>) =>
        grant.promise.then(() => callback({ name: "setup" })),
    )
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    })
    const view = render(workspace())
    await confirmSetup(false)
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    state.allowed = false
    view.rerender(workspace())
    state.allowed = true
    view.rerender(workspace())
    await act(async () => {
      grant.resolve()
      await grant.promise
    })
    expect(state.refetch).not.toHaveBeenCalled()
    expect(state.create).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })
})
