import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { SettingsModule } from "./settings-module"

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { access } = vi.hoisted(() => ({ access: { admin: false, allowed: false } }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
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
afterEach(() => { access.admin = false; access.allowed = false; document.body.innerHTML = "" })

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
