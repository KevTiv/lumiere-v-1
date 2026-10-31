/** Synthetic, date-specific fixtures shared by parser and mounted history tests. */
export function sourceHistoryCoverage(companyId = 7, organizationId = 42) {
  const counts = {
    total: 2, dated: 1, undated: 1, invalid: 0,
    minDate: "2022-10-31", maxDate: "2022-10-31",
    states: { needs_review: 1, confirmed: 1, excluded: 0 },
  }
  return {
    organizationId: String(organizationId), companyId: String(companyId), snapshot: `scope-${organizationId}-${companyId}-v1`, nextCursor: null as string | null,
    status: "available", storage: "source_review", dateBasis: "source_business_date",
    complete: true, aggregatesComplete: true, totals: counts,
    datasets: [{ ...counts, id: "11", title: "Historic shop source", targetEntity: "source_observation", sourceFile: "shop-2022.csv" }],
    years: [{ year: 2022, count: 1 }], months: [{ month: "2022-10", count: 1 }], bucketGranularity: "month", bucketBasis: "observation_start",
  }
}

export function sourceHistoryRows(companyId = 7, organizationId = 42) {
  return {
    organizationId: String(organizationId), companyId: String(companyId), snapshot: `scope-${organizationId}-${companyId}-v1`, nextCursor: null as string | null,
    status: "available", storage: "source_review",
    data: [{
      id: "101", batchId: "11", title: "Historic shop source", targetEntity: "source_observation", sourceFile: "shop-2022.csv",
      label: "Historical sale observation", source: { file: "shop-2022.csv", row: 8, rowBasis: "source_line", sha256: "a".repeat(64) },
      values: { business_date: "2022-10-31", quantity: "8" },
      fields: [
        { key: "business_date", label: "Business date", kind: "date", sourceValue: "2022-10-31", required: false },
        { key: "quantity", label: "Quantity", kind: "decimal", sourceValue: "8", required: false },
      ],
      state: "confirmed", revision: 2,
      businessDate: { precision: "day", from: "2022-10-31", toExclusive: "2022-11-01", raw: "2022-10-31", basis: "review_business_date" }, issue: "Unit needs review.",
    }, {
      id: "102", batchId: "11", title: "Historic shop source", targetEntity: "source_observation", sourceFile: "shop-2022.csv",
      label: "Undated source observation", source: { file: "shop-2022.csv", row: 9, rowBasis: "source_line", sha256: "a".repeat(64) },
      values: { business_date: null, quantity: "6" },
      fields: [
        { key: "business_date", label: "Business date", kind: "date", sourceValue: "January", required: false },
        { key: "quantity", label: "Quantity", kind: "decimal", sourceValue: "6", required: false },
      ],
      state: "needs_review", revision: 0,
      businessDate: { precision: "undated", from: null, toExclusive: null, raw: null, basis: "no_business_date" }, issue: "The source does not identify a year.",
    }],
  }
}
