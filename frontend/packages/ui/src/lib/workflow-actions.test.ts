import type { AnyWorkflowAction } from "@lumiere/erp-workflows"
import { describe, expect, it, vi } from "vitest"

import { runRecordActionForRows, workflowActionsToEntityActions } from "./workflow-actions"

type Row = Record<string, unknown>

function workflowAction(execute: AnyWorkflowAction<Row>["execute"]): AnyWorkflowAction<Row> {
  return {
    id: "post",
    label: "Post",
    kind: "immediate",
    canPresent: (row) => row.state === "draft",
    prepare: (row) => row.id,
    execute,
  }
}

describe("workflowActionsToEntityActions", () => {
  const rows: Row[] = [
    { id: 1, state: "draft" },
    { id: 2, state: "posted" },
    { id: 3, state: "draft" },
  ]

  it("settles after every qualifying row has run, skipping the others", async () => {
    const seen: unknown[] = []
    const execute = vi.fn(async (id: unknown) => {
      await Promise.resolve()
      seen.push(id)
      return { ok: true } as never
    })
    const [action] = workflowActionsToEntityActions([workflowAction(execute)])

    expect(action?.selection).toBe("multiple")
    await action?.onClick(rows)

    expect(seen).toEqual([1, 3])
  })

  it("hands failures to the surface's onError and keeps going", async () => {
    const onError = vi.fn()
    const execute = vi.fn(async (id: unknown) => {
      if (id === 1) throw new Error("refused")
      return { ok: true } as never
    })
    const [action] = workflowActionsToEntityActions([workflowAction(execute)], { onError })

    await expect(action?.onClick(rows)).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it("does not rethrow a failure the workflow runner already reported to the surface", async () => {
    const execute = vi.fn(async () => {
      throw new Error("refused")
    })
    const [action] = workflowActionsToEntityActions([workflowAction(execute)])

    await expect(action?.onClick(rows)).resolves.toBeUndefined()
  })
})

describe("runRecordActionForRows", () => {
  it("runs the action once per selected row, by id", () => {
    const seen: string[] = []
    runRecordActionForRows(
      { execute: async (id) => void seen.push(id) },
      [{ id: 4 }, { id: "9" }, { id: 12n }],
    )
    expect(seen).toEqual(["4", "9", "12"])
  })

  it("skips a row that has no id instead of sending an empty one", () => {
    const seen: string[] = []
    runRecordActionForRows({ execute: async (id) => void seen.push(id) }, [{ name: "x" }, { id: null }, { id: 1 }])
    expect(seen).toEqual(["1"])
  })

  it("does not let a rejected action escape as an unhandled rejection", async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => void unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      runRecordActionForRows({ execute: () => Promise.reject(new Error("refused")) }, [{ id: 1 }])
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
    expect(unhandled).toEqual([])
  })
})
