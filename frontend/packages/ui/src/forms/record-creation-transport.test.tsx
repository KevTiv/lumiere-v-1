import { act, cleanup, renderHook } from "@testing-library/react"
import { StrictMode, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const controls = vi.hoisted(() => ({ identity: "a".repeat(64), read: vi.fn(), post: vi.fn() }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: controls.identity }) }))
vi.mock("../../../query-hooks/src/http", () => ({ fetchQueryList: controls.read, apiFetch: controls.post }))
import { useRecordCreationTransport } from "../../../query-hooks/src/hooks/record-creation-http"

const payload = '{"name":"Ada","metadata":"{\\"custom:risk\\":false}"}'
const metadata = '{"custom:risk":false}'
const makeCommand = (metadata: string) => ({ urlPath: "/api/operations/erp.create_contact", init: { method: "POST", body: JSON.stringify({ params: { name: "Ada", metadata } }) } })

beforeEach(() => {
  controls.identity = "a".repeat(64)
  controls.read.mockReset()
  controls.post.mockReset()
  window.localStorage.clear()
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_key: string, body: () => Promise<void>) => body() } })
})
afterEach(cleanup)

describe("actual record creation transport lifetime", () => {
  it("survives StrictMode effect setup/cleanup and returns the exact saved identity", async () => {
    let operationKey = ""
    controls.read.mockImplementation(async () => operationKey ? [{ id: `1:2:contact:${operationKey}`, organization_id: "1", company_id: "2", model: "contact", operation_key: operationKey, record_id: "9007199254740993", payload_hash: `sha256:${"b".repeat(64)}` }] : [])
    controls.post.mockImplementation(async (_path, init) => {
      const params = JSON.parse(String(init.body)).params
      const data = JSON.parse(params.metadata)
      expect(data["custom:risk"]).toBe(false)
      operationKey = data.__lumiere_create_v1.operation_key
      return Response.json({})
    })
    const { result } = renderHook(() => useRecordCreationTransport(1n, 2n, "contact"), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> })
    let saved: string | undefined
    await act(async () => { saved = await result.current(payload, metadata, makeCommand) })
    expect(saved).toBe("9007199254740993")
    expect(controls.post).toHaveBeenCalledTimes(1)
    expect(controls.read).toHaveBeenCalledTimes(2)
  })

  it("rejects an old actor's pending read after A to B to A", async () => {
    let finish!: (rows: never[]) => void
    controls.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { result, rerender } = renderHook(() => useRecordCreationTransport(1n, 2n, "contact"))
    const pending = result.current(payload, metadata, makeCommand)
    const rejected = expect(pending).rejects.toThrow("Actor or company changed")
    controls.identity = "b".repeat(64); rerender()
    controls.identity = "a".repeat(64); rerender()
    await act(async () => { finish([]) })
    await rejected
    expect(controls.post).not.toHaveBeenCalled()
  })

  it("rejects an old company's pending read after company 2 to 3 to 2", async () => {
    let finish!: (rows: never[]) => void
    controls.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { result, rerender } = renderHook(({ company }) => useRecordCreationTransport(1n, company, "contact"), { initialProps: { company: 2n } })
    const pending = result.current(payload, metadata, makeCommand)
    const rejected = expect(pending).rejects.toThrow("Actor or company changed")
    rerender({ company: 3n }); rerender({ company: 2n })
    await act(async () => { finish([]) })
    await rejected
    expect(controls.post).not.toHaveBeenCalled()
  })

  it("unmounting during capability read prevents a late write", async () => {
    let finish!: (rows: never[]) => void
    controls.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { result, unmount } = renderHook(() => useRecordCreationTransport(1n, 2n, "contact"))
    const pending = result.current(payload, metadata, makeCommand)
    const rejected = expect(pending).rejects.toThrow("Actor or company changed")
    unmount()
    await act(async () => { finish([]) })
    await rejected
    expect(controls.post).not.toHaveBeenCalled()
  })

  it("a browser without cross-tab coordination cannot silently use an unsafe fallback", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined })
    const { result } = renderHook(() => useRecordCreationTransport(1n, 2n, "contact"))
    await expect(result.current(payload, metadata, makeCommand)).rejects.toThrow("cannot safely coordinate")
    expect(controls.read).not.toHaveBeenCalled()
    expect(controls.post).not.toHaveBeenCalled()
  })
})
