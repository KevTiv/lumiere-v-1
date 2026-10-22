import fs from "node:fs"
import path from "node:path"
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter"

/** Inert timing data only: no stdout, errors, cookies, attachments or storage state. */
export default class TimingReporter implements Reporter {
  private results = new Map<string, { test: TestCase; durationMs: number }>()

  onTestEnd(test: TestCase, result: TestResult) {
    const previous = this.results.get(test.id)
    this.results.set(test.id, {
      test,
      durationMs: (previous?.durationMs ?? 0) + result.duration,
    })
  }

  onEnd(result: FullResult) {
    const tests = [...this.results.values()].map(({ test, durationMs }) => ({
      id: test.id,
      file: path.relative(process.cwd(), test.location.file).split(path.sep).join("/"),
      project: test.parent.project()?.name ?? "",
      tags: [...test.tags].sort(),
      outcome: test.outcome(),
      duration_ms: durationMs,
    })).sort((a, b) => a.id.localeCompare(b.id))
    const output = path.resolve(process.env.PLAYWRIGHT_TIMINGS_OUTPUT ?? "playwright-timings.json")
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, JSON.stringify({
      version: 1,
      status: result.status,
      source_commit: process.env.GITHUB_SHA ?? "",
      suite: process.env.E2E_SUITE ?? "full",
      partition: process.env.E2E_PARTITION ?? "1/1",
      tests,
    }, null, 2) + "\n")
  }
}
