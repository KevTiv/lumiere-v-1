import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import type { TestCase, TestResult } from "@playwright/test/reporter"
import TimingReporter from "./playwright-timing-reporter"

test("timing artifacts include retry cost without logs or credentials", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-times-"))
  const previous = process.env.PLAYWRIGHT_TIMINGS_OUTPUT
  process.env.PLAYWRIGHT_TIMINGS_OUTPUT = path.join(directory, "timings.json")
  try {
    const reporter = new TimingReporter()
    const fake = {
      id: "stable-id", location: { file: path.join(process.cwd(), "tests/e2e/example.spec.ts") },
      parent: { project: () => ({ name: "authenticated" }) }, tags: ["@p0"],
      outcome: () => "expected",
    } as unknown as TestCase
    for (const duration of [100, 200]) {
      reporter.onTestEnd(fake, { duration, stdout: ["private fixture output"],
        attachments: [{ body: "private attachment" }] } as unknown as TestResult)
    }
    reporter.onEnd({ status: "passed", startTime: new Date(), duration: 300 })
    const raw = fs.readFileSync(process.env.PLAYWRIGHT_TIMINGS_OUTPUT, "utf8")
    const report = JSON.parse(raw)
    assert.equal(report.tests.length, 1)
    assert.equal(report.tests[0].duration_ms, 300)
    assert.equal(report.tests[0].file, "tests/e2e/example.spec.ts")
    assert.equal(report.status, "passed")
    assert.equal(raw.includes("private"), false)
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_TIMINGS_OUTPUT
    else process.env.PLAYWRIGHT_TIMINGS_OUTPUT = previous
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
