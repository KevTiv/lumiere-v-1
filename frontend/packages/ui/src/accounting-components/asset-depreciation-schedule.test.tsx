import { useState } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { savedAssetSchedule, type SavedDepreciationLine } from "./asset-depreciation-schedule-model"
import { AssetDepreciationSchedule } from "./asset-depreciation-schedule"

vi.mock("@lumiere/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lumiere/i18n")>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string; [name: string]: unknown }) =>
        options?.defaultValue ? actual.i18n.t(key, { ...options, lng: "en" }) : key,
    }),
  }
})
afterEach(cleanup)

const asset = {
  id: 10n,
  companyId: 2n,
  name: "CNC machine",
  state: { tag: "Running" },
}
const line: SavedDepreciationLine = {
  id: 100n,
  assetId: 10n,
  companyId: 2n,
  sequence: 1,
  amount: 100,
  depreciationDate: "2026-01-31",
  remainingValue: 900,
  depreciatedValue: 100,
}

describe("saved asset schedule", () => {
  it("orders exact saved identities and displays saved values without recomputing them", () => {
    const second = {
      ...line,
      id: 101n,
      sequence: 2,
      amount: 90,
      depreciationDate: "2026-02-28",
      remainingValue: 810,
      depreciatedValue: 190,
    }
    const result = savedAssetSchedule(asset, [second, { ...line, assetId: 55n }, line], 2n)
    expect(result).toEqual({
      status: "saved",
      incomplete: false,
      lines: [
        {
          id: "100",
          sequence: 1,
          date: "2026-01-31",
          amount: 100,
          remaining: 900,
          depreciated: 100,
        },
        {
          id: "101",
          sequence: 2,
          date: "2026-02-28",
          amount: 90,
          remaining: 810,
          depreciated: 190,
        },
      ],
    })
  })

  it("fails closed on conflicting company, identity, sequence, or missing board records", () => {
    for (const rows of [[{ ...line, companyId: 3n }], [line, line], [{ ...line, sequence: 2 }]]) {
      expect(savedAssetSchedule(asset, rows, 2n).status).toBe("unavailable")
    }
    expect(savedAssetSchedule({ ...asset, companyId: 3n }, [], 2n).status).toBe("unavailable")
  })

  it("does not replace missing saved balances or dates with estimates", () => {
    const result = savedAssetSchedule(
      asset,
      [{ ...line, remainingValue: undefined, depreciationDate: "invalid" }],
      2n,
    )
    expect(result.status).toBe("saved")
    if (result.status !== "saved") return
    expect(result.incomplete).toBe(true)
    expect(result.lines[0]?.remaining).toBeNull()
    expect(result.lines[0]?.date).toBeNull()
  })

  it("shows the saved table and does not offer generation for an existing board", () => {
    const generate = vi.fn()
    render(
      <AssetDepreciationSchedule
        asset={asset}
        lines={[line]}
        companyId={2n}
        dataState={{ status: "ready" }}
        onGenerate={generate}
      />,
    )
    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!
    expect(row.textContent).toContain("2026-01-31")
    expect(row.textContent).toContain("900.00")
    expect(screen.queryByRole("button", { name: "Generate saved schedule" })).toBeNull()
    expect(generate).not.toHaveBeenCalled()
  })

  it("does not infer an empty board from loading, denied, failed, or partial data", () => {
    for (const status of ["loading", "denied", "error", "partial"] as const) {
      const view = render(
        <AssetDepreciationSchedule
          asset={asset}
          lines={[]}
          companyId={2n}
          dataState={{ status }}
          onGenerate={vi.fn()}
        />,
      )
      expect(screen.queryByRole("button", { name: "Generate saved schedule" })).toBeNull()
      expect(screen.queryByText(/No saved depreciation lines/)).toBeNull()
      view.unmount()
    }
  })

  it("does not generate for an unconfirmed asset or another company", () => {
    for (const selected of [
      { ...asset, state: { tag: "Draft" } },
      { ...asset, companyId: 3n },
    ]) {
      const view = render(
        <AssetDepreciationSchedule
          asset={selected}
          lines={[]}
          companyId={2n}
          dataState={{ status: "ready" }}
          onGenerate={vi.fn()}
        />,
      )
      expect(screen.queryByRole("button", { name: "Generate saved schedule" })).toBeNull()
      view.unmount()
    }
  })

  it("uses the supplied owner action once and keeps an unconfirmed result visible", async () => {
    const generate = vi
      .fn()
      .mockRejectedValue(new Error("Canonical schedule readback is unavailable"))
    render(
      <AssetDepreciationSchedule
        asset={asset}
        lines={[]}
        companyId={2n}
        dataState={{ status: "ready" }}
        onGenerate={generate}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Generate saved schedule" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Canonical schedule readback is unavailable",
      ),
    )
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it("refreshes the loaded rows after authoritative generation and then shows the saved table", async () => {
    const calls: string[] = []
    const generate = vi.fn(async () => {
      calls.push("generate")
    })
    const refresh = vi.fn()
    function Viewer() {
      const [lines, setLines] = useState<SavedDepreciationLine[]>([])
      return (
        <AssetDepreciationSchedule
          asset={asset}
          lines={lines}
          companyId={2n}
          dataState={{ status: "ready" }}
          onGenerate={generate}
          onRefresh={async () => {
            calls.push("refresh")
            refresh()
            setLines([line])
          }}
        />
      )
    }
    render(<Viewer />)
    fireEvent.click(screen.getByRole("button", { name: "Generate saved schedule" }))
    await waitFor(() => expect(screen.getByRole("table").textContent).toContain("2026-01-31"))
    expect(calls).toEqual(["generate", "refresh"])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: "Generate saved schedule" })).toBeNull()
    expect(screen.queryByText(/No saved depreciation lines/)).toBeNull()
  })

  it("keeps refresh failures inline and retries only the read after generation is confirmed", async () => {
    const generate = vi.fn().mockResolvedValue(undefined)
    let rejectRefresh: (error: Error) => void = () => {}
    const refresh = vi.fn().mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRefresh = reject
        }),
    )
    function Viewer() {
      const [lines, setLines] = useState<SavedDepreciationLine[]>([])
      return (
        <AssetDepreciationSchedule
          asset={asset}
          lines={lines}
          companyId={2n}
          dataState={{ status: "ready" }}
          onGenerate={generate}
          onRefresh={async () => {
            await refresh()
            if (refresh.mock.calls.length > 1) setLines([line])
          }}
        />
      )
    }
    render(<Viewer />)
    fireEvent.click(screen.getByRole("button", { name: "Generate saved schedule" }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.getByRole("button", { name: "Refresh schedule" }).hasAttribute("disabled")).toBe(
      true,
    )
    expect(screen.queryByRole("button", { name: "Generate saved schedule" })).toBeNull()
    await act(async () => {
      rejectRefresh(new Error("Saved lines refresh failed"))
    })
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Saved lines refresh failed"),
    )
    expect(screen.getByText(/Schedule generation is confirmed/)).toBeTruthy()
    expect(screen.queryByText(/No saved depreciation lines/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Refresh schedule" }))
    await waitFor(() => expect(screen.getByRole("table").textContent).toContain("2026-01-31"))
    expect(generate).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
