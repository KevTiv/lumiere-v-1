import { describe, expect, it } from "vitest"

import {
  REPORT_EXPORT_PROVENANCE_SCHEMA,
  reportExportProvenanceJson,
  reportExportSourceProvenance,
  sha256Hex,
} from "./report-export-provenance"

describe("report export provenance", () => {
  it("normalizes identifiers and serializes a deterministic source contract", () => {
    const source = reportExportSourceProvenance({
      organizationId: 7n,
      companyId: 11,
      dashboardId: "13",
      widgetId: 17n,
      model: "sale_order",
      domain: "",
      groupBy: "state",
      startMs: 100,
      endMs: 200,
    })
    expect(source).toEqual({
      schema: REPORT_EXPORT_PROVENANCE_SCHEMA,
      organizationId: "7",
      companyId: "11",
      dashboardId: "13",
      widgetId: "17",
      model: "sale_order",
      domain: null,
      groupBy: "state",
      startMs: 100,
      endMs: 200,
    })
    expect(reportExportProvenanceJson(source)).toBe(JSON.stringify(source))
  })

  it("produces the standard SHA-256 artifact digest", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })
})
