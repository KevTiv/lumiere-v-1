import { expect, test } from "@playwright/test"

const apiBase = process.env.LUMIERE_API_SERVER_URL ?? "http://127.0.0.1:8082"

test.describe("API surface hardening", { tag: ["@unauthenticated", "@p0"] }, () => {
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
