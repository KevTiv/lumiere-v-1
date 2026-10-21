import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { withoutPkceCookie } from "./workos-pkce-cookie"

describe("proxy PKCE cookie handling", () => {
  it("drops only the verifier cookie and keeps the rest", () => {
    const source = new Headers({ "x-keep": "1" })
    source.append("Set-Cookie", "wos-auth-verifier=abc; Path=/; Secure")
    source.append("Set-Cookie", "wos-session=sealed; Path=/; HttpOnly")
    const result = withoutPkceCookie(source)
    assert.deepEqual(result.getSetCookie(), ["wos-session=sealed; Path=/; HttpOnly"])
    assert.equal(result.get("x-keep"), "1")
  })

  it("leaves headers without cookies unchanged", () => {
    const result = withoutPkceCookie(new Headers({ "x-a": "b" }))
    assert.equal(result.getSetCookie().length, 0)
    assert.equal(result.get("x-a"), "b")
  })
})
