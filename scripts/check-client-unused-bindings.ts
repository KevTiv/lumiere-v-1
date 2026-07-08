#!/usr/bin/env node
/**
 * Scan *-client.tsx module shells for hook/query bindings that look unused.
 *
 * Heuristics:
 *  - `const { data: foo` where `foo` appears only at the declaration site
 *  - `const bar = useHook(` (excluding useMemo/useCallback/etc.) where `bar` is never referenced again
 *  - `const [x, setX]` where `setX` is never called
 *
 * Usage:
 *   npx tsx scripts/check-client-unused-bindings.ts
 *   npx tsx scripts/check-client-unused-bindings.ts --json
 */

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MODULES_DIR = join(REPO_ROOT, "frontend/web/app/(modules)")

const SKIP_HOOKS =
  /^use(?:Memo|Callback|Effect|State|Ref|Translation|InventoryModuleSubscription|AccountingModuleSubscription|SubscriptionsModuleSubscription|ProjectsModuleSubscription|CrmModuleSubscription|SalesModuleSubscription|PurchasingModuleSubscription|ReportsModuleSubscription|WorkflowsModuleSubscription)/

interface Finding {
  file: string
  line: number
  kind: "query-data" | "mutation" | "state-setter"
  binding: string
}

function walkClientFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkClientFiles(full, out)
    else if (entry.isFile() && entry.name.endsWith("-client.tsx")) out.push(full)
  }
  return out
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length
}

function countWord(content: string, word: string): number {
  const re = new RegExp(`\\b${word}\\b`, "g")
  return [...content.matchAll(re)].length
}

function scanFile(filePath: string): Finding[] {
  const content = readFileSync(filePath, "utf8")
  const rel = relative(REPO_ROOT, filePath)
  const findings: Finding[] = []

  for (const match of content.matchAll(/const\s*\{\s*data:\s*(\w+)/g)) {
    const name = match[1]
    const decl = match[0]
    const uses = countWord(content, name)
    if (uses <= 1) {
      findings.push({
        file: rel,
        line: lineNumberAt(content, match.index!),
        kind: "query-data",
        binding: name,
      })
    }
    void decl
  }

  for (const match of content.matchAll(/const\s+(\w+)\s*=\s*(use[A-Z]\w*)\(/g)) {
    const name = match[1]
    const hook = match[2]
    if (SKIP_HOOKS.test(hook)) continue
    if (countWord(content, name) <= 1) {
      findings.push({
        file: rel,
        line: lineNumberAt(content, match.index!),
        kind: "mutation",
        binding: name,
      })
    }
  }

  for (const match of content.matchAll(/const\s*\[\s*(\w+)\s*,\s*(set\w+)\s*\]/g)) {
    const setter = match[2]
    if (!content.includes(`${setter}(`)) {
      findings.push({
        file: rel,
        line: lineNumberAt(content, match.index!),
        kind: "state-setter",
        binding: setter,
      })
    }
  }

  return findings
}

function main(): void {
  const json = process.argv.includes("--json")
  const files = walkClientFiles(MODULES_DIR)
  const findings = files.flatMap(scanFile).sort((a, b) => {
    const fc = a.file.localeCompare(b.file)
    return fc !== 0 ? fc : a.line - b.line
  })

  if (json) {
    console.log(JSON.stringify({ filesScanned: files.length, findings }, null, 2))
    return
  }

  console.log(`Scanned ${files.length} *-client.tsx files`)
  if (findings.length === 0) {
    console.log("No likely-unused bindings found.")
    return
  }

  console.log(`\n${findings.length} likely-unused binding(s):\n`)
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  [${f.kind}] ${f.binding}`)
  }
  process.exitCode = 1
}

main()
