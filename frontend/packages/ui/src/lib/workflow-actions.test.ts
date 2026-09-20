import { describe, expect, it } from "vitest"

import { runRecordActionForRows } from "./workflow-actions"

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
