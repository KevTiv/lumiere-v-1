import { afterEach } from "vitest"

// Forms autosave drafts to localStorage; one test must never restore another's draft.
afterEach(() => {
  try {
    globalThis.localStorage?.clear()
  } catch {
    // Storage is unavailable in this environment.
  }
})
