#!/usr/bin/env node

/**
 * Enforce the incremental migration away from Record<string, unknown> in
 * frontend production TypeScript. This deliberately uses the TypeScript AST
 * instead of a text search so formatting and comments cannot affect counts.
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import assert from "node:assert/strict"
import ts from "typescript"

const FRONTEND_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const POLICY_PATH = path.join(FRONTEND_ROOT, "type-debt/opaque-record-policy.json")
const BASELINE_PATH = path.join(FRONTEND_ROOT, "type-debt/opaque-record-baseline.json")

const policy = JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"))
const writeBaseline = process.argv.includes("--write-baseline")
const selfTest = process.argv.includes("--self-test")
const baseline = writeBaseline
  ? {}
  : JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))

function globToRegExp(pattern) {
  let expression = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === "*" && pattern[index + 1] === "*") {
      // A globstar followed by a slash also matches zero directories.
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?"
        index += 2
      } else {
        expression += ".*"
        index += 1
      }
    } else if (character === "*") {
      expression += "[^/]*"
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    }
  }
  return new RegExp(`^${expression}$`)
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath))
}

function evaluateRatchet(current, knownBaseline) {
  const violations = []
  for (const [relativePath, count] of Object.entries(current)) {
    const allowed = knownBaseline[relativePath]
    if (allowed === undefined) {
      violations.push(`${relativePath}: ${count} new occurrence${count === 1 ? "" : "s"} (new files must start at zero)`)
    } else if (count > allowed) {
      violations.push(`${relativePath}: ${count} occurrence${count === 1 ? "" : "s"} (baseline ${allowed})`)
    }
  }
  for (const [relativePath, allowed] of Object.entries(knownBaseline)) {
    const count = current[relativePath]
    if (count === undefined) {
      violations.push(`${relativePath}: baseline entry is stale (file is absent, excluded, allowlisted, or now has zero occurrences; run --write-baseline)`)
    } else if (count < allowed) {
      violations.push(`${relativePath}: count decreased from ${allowed} to ${count}; run --write-baseline to make the reduction permanent`)
    }
  }
  return violations
}

if (selfTest) {
  assert.deepEqual(evaluateRatchet({ "existing.ts": 2 }, { "existing.ts": 2 }), [])
  assert.match(evaluateRatchet({ "new.ts": 1 }, {}).join("\n"), /new files must start at zero/)
  assert.match(evaluateRatchet({ "existing.ts": 3 }, { "existing.ts": 2 }).join("\n"), /baseline 2/)
  assert.match(evaluateRatchet({ "existing.ts": 1 }, { "existing.ts": 2 }).join("\n"), /make the reduction permanent/)
  assert.match(evaluateRatchet({}, { "deleted.ts": 1 }).join("\n"), /baseline entry is stale/)
  console.log("Opaque record ratchet self-tests passed (new, increase, decrease, stale baseline).")
  process.exit(0)
}

function collectSourceFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next" && entry.name !== "dist") {
        collectSourceFiles(absolutePath, files)
      }
      continue
    }
    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(absolutePath)
  }
  return files
}

function isOpaqueRecord(node) {
  if (!ts.isTypeReferenceNode(node) || node.typeName.getText() !== "Record") return false
  const argumentsList = node.typeArguments
  return (
    argumentsList?.length === 2 &&
    argumentsList[0].kind === ts.SyntaxKind.StringKeyword &&
    argumentsList[1].kind === ts.SyntaxKind.UnknownKeyword
  )
}

function countOpaqueRecords(filePath) {
  const sourceText = fs.readFileSync(filePath, "utf8")
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  let count = 0
  function visit(node) {
    if (isOpaqueRecord(node)) count += 1
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return count
}

function relativeToFrontend(absolutePath) {
  return path.relative(FRONTEND_ROOT, absolutePath).split(path.sep).join("/")
}

const sourceFiles = policy.roots.flatMap((root) => collectSourceFiles(path.join(FRONTEND_ROOT, root)))
const includedFiles = sourceFiles
  .map(relativeToFrontend)
  .filter((relativePath) => !matchesAny(relativePath, policy.exclude))
  .filter((relativePath) => !matchesAny(relativePath, policy.boundaryAllowlist))
  .sort()

const current = {}
for (const relativePath of includedFiles) {
  const count = countOpaqueRecords(path.join(FRONTEND_ROOT, relativePath))
  if (count > 0) current[relativePath] = count
}

if (writeBaseline) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(current).length} file baselines to ${path.relative(process.cwd(), BASELINE_PATH)}`)
  process.exit(0)
}

const violations = evaluateRatchet(current, baseline)

const baselineTotal = Object.values(baseline).reduce((total, count) => total + count, 0)
const currentTotal = Object.values(current).reduce((total, count) => total + count, 0)
const allowlistedTotal = sourceFiles
  .map(relativeToFrontend)
  .filter((relativePath) => !matchesAny(relativePath, policy.exclude))
  .filter((relativePath) => matchesAny(relativePath, policy.boundaryAllowlist))
  .reduce((total, relativePath) => total + countOpaqueRecords(path.join(FRONTEND_ROOT, relativePath)), 0)

console.log(`Opaque record ratchet: ${currentTotal} tracked occurrence${currentTotal === 1 ? "" : "s"} across ${Object.keys(current).length} files (baseline ${baselineTotal}).`)
console.log(`Boundary allowlist: ${allowlistedTotal} occurrence${allowlistedTotal === 1 ? "" : "s"}; excluded/generated/test/dev files are not tracked.`)

if (violations.length > 0) {
  console.error("\nOpaque record ratchet failed:")
  for (const violation of violations) console.error(`- ${violation}`)
  console.error("\nIf the increase is intentional, migrate the contract or update the reviewed baseline in a dedicated type-migration change.")
  process.exit(1)
}
