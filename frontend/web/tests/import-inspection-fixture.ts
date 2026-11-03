import { createHash } from "node:crypto"
import { expect, type Page } from "@playwright/test"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"

export const SOURCE_ADMISSION_ID = "a".repeat(32)

/** Synthetic API boundary; browser tests still send and validate original bytes. */
export async function mockCsvInspection(
  page: Page,
  fileName: string,
  csvText: string,
) {
  await page.route("**/api/import/inspect-file?companyId=9001", (route) => {
    const request = route.request()
    expect(request.method()).toBe("POST")
    expect(request.headers()["content-type"]).toBe("application/octet-stream")
    expect(request.headers()["x-file-name"]).toBe(encodeURIComponent(fileName))
    expect(request.postDataBuffer()).toEqual(Buffer.from(csvText))
    const { headers, rows } = parseCsvText(csvText)
    return route.fulfill({
      json: {
        csvText,
        headers,
        rows,
        format: "csv",
        companyId: "9001",
        sourceSha256: createHash("sha256").update(csvText).digest("hex"),
        sourceAdmissionId: SOURCE_ADMISSION_ID,
        policyVersion: "file-inspection-v1",
      },
    })
  })
}
