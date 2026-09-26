import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import {
  expectAuthenticatedShell,
  expectReducerPermissionDenied,
  fetchSessionOrganizationId,
  signIn,
} from "./helpers"

type FixturePersona = {
  key: string
  email: string
  role_name: string
  managed_role: boolean
}

type FirstOrgFixture = {
  fixture_key: string
  password_env: string
  personas: FixturePersona[]
}

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/first-org-fixture.v1.json",
)
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FirstOrgFixture
const password = process.env[fixture.password_env] ?? "Password123$"

test.describe("COV-02 first-organization personas", { tag: ["@p0", "@cov02", "@unauthenticated"] }, () => {
  test.describe.configure({ mode: "serial" })

  for (const persona of fixture.personas) {
    test(`${persona.key} signs in and resolves the seeded organization`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      const page = await context.newPage()
      try {
        await signIn(page, persona.email, password)
        await expectAuthenticatedShell(page)
        const organizationId = await fetchSessionOrganizationId(page)
        expect(organizationId).toBeGreaterThan(0)

        const companies = await page.request.get("/api/query/companies")
        expect(companies.ok()).toBe(true)
        const companyRows = (await companies.json()) as { data?: unknown[] }
        expect(companyRows.data?.length ?? 0).toBeGreaterThan(0)
      } finally {
        await context.close()
      }
    })
  }

  for (const persona of fixture.personas.filter((candidate) => candidate.managed_role)) {
    test(`${persona.key} cannot administer organization roles`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      const page = await context.newPage()
      try {
        await signIn(page, persona.email, password)
        const organizationId = await fetchSessionOrganizationId(page)
        await expectReducerPermissionDenied(page, "create_role", [
          organizationId,
          {
            name: `forbidden-${persona.key}`,
            description: "COV-02 denied role-administration probe",
            parent_id: null,
            permissions: ["organization:read"],
            is_active: true,
            metadata: JSON.stringify({ fixture_key: fixture.fixture_key, probe: "denied" }),
          },
        ])
      } finally {
        await context.close()
      }
    })
  }
})
