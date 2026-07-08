#!/usr/bin/env node
/**
 * Compare Rust Create*Params structs against frontend mapper exports.
 *
 * Usage:
 *   npx tsx scripts/check-params-mapper-coverage.ts
 *   npx tsx scripts/check-params-mapper-coverage.ts --json
 *   npx tsx scripts/check-params-mapper-coverage.ts --min-coverage 55
 *   npx tsx scripts/check-params-mapper-coverage.ts --verbose
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUST_SRC = join(REPO_ROOT, 'spacetimedb/src')
const TS_DIRS = [
  join(REPO_ROOT, 'frontend/web/lib'),
  join(REPO_ROOT, 'frontend/packages/erp-shared/src'),
]

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'target',
  'dist',
  '.git',
])

const RUST_STRUCT_RE = /pub struct (Create\w+Params)/g
const TS_MAPPER_RE =
  /export function (toCreate\w+Params(?:From\w+)?|\w+ParamsFromForm|buildCreate\w+Params)/g

const TARGET_COVERAGE_PCT = 100

interface CoverageReport {
  totalStructs: number
  mappedCount: number
  coveragePct: number
  unmapped: string[]
  mapped?: Array<{ struct: string; mappers: string[] }>
}

function walkFiles(dir: string, extension: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(fullPath, extension, out)
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      out.push(fullPath)
    }
  }
  return out
}

function parseRustCreateParams(): Set<string> {
  const structs = new Set<string>()
  for (const file of walkFiles(RUST_SRC, '.rs')) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(RUST_STRUCT_RE)) {
      structs.add(match[1])
    }
  }
  return structs
}

function toPascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function mapperFnToCandidateStructs(fnName: string): string[] {
  const candidates = new Set<string>()

  if (fnName.startsWith('buildCreate') && fnName.endsWith('Params')) {
    candidates.add(fnName.slice('build'.length))
    return [...candidates]
  }

  if (fnName.endsWith('ParamsFromForm')) {
    const base = fnName.slice(0, -'ParamsFromForm'.length)
    if (base.endsWith('Create')) {
      candidates.add(`Create${toPascalCase(base.slice(0, -'Create'.length))}Params`)
    } else if (base.startsWith('toCreate')) {
      candidates.add(`Create${toPascalCase(base.slice('toCreate'.length))}Params`)
    } else {
      candidates.add(`Create${toPascalCase(base)}Params`)
    }
    return [...candidates]
  }

  if (fnName.startsWith('toCreate') && fnName.includes('Params')) {
    const afterPrefix = fnName.slice('toCreate'.length)
    const paramsIdx = afterPrefix.indexOf('Params')
    if (paramsIdx >= 0) {
      candidates.add(`Create${afterPrefix.slice(0, paramsIdx)}Params`)
    }
  }

  return [...candidates]
}

function resolveStructName(
  candidate: string,
  rustStructs: Set<string>,
): string | undefined {
  if (rustStructs.has(candidate)) return candidate
  const lower = candidate.toLowerCase()
  for (const name of rustStructs) {
    if (name.toLowerCase() === lower) return name
  }
  return undefined
}

function parseTsMappers(rustStructs: Set<string>): Map<string, Set<string>> {
  const structToMappers = new Map<string, Set<string>>()

  for (const dir of TS_DIRS) {
    for (const file of walkFiles(dir, '.ts')) {
      const relFile = relative(REPO_ROOT, file).split('\\').join('/')
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(TS_MAPPER_RE)) {
        const fnName = match[1]
        for (const candidate of mapperFnToCandidateStructs(fnName)) {
          const structName = resolveStructName(candidate, rustStructs)
          if (!structName) continue
          const mappers = structToMappers.get(structName) ?? new Set<string>()
          mappers.add(`${relFile}::${fnName}`)
          structToMappers.set(structName, mappers)
        }
      }
    }
  }

  return structToMappers
}

function buildReport(verbose: boolean): CoverageReport {
  const rustStructs = parseRustCreateParams()
  const structToMappers = parseTsMappers(rustStructs)
  const mappedStructs = [...structToMappers.keys()].sort()
  const unmapped = [...rustStructs]
    .filter((name) => !structToMappers.has(name))
    .sort()

  const totalStructs = rustStructs.size
  const mappedCount = mappedStructs.length
  const coveragePct =
    totalStructs === 0 ? 100 : Math.round((mappedCount / totalStructs) * 1000) / 10

  const report: CoverageReport = {
    totalStructs,
    mappedCount,
    coveragePct,
    unmapped,
  }

  if (verbose) {
    report.mapped = mappedStructs.map((struct) => ({
      struct,
      mappers: [...(structToMappers.get(struct) ?? [])].sort(),
    }))
  }

  return report
}

function parseArgs(argv: string[]): {
  json: boolean
  verbose: boolean
  minCoverage?: number
  warnCoverage?: number
} {
  let json = false
  let verbose = false
  let minCoverage: number | undefined
  let warnCoverage: number | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      json = true
    } else if (arg === '--verbose') {
      verbose = true
    } else if (arg === '--min-coverage') {
      minCoverage = Number(argv[++i])
    } else if (arg === '--warn-coverage') {
      warnCoverage = Number(argv[++i])
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npx tsx scripts/check-params-mapper-coverage.ts [options]

Options:
  --json                 Emit JSON report on stdout
  --verbose              Include mapped struct → mapper list in JSON
  --min-coverage <pct>   Exit 1 when coveragePct is below floor
  --warn-coverage <pct>  Print warning when coveragePct is below target (default ${TARGET_COVERAGE_PCT})
  -h, --help             Show this help
`)
      process.exit(0)
    }
  }

  return { json, verbose, minCoverage, warnCoverage }
}

function printHuman(report: CoverageReport): void {
  console.log(
    `Params mapper coverage: ${report.mappedCount}/${report.totalStructs} (${report.coveragePct}%)`,
  )
  console.log(`Unmapped Create*Params (${report.unmapped.length}):`)
  for (const name of report.unmapped) {
    console.log(`  - ${name}`)
  }
}

function main(): void {
  const { json, verbose, minCoverage, warnCoverage } = parseArgs(process.argv.slice(2))
  const report = buildReport(verbose)

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHuman(report)
  }

  const warnFloor = warnCoverage ?? TARGET_COVERAGE_PCT
  if (report.coveragePct < warnFloor) {
    const msg = `Warning: mapper coverage ${report.coveragePct}% is below target ${warnFloor}%`
    if (json) {
      console.error(msg)
    } else {
      console.warn(msg)
    }
  }

  if (minCoverage !== undefined && report.coveragePct < minCoverage) {
    console.error(
      `Error: mapper coverage ${report.coveragePct}% is below floor ${minCoverage}%`,
    )
    process.exit(1)
  }
}

main()
