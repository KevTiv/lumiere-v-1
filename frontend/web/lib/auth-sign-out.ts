/**
 * Client sign-out: clears PostHog identity/session, POSTs `/api/auth/signout`, then hard-navigates
 * (WorkOS returns redirects; Rust api-server returns JSON `{ redirectTo }`).
 */

import { phReset } from "@/lib/posthog-browser"

function assignLocation(pathOrUrl: string) {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    window.location.assign(pathOrUrl)
  } else {
    window.location.assign(pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`)
  }
}

/** Clears analytics identity, clears server/session cookies, then leaves the SPA. */
export async function performSignOut(): Promise<void> {
  phReset()

  try {
    const res = await fetch("/api/auth/signout", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
    })

    // Some browsers use opaque redirects; we can't read Location.
    if (res.type === "opaqueredirect") {
      assignLocation("/sign-in")
      return
    }

    const loc = res.headers.get("Location")
    if (
      loc &&
      (res.status === 301 ||
        res.status === 302 ||
        res.status === 303 ||
        res.status === 307 ||
        res.status === 308)
    ) {
      assignLocation(loc)
      return
    }

    if (res.ok) {
      const ct = res.headers.get("content-type") ?? ""
      if (ct.includes("application/json")) {
        let redirectTo = "/sign-in"
        try {
          const data = (await res.json()) as { redirectTo?: string }
          if (typeof data.redirectTo === "string" && data.redirectTo.length > 0) {
            redirectTo = data.redirectTo
          }
        } catch {
          /* use default */
        }
        assignLocation(redirectTo)
        return
      }
    }

    assignLocation("/sign-in")
  } catch {
    assignLocation("/sign-in")
  }
}
