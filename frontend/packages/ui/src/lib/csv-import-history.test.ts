import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { csvImportHistoryJobs, selectedCsvImportJob } from "./csv-import-history"

describe("CSV import history selection", () => {
  const jobs = [
    { id: "9007199254740993", table_name: "hr_employee", status: "partial", imported_rows: 2, error_rows: 1 },
    { id: 11, tableName: "project_project", status: "success" },
    { id: 10, tableName: "hr_employee", status: "failed", importedRows: 0, errorRows: 3 },
  ]
  it("filters exact entity names across snake and camel projections", () => {
    assert.deepEqual(csvImportHistoryJobs(jobs, "hr_employee"), [jobs[0], jobs[2]])
    assert.deepEqual(csvImportHistoryJobs(jobs, "employee"), [])
  })
  it("shows organization history when the entity is unspecified", () => {
    assert.deepEqual(csvImportHistoryJobs(jobs), jobs)
  })
  it("never attributes the latest job to a submission", () => {
    assert.equal(selectedCsvImportJob(jobs, null), undefined)
  })
  it("uses the exact selected ID without losing large integer precision", () => {
    assert.equal(selectedCsvImportJob(jobs, "9007199254740993"), jobs[0])
  })
  it("does not substitute another job when selection disappears or is outside the entity", () => {
    assert.equal(selectedCsvImportJob(jobs.slice(1), "9007199254740993"), undefined)
    assert.equal(selectedCsvImportJob(csvImportHistoryJobs(jobs, "hr_employee"), "11"), undefined)
  })
  it("excludes rows with no usable job ID", () => {
    assert.deepEqual(csvImportHistoryJobs([{ table_name: "hr_employee" }, { id: "" }]), [])
  })
})
