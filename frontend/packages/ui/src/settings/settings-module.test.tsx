import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { SettingsModule } from "./settings-module"
import { dataImportSection } from "../../../../web/app/(modules)/settings/data-import-section"

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { access, route } = vi.hoisted(() => ({
  access: { admin: false, allowed: false },
  route: { search: "" },
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(route.search),
}))
vi.mock("../../../../web/lib/data-import-workspace", () => ({ DataImportWorkspace: () => <div data-testid="alpha-import-surface" /> }))
vi.mock("../../../../web/components/available-history", () => ({ CompanyAvailableHistory: () => null }))
vi.mock("@/lib/rbac-context", () => ({ useRBAC: () => ({
  isAdmin: () => access.admin,
  checkPermission: () => ({ allowed: access.allowed }),
}) }))
vi.mock("./profile-settings", () => ({ ProfileSettings: () => <div data-testid="own-profile">Personal preferences</div> }))
vi.mock("./ai-settings", () => ({ AiSettings: () => <div /> }))
vi.mock("./user-management", () => ({ UserManagement: () => <div /> }))
vi.mock("./role-management", () => ({ RoleManagement: () => <div /> }))
vi.mock("./audit-log", () => ({ AuditLog: () => <div /> }))
vi.mock("./unified-form-config-settings", () => ({ UnifiedFormConfigSettings: () => <div /> }))
vi.mock("./user-custom-fields", () => ({ UserCustomFields: () => <div /> }))
vi.mock("./organization-settings", () => ({ OrganizationSettings: () => <div /> }))
vi.mock("./sso-settings", () => ({ SsoSettings: () => <div /> }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
afterEach(() => { access.admin = false; access.allowed = false; route.search = ""; document.body.innerHTML = "" })

it("keeps personal language settings accessible in the alpha without granting admin sections", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<SettingsModule firstOrgProfile />) })
  expect(host.querySelector('[data-testid="settings-section-my-profile"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="own-profile"]')).not.toBeNull()
  for (const id of ["users", "roles", "organization", "audit", "ai"]) {
    expect(host.querySelector(`[data-testid="settings-section-${id}"]`)).toBeNull()
  }
  await act(async () => root.unmount())
})

it("shows alpha administrators their personal preferences alongside the existing AI section", async () => {
  access.admin = true
  access.allowed = true
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<SettingsModule firstOrgProfile />) })
  expect(host.querySelector('[data-testid="settings-section-my-profile"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="settings-section-ai"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="settings-section-users"]')).toBeNull()
  await act(async () => root.unmount())
})

it("opens the alpha saved import handoff and falls back for an unadmitted settings section", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const sections = [dataImportSection(42)]
  route.search = `section=imports&importTask=${"a".repeat(32)}&importCompany=7&importView=results`
  await act(async () => { root.render(<SettingsModule firstOrgProfile extraSections={sections} />) })
  expect(host.querySelector('[data-testid="alpha-import-surface"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="settings-section-imports"]')?.getAttribute("aria-current")).toBe("page")
  expect(host.querySelector('[data-testid="own-profile"]')).toBeNull()

  route.search = "section=advanced"
  await act(async () => { root.render(<SettingsModule firstOrgProfile extraSections={sections} />) })
  expect(host.querySelector('[data-testid="alpha-import-surface"]')).toBeNull()
  expect(host.querySelector('[data-testid="settings-section-advanced"]')).toBeNull()
  expect(host.querySelector('[data-testid="own-profile"]')).not.toBeNull()
  await act(async () => root.unmount())
})
