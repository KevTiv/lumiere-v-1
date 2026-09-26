import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const SOURCE = readFileSync(
  fileURLToPath(new URL("./projects.ts", import.meta.url)),
  "utf8",
)

function functionBody(name: string, exported = true): string {
  const declaration = `${exported ? "export " : ""}function ${name}(`
  const start = SOURCE.indexOf(declaration)
  assert.notEqual(start, -1, `${name} not found in projects.ts`)

  const bodyStart = SOURCE.indexOf("{", start)
  assert.notEqual(bodyStart, -1, `${name} has no function body`)

  let depth = 0
  for (let index = bodyStart; index < SOURCE.length; index += 1) {
    if (SOURCE[index] === "{") depth += 1
    if (SOURCE[index] === "}") depth -= 1
    if (depth === 0) return SOURCE.slice(bodyStart + 1, index)
  }

  assert.fail(`${name} has an unterminated function body`)
}

describe("Projects timesheet approval timeline", () => {
  it("registers the approval history in the canonical server resource registry", () => {
    const registry = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../crates/stdb-auth/assets/resource_registry.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as Record<string, { table?: string }>

    assert.equal(
      registry["project-timesheet-approvals"]?.table,
      "project_timesheet_approval",
    )
  })

  it("reads the approval history through its organization-scoped query key", () => {
    const body = functionBody("useTimesheetApprovals")

    assert.match(
      body,
      /queryKey:\s*\[\s*['"]project-timesheet-approvals['"]\s*,\s*rqBigIntKey\(organizationId\)\s*\]/,
    )
    assert.match(
      body,
      /fetchQueryList\(\s*['"]\/api\/query\/project-timesheet-approvals['"]/,
    )
  })

  it("refreshes approval history after a successful rejection", () => {
    const rejection = functionBody("useRejectTimesheets")
    const invalidation = functionBody("invalidateTimesheetQueues", false)

    assert.match(rejection, /stdbBffCommandPost\(\s*['"]reject_timesheets['"]/)
    assert.match(
      rejection,
      /onSuccess:\s*\(\)\s*=>\s*invalidateTimesheetQueues\(qc,\s*organizationId\)/,
    )
    assert.match(
      invalidation,
      /invalidateQueries\(\{\s*queryKey:\s*\[\s*['"]project-timesheet-approvals['"]\s*,\s*k\s*\]\s*\}\)/,
      "rejected timesheets would leave the approval timeline stale",
    )
  })
})
