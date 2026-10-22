import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { WorkspaceProfileProvider } from "../lib/workspace-profile-context"
import { UserCustomFields } from "./user-custom-fields"

vi.mock("@lumiere/i18n", () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ organizationId: 7 }) }))
vi.mock("@lumiere/stdb/browser-http", () => ({
  stdbBrowserQuery: async () => [
    { id: 1, organizationId: 7, moduleId: "accounting", formId: "invoice", name: "Finance invoice", isActive: true },
    { id: 2, organizationId: 7, moduleId: "hr", formId: "employee", name: "HR employee", isActive: true },
    { id: 3, organization_id: 7, module_id: "inventory", form_id: "product", name: "Stock product", is_active: true },
    { id: 4, organizationId: 8, moduleId: "accounting", formId: "invoice", name: "Other tenant", isActive: true },
    { id: 5, organizationId: 7, moduleId: "accounting", formId: "invoice", name: "Inactive invoice", isActive: false },
  ],
}))
vi.mock("../forms/hooks/use-form-config", () => ({
  useUserCustomFields: () => ({ customFields: [], addCustomField: vi.fn(), removeCustomField: vi.fn(), isLoading: false }),
}))

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO)
  Element.prototype.scrollIntoView = () => {}
})
afterEach(cleanup)

describe("Settings custom-field target discovery", () => {
  for (const profile of ["finance-alpha", "full"] as const) {
    it(`limits the ${profile} picker while retaining tenant and active-row filters`, async () => {
      render(<WorkspaceProfileProvider value={profile}><UserCustomFields /></WorkspaceProfileProvider>)
      await waitFor(() => expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(false))
      fireEvent.click(screen.getByRole("combobox"))
      await waitFor(() => expect(screen.getAllByRole("option").length).toBe(profile === "finance-alpha" ? 1 : 3))
      expect(screen.getByRole("option", { name: "Finance invoice (accounting/invoice)" })).toBeTruthy()
      expect(screen.queryByRole("option", { name: /Other tenant|Inactive invoice/ })).toBeNull()
      expect(Boolean(screen.queryByRole("option", { name: "HR employee (hr/employee)" }))).toBe(profile === "full")
      expect(Boolean(screen.queryByRole("option", { name: "Stock product (inventory/product)" }))).toBe(profile === "full")
    })
  }
})
