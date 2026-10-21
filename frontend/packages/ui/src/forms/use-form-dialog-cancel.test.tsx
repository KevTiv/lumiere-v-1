import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { useFormDialog } from "./use-form-dialog"

afterEach(cleanup)

it("cancels an open record dialog without submitting its stale form values", async () => {
  const { result } = renderHook(() => useFormDialog())
  let answer!: Promise<Record<string, unknown> | null>
  act(() => {
    answer = result.current.askForm({ title: "Edit plan", fields: [] })
  })
  expect(result.current.formDialog).not.toBeNull()
  act(() => result.current.cancelForm())
  await expect(answer).resolves.toBeNull()
  expect(result.current.formDialog).toBeNull()
  act(() => result.current.cancelForm())
  expect(result.current.formDialog).toBeNull()
})
