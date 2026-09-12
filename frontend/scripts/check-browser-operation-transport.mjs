#!/usr/bin/env node

/**
 * Keep production browser code on the immutable-ID operation endpoint.
 * Compatibility reducer routes remain available only to excluded E2E/dev
 * tooling and explicitly trusted server-side bridges.
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

const FRONTEND_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const REPOSITORY_ROOT = path.resolve(FRONTEND_ROOT, "..")
const ROOTS = ["packages", "web/app", "web/lib"]
const ALLOWLIST = new Set(["web/lib/api-url.ts"])
const FORBIDDEN_PATHS = ["/api/call/", "/api/compat/reducer/"]
const FORBIDDEN_CALLS = new Set(["stdbBrowserCall", "stdbBrowserCompatCall"])
const RETIRED_ALIAS_PATTERNS = [
  {
    file: path.join(FRONTEND_ROOT, "web/next.config.mjs"),
    pattern: "/api/call/:path*",
  },
  {
    file: path.join(REPOSITORY_ROOT, "api-server/src/http_app/router.rs"),
    pattern: '.route("/call/:reducer"',
  },
  {
    file: path.join(REPOSITORY_ROOT, "api-server/src/routes/queries.rs"),
    pattern: 'rename = "withCompany"',
  },
]

function relativeToFrontend(absolutePath) {
  return path.relative(FRONTEND_ROOT, absolutePath).split(path.sep).join("/")
}

function isExcluded(relativePath) {
  return (
    ALLOWLIST.has(relativePath) ||
    /(?:^|\/)(?:node_modules|dist|\.next|dev|scripts|tests|__tests__)(?:\/|$)/.test(
      relativePath,
    ) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath) ||
    relativePath.includes("/generated/")
  )
}

function collectSourceFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!isExcluded(`${relativeToFrontend(absolutePath)}/`)) {
        collectSourceFiles(absolutePath, files)
      }
      continue
    }
    if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) files.push(absolutePath)
  }
  return files
}

function literalText(node) {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text
  }
  return null
}

function sourceViolations(filePath, sourceText) {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  const violations = []

  function report(node, message) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push(`${position.line + 1}:${position.character + 1} ${message}`)
  }

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      FORBIDDEN_CALLS.has(node.expression.text)
    ) {
      report(node.expression, `forbidden browser compatibility helper '${node.expression.text}'`)
    }

    const text = literalText(node)
    if (text !== null) {
      for (const forbiddenPath of FORBIDDEN_PATHS) {
        if (text.includes(forbiddenPath)) {
          report(node, `forbidden production browser route '${forbiddenPath}'`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

if (process.argv.includes("--self-test")) {
  assert.equal(sourceViolations("safe.ts", 'fetch("/api/operations/erp.safe")').length, 0)
  assert.match(
    sourceViolations("bad.ts", 'fetch(`/api/call/${name}`)')[0] ?? "",
    /forbidden production browser route/,
  )
  assert.match(
    sourceViolations("bad.ts", 'stdbBrowserCompatCall("unsafe", [])')[0] ?? "",
    /forbidden browser compatibility helper/,
  )
  console.log("Browser operation transport self-tests passed.")
  process.exit(0)
}

const violations = []
for (const root of ROOTS) {
  const absoluteRoot = path.join(FRONTEND_ROOT, root)
  for (const filePath of collectSourceFiles(absoluteRoot)) {
    const relativePath = relativeToFrontend(filePath)
    if (isExcluded(relativePath)) continue
    const fileViolations = sourceViolations(filePath, fs.readFileSync(filePath, "utf8"))
    violations.push(...fileViolations.map((violation) => `${relativePath}:${violation}`))
  }
}

for (const { file, pattern } of RETIRED_ALIAS_PATTERNS) {
  if (fs.readFileSync(file, "utf8").includes(pattern)) {
    violations.push(
      `${path.relative(REPOSITORY_ROOT, file)}: retired compatibility surface '${pattern}'`,
    )
  }
}

if (violations.length > 0) {
  console.error("Production browser operation transport check failed:")
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(
  "Production browser operation transport check passed; immutable-ID endpoints are required.",
)
