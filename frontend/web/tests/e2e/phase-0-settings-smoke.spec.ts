import { randomBytes } from "node:crypto"

import { expect, test } from "@playwright/test"

import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { postGeneratedOperationOk } from "./generated-operation"
import { matchesOperationResponse } from "./operation-response"
import {
  chooseSelectOptionByTriggerValue, expectNoAppError, fetchDefaultCompanyId,
  gotoModule, openSettingsSection, scalarQueryId, smokeName,
} from "./helpers"

/** Polished settings sections from `settings-module.tsx` / `rbac-defaults.ts`. */
const KEY_SETTINGS_SECTION_IDS = [
  "users",
  "organization",
  "audit",
  "profile",
  "roles",
] as const

test.describe("ERP phase-0 settings smoke @phase-0", () => {
  test("settings shell renders at /settings", async ({ page }) => {
    await gotoModule(page, "/settings")

    await expect(page.getByRole("heading", { name: /^settings$/i, level: 1 })).toBeVisible()
    await expect(page.getByText(/manage your account and system configuration/i)).toBeVisible()
    await expectNoAppError(page)
  })

  test("key settings sections render without app errors", async ({ page }) => {
    for (const sectionId of KEY_SETTINGS_SECTION_IDS) {
      await openSettingsSection(page, sectionId)
      await expect(page.getByTestId(`settings-section-${sectionId}`)).toHaveAttribute("aria-current", "page")
      await expect(page).toHaveURL(new RegExp(`[?&]section=${sectionId}(?:&|$)`))
    }

    await page.goto("/settings?section=integrations")
    await expect(page.getByRole("heading", { name: /^integrations$/i, level: 2 })).toBeVisible()
    await expectNoAppError(page)
  })

  test("invite user dialog opens and cancels without submitting", async ({ page }) => {
    await openSettingsSection(page, "users")

    const addUser = page.getByRole("button", { name: /add user/i })
    if ((await addUser.count()) === 0) {
      test.skip(true, "Test user lacks admin:users create permission")
    }

    await addUser.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("heading", { name: /create new user/i })).toBeVisible()

    await dialog.getByRole("button", { name: /^cancel$/i }).click()
    await expect(dialog).toBeHidden()
    await expectNoAppError(page)
  })
})


test("Settings creates a company-scoped setup lease through the member form", { tag: ["@p0"] }, async ({ page }) => {
  const roleName = smokeName("setup-empty-role")
  await postGeneratedOperationOk(page, "create_role", {
    params: stdbParamsToJson({
      name: roleName, description: null, parentId: null, permissions: [], isActive: true, metadata: null,
    }, "CreateRoleParams"),
  })
  const roleResponse = await page.request.get("/api/query/roles")
  expect(roleResponse.ok()).toBe(true)
  const roles = (await roleResponse.json()).data as Array<{ id: unknown; name: string; permissions: string[] }>
  const role = roles.find(row => row.name === roleName)
  expect(role?.permissions).toEqual([])
  const roleId = scalarQueryId(role?.id)
  if (roleId == null) throw new Error("setup role has no canonical id")
  const companyId = await fetchDefaultCompanyId(page)
  const identity = randomBytes(32).toString("hex")
  let created = false
  try {
    await openSettingsSection(page, "users")
    await page.getByRole("button", { name: "Add existing user (role ID)", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("User identity (hex)").fill(identity)
    await chooseSelectOptionByTriggerValue(page, dialog.getByRole("combobox", { name: "Roles" }), roleId)
    await dialog.getByLabel("Company ID (optional)", { exact: true }).fill(String(companyId))
    await dialog.getByRole("switch", { name: "Temporary setup access (one hour)", exact: true }).check()
    const [response] = await Promise.all([
      page.waitForResponse(reply => matchesOperationResponse(reply, "erp.add_user_to_organization")),
      dialog.getByRole("button", { name: "Add member", exact: true }).click(),
    ])
    expect(response.ok(), await response.text()).toBe(true)
    created = true
    await expect(dialog).toBeHidden()
    // The session membership query is intentionally restricted to the caller.
    // Observe the form's durable effect with the local fixture owner's SQL token.
    const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
    const moduleName = process.env.STDB_MODULE?.trim()
    const token = process.env.STDB_SERVER_TOKEN?.trim()
    if (!moduleName || !token) throw new Error("setup lease observer requires the local fixture owner")
    const result = await fetch(`${host}/v1/database/${moduleName}/sql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: `SELECT role_id, company_id, metadata FROM user_organization WHERE user_identity = 0x${identity}`,
    })
    expect(result.ok()).toBe(true)
    const tables = await result.json() as Array<{ rows: Array<[number, [number, unknown], [number, unknown]]> }>
    expect(tables).toHaveLength(1)
    expect(tables[0].rows).toHaveLength(1)
    const [savedRole, savedCompany, savedMetadata] = tables[0].rows[0]
    expect(savedRole).toBe(roleId)
    expect(savedCompany).toEqual([0, companyId])
    expect(savedMetadata[0]).toBe(0)
    const lease = String(savedMetadata[1])
    expect(lease).toMatch(/^lumiere-platform-bootstrap-v1:\d+:\d+$/)
    const [, issued, expires] = lease.split(":")
    expect(BigInt(expires) - BigInt(issued)).toBe(3_600_000_000n)
    expect(BigInt(expires)).toBeGreaterThan(BigInt(Date.now()) * 1000n)
  } finally {
    if (created) await postGeneratedOperationOk(page, "remove_user_from_organization", {
      userIdentity: { __identity__: `0x${identity}` },
    })
  }
})
