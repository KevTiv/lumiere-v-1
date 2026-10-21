import { expect, test } from "@playwright/test"

const apiBase = process.env.LUMIERE_API_SERVER_URL ?? "http://127.0.0.1:8082"

test.describe("API surface hardening", { tag: ["@unauthenticated", "@p0"] }, () => {
  test('keeps public registration retired and credential bootstrap restricted to its service owner', async ({ request }) => {
    const account = { email: 'unapproved-alpha-probe@example.test', password: 'Password123$' }
    const signup = await request.post(`${apiBase}/v1/auth/signup`, { data: account })
    expect(signup.status()).toBe(410)
    const bootstrap = await request.post(`${apiBase}/v1/auth/internal/bootstrap-credential`, { data: account })
    expect(bootstrap.status()).toBe(401)
    const invalidBootstrap = await request.post(`${apiBase}/v1/auth/internal/bootstrap-credential`, {
      data: account, headers: { Authorization: 'Bearer invalid-fixture-owner-token' },
    })
    expect(invalidBootstrap.status()).toBe(401)
  })

  test("does not expose the retired direct SpacetimeDB routes", async ({ request }) => {
    for (const path of [
      "/v1/stdb/subscription-queries?resource=all",
      "/v1/stdb/v1/database/lumiere/sql",
    ]) {
      const response = await request.get(`${apiBase}${path}`)

      expect(response.status(), path).toBe(404)
    }
  })
})
