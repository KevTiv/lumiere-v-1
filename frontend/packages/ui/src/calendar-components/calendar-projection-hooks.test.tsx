import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "../../../query-hooks/node_modules/@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { calendarProjectionQueryKey, useCalendarActivities, useCalendarContacts, useCalendarEvents } from "../../../query-hooks/src/hooks/calendar"

const state = vi.hoisted(() => ({ rows: vi.fn() }))
vi.mock("../../../query-hooks/src/http", () => ({ fetchQueryList: state.rows, rqBigIntKey: String }))
afterEach(() => { cleanup(); state.rows.mockReset() })

function pendingRead() {
  let resolve!: (rows: never[]) => void
  const promise = new Promise<never[]>((done) => { resolve = done })
  return { promise, resolve }
}

describe("calendar authorization projection requests", () => {
  for (const resource of ["calendar-events", "activities", "contacts"] as const) {
    it(`isolates an unresolved ${resource} read when the acting context changes`, async () => {
      const first = pendingRead()
      const second = pendingRead()
      state.rows.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
      // These unscoped rows are not proof for the scoped HTTP projection.
      client.setQueryData([resource, "9"], [{ id: "unscoped-secret" }])
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
      const hook = renderHook(({ actorScope }: { actorScope: string }) => {
        const scope = { key: actorScope, enabled: true }
        const events = useCalendarEvents(9n, [{ id: "unbound-SSR-secret" }] as never[], { ...scope, enabled: resource === "calendar-events" })
        const activities = useCalendarActivities(9n, { ...scope, enabled: resource === "activities" })
        const contacts = useCalendarContacts(9n, { ...scope, enabled: resource === "contacts" })
        return resource === "calendar-events" ? events : resource === "activities" ? activities : contacts
      }, { wrapper, initialProps: { actorScope: "actor-a/company-1/policy-a" } })
      try {
        await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(1))
        expect(hook.result.current.data).toBeUndefined()
        hook.rerender({ actorScope: "actor-b/company-2/policy-b" })
        await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(2))
        await act(async () => { first.resolve([{ id: "actor-a-secret" }] as never[]) })
        expect(hook.result.current.data).toBeUndefined()
        expect(hook.result.current.isSuccess).toBe(false)
        await act(async () => { second.resolve([{ id: "actor-b-record" }] as never[]) })
        await waitFor(() => expect(hook.result.current.data).toEqual([{ id: "actor-b-record" }]))
        expect(calendarProjectionQueryKey(resource, 9n, { key: "actor-a/company-1/policy-a", enabled: true })).not.toEqual(calendarProjectionQueryKey(resource, 9n, { key: "actor-b/company-2/policy-b", enabled: true }))
      } finally {
        hook.unmount()
        client.clear()
      }
    })
  }
})
