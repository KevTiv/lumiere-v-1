#!/usr/bin/env node
/**
 * Reducer Type Analyzer
 *
 * Analyzes the type contract between:
 *   1. SpacetimeDB reducer bindings (generated *_reducer.ts + types.ts)
 *   2. Query-hooks mutation calls (/api/call/{reducer} body shapes)
 *   3. API-server route handlers (body.get("field") extraction patterns)
 *
 * Detects:
 *   - Arg count mismatches (hook sends wrong number of positional args)
 *   - Missing required params fields (non-optional fields not passed)
 *   - u64 type hazard: passing JS number instead of bigint (not stringified by stdbParamsToJson)
 *   - Timestamp type hazard: passing raw string/number instead of {microsSinceUnixEpoch}
 *   - Fields passed but not extracted by api-server handlers
 *   - Reducers with no frontend call site
 *
 * Run:
 *   npx tsx scripts/analyze-reducer-types.ts
 *   npx tsx scripts/analyze-reducer-types.ts --module crm
 *   npx tsx scripts/analyze-reducer-types.ts --reducer create_lead
 *   npx tsx scripts/analyze-reducer-types.ts --only-issues
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import * as path from 'path'

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const moduleFilter = args.find((_, i) => args[i - 1] === '--module')
const reducerFilter = args.find((_, i) => args[i - 1] === '--reducer')
const onlyIssues = args.includes('--only-issues')

// ── Paths ────────────────────────────────────────────────────────────────────

const __filename = new URL(import.meta.url).pathname
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '../../..')
const GENERATED_DIR = path.join(REPO_ROOT, 'frontend/packages/stdb/src/generated')
const HOOKS_DIR = path.join(REPO_ROOT, 'frontend/packages/query-hooks/src/hooks')
const API_ROUTES_DIR = path.join(REPO_ROOT, 'api-server/src/routes')
const WEB_LIB_DIR = path.join(REPO_ROOT, 'frontend/web/lib')
const WEB_APP_DIR = path.join(REPO_ROOT, 'frontend/web/app')

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldType =
  | 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'u256'
  | 'i8' | 'i16' | 'i32' | 'i64' | 'i128' | 'i256'
  | 'f32' | 'f64'
  | 'string' | 'bool' | 'bytes'
  | 'identity' | 'address' | 'timestamp'
  | 'array' | 'option' | 'object' | 'ref' | 'enum' | 'unknown'

interface FieldSpec {
  name: string
  type: FieldType
  innerType?: FieldType
  isOptional: boolean
  refType?: string   // for type references like `return CreateLeadParams`
}

interface ReducerBinding {
  reducerName: string
  args: FieldSpec[]
  paramsTypeName?: string  // name of the params struct if one arg is a ref
}

interface ParamsTypeDef {
  typeName: string
  fields: FieldSpec[]
}

interface HookCall {
  reducerName: string
  hookFile: string
  hookFn: string
  callSite: string          // raw snippet of the body JSON.stringify call
  argCount?: number         // how many positional args detected
  passedFields?: string[]   // field names detected in the params object
}

interface ApiServerHandler {
  reducerName: string
  routeFile: string
  extractedFields: string[] // fields extracted via body.get("field")
  passesRawBody: boolean    // true if body is passed directly (no transform)
}

interface AnalysisIssue {
  severity: 'ERROR' | 'WARN' | 'INFO'
  message: string
}

interface ReducerReport {
  reducerName: string
  binding?: ReducerBinding
  hookCall?: HookCall
  apiHandler?: ApiServerHandler
  issues: AnalysisIssue[]
}

// ── File walking ──────────────────────────────────────────────────────────────

function walkDir(dir: string, ext: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      results.push(...walkDir(full, ext))
    } else if (e.isFile() && e.name.endsWith(ext)) {
      results.push(full)
    }
  }
  return results
}

function readFile(p: string): string {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

// ── Pass 1: Parse reducer binding files ──────────────────────────────────────

/**
 * Maps __t.xxx() call strings to FieldType.
 * e.g.  "__t.u64()" → 'u64'
 *       "__t.option(__t.string())" → 'option' (innerType: 'string')
 */
function parseTypeDescriptor(raw: string): Pick<FieldSpec, 'type' | 'innerType' | 'isOptional'> {
  const s = raw.trim()

  if (s.startsWith('__t.option(')) {
    const inner = s.slice('__t.option('.length, -1).trim()
    const innerParsed = parseTypeDescriptor(inner)
    return { type: 'option', innerType: innerParsed.type, isOptional: true }
  }
  if (s.startsWith('__t.array(')) return { type: 'array', isOptional: false }
  if (s === '__t.u8()') return { type: 'u8', isOptional: false }
  if (s === '__t.u16()') return { type: 'u16', isOptional: false }
  if (s === '__t.u32()') return { type: 'u32', isOptional: false }
  if (s === '__t.u64()') return { type: 'u64', isOptional: false }
  if (s === '__t.u128()') return { type: 'u128', isOptional: false }
  if (s === '__t.u256()') return { type: 'u256', isOptional: false }
  if (s === '__t.i8()') return { type: 'i8', isOptional: false }
  if (s === '__t.i16()') return { type: 'i16', isOptional: false }
  if (s === '__t.i32()') return { type: 'i32', isOptional: false }
  if (s === '__t.i64()') return { type: 'i64', isOptional: false }
  if (s === '__t.f32()') return { type: 'f32', isOptional: false }
  if (s === '__t.f64()') return { type: 'f64', isOptional: false }
  if (s === '__t.string()') return { type: 'string', isOptional: false }
  if (s === '__t.bool()') return { type: 'bool', isOptional: false }
  if (s === '__t.bytes()') return { type: 'bytes', isOptional: false }
  if (s === '__t.identity()') return { type: 'identity', isOptional: false }
  if (s === '__t.address()') return { type: 'address', isOptional: false }
  if (s === '__t.timestamp()') return { type: 'timestamp', isOptional: false }
  if (s === '__t.object(') return { type: 'object', isOptional: false }
  return { type: 'unknown', isOptional: false }
}

/** Consume a balanced `(...)` starting at `start` (must point at `(`). Returns index after closing `)`. */
function skipBalancedParen(s: string, start: number): number {
  let depth = 0
  let i = start
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return i
}

/**
 * Parse a full `__t....(...)` type expression starting at `start` (must begin with `__t.`).
 * Handles nested parens e.g. `__t.array(__t.identity())`, `__t.option(__t.string())`.
 */
function consumeTypeExpr(s: string, start: number): { end: number; expr: string } | null {
  if (!s.slice(start).startsWith('__t.')) return null
  let j = start
  while (j < s.length && s[j] !== '(') j++
  if (j >= s.length || s[j] !== '(') return null
  const end = skipBalancedParen(s, j)
  return { end, expr: s.slice(start, end).trim() }
}

/**
 * Extract reducer arg field specs from `export default { ... }` body (nested `__t.*` safe).
 */
function parseReducerExportFields(exportBody: string): { fields: FieldSpec[]; paramsTypeName?: string } {
  const fields: FieldSpec[] = []
  let paramsTypeName: string | undefined

  // Property lines: `  fieldName: __t....,` (single-line)
  const lines = exportBody.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const prop = line.match(/^\s{2}(\w+):\s*(.*)$/)
    if (!prop) continue
    const name = prop[1]
    let rest = prop[2].replace(/,\s*$/, '').trim()
    if (!rest.startsWith('__t.')) continue
    const consumed = consumeTypeExpr(rest, 0)
    if (!consumed) continue
    if (consumed.end !== rest.length) continue // only whole-line descriptors
    const parsed = parseTypeDescriptor(consumed.expr)
    fields.push({ name, ...parsed })
  }

  // Getters: `get foo() { return TypeOrExpr; }` (possibly multiline)
  const getterRe =
    /get (\w+)\(\)\s*\{[\s\n\r]*return\s+([\s\S]*?);[\s\n\r]*\}/g
  let m: RegExpExecArray | null
  while ((m = getterRe.exec(exportBody)) !== null) {
    const [, name, ret] = m
    const retTrim = ret.trim()
    if (retTrim.startsWith('__t.')) {
      const parsed = parseTypeDescriptor(retTrim)
      fields.push({ name, ...parsed })
    } else {
      const typeName = retTrim.replace(/\s+/g, '')
      fields.push({ name, type: 'ref', isOptional: false, refType: typeName })
    }
    if (name === 'params' || name.endsWith('Params')) {
      const tn = retTrim.startsWith('__t.') ? undefined : retTrim.replace(/\s+/g, '')
      if (tn && /^[A-Za-z_]\w*$/.test(tn)) paramsTypeName = tn
    }
  }

  return { fields, paramsTypeName }
}

function loadReducerBindings(): Map<string, ReducerBinding> {
  const bindings = new Map<string, ReducerBinding>()

  const reducerFiles = readdirSync(GENERATED_DIR).filter(f => f.endsWith('_reducer.ts'))

  for (const file of reducerFiles) {
    const reducerName = file.replace('_reducer.ts', '')
    const src = readFile(path.join(GENERATED_DIR, file))

    // Extract the default export block
    const exportMatch = src.match(/export default \{([\s\S]*?)\};/)
    if (!exportMatch) continue
    const exportBody = exportMatch[1]

    const { fields: args, paramsTypeName } = parseReducerExportFields(exportBody)

    bindings.set(reducerName, { reducerName, args, paramsTypeName })
  }

  return bindings
}

// ── Pass 2: Parse types.ts for param struct definitions ───────────────────────

function loadParamTypes(): Map<string, ParamsTypeDef> {
  const types = new Map<string, ParamsTypeDef>()
  const src = readFile(path.join(GENERATED_DIR, 'types.ts'))

  // Match: export const XxxParams = __t.object("XxxParams", { ... });
  // We need to handle nested parens for the object body
  const startRe = /export const (\w+Params) = __t\.object\("[^"]+",\s*\{/g
  let startMatch: RegExpExecArray | null

  while ((startMatch = startRe.exec(src)) !== null) {
    const typeName = startMatch[1]
    const startIdx = startMatch.index + startMatch[0].length

    // Find matching closing }); by counting braces
    let depth = 1
    let i = startIdx
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    const bodyStr = src.slice(startIdx, i - 1)

    const fields: FieldSpec[] = []

    // Simple fields: fieldName: __t.xxx(),
    const fieldRe = /^\s{2}(\w+):\s*(__t\.[^,\n]+),?\s*$/gm
    let m: RegExpExecArray | null
    while ((m = fieldRe.exec(bodyStr)) !== null) {
      const [, name, typeStr] = m
      const parsed = parseTypeDescriptor(typeStr.trim())
      fields.push({ name, ...parsed })
    }

    // Getter fields: get fieldName() { return SomeType; }
    const getterRe = /get (\w+)\(\)\s*\{[\s\n\r]*return ([\w]+);[\s\n\r]*\}/g
    while ((m = getterRe.exec(bodyStr)) !== null) {
      const [, name, typeName] = m
      fields.push({ name, type: 'ref', isOptional: false, refType: typeName })
    }

    types.set(typeName, { typeName, fields })
  }

  return types
}

// ── Pass 3: Scan query-hooks for reducer call sites ───────────────────────────

/**
 * Heuristic: detect whether a value expression looks like it might be
 * a number (not bigint) being passed for a u64 field.
 * Flags: plain numeric literals, `.length`, Date.now(), parseInt(), parseFloat()
 */
function looksLikeNumber(expr: string): boolean {
  const e = expr.trim()
  if (/^\d+$/.test(e)) return true                    // numeric literal
  if (e.endsWith('.length')) return true               // array/string length
  if (e.startsWith('Date.now()')) return true          // timestamp ms
  if (/^parseInt\(/.test(e)) return true
  if (/^parseFloat\(/.test(e)) return true
  if (/^Number\(/.test(e)) return true
  return false
}

function looksLikeBigint(expr: string): boolean {
  const e = expr.trim()
  if (/^BigInt\(/.test(e)) return true
  if (/^(\d+)n$/.test(e)) return true                 // bigint literal
  if (/BigInt/.test(e)) return true
  if (e.startsWith('organizationId') || e.startsWith('orgId')) return true
  return false
}

function extractCallBody(src: string, startIdx: number): string {
  // Extract content inside JSON.stringify([...]) or JSON.stringify({...})
  // starting at startIdx — long enough for multi-line stdbParamsToJson bodies
  return src.slice(startIdx, Math.min(startIdx + 8192, src.length))
}

/** Count top-level elements in `[a, b, c]` / `[a, b, c,]` (handles trailing commas, nested `()`/`[]`/`{}`). */
function countTopLevelArgsInBracketArray(arrayLiteral: string): number {
  const t = arrayLiteral.trim()
  if (!t.startsWith('[') || !t.endsWith(']')) return 0
  const inner = t.slice(1, -1)
  let depth = 0
  let start = 0
  let count = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      const part = inner.slice(start, i).trim()
      if (part) count++
      start = i + 1
    }
  }
  const last = inner.slice(start).trim()
  if (last) count++
  return count
}

function loadHookCalls(): Map<string, HookCall[]> {
  const calls = new Map<string, HookCall[]>()

  const hookFiles = walkDir(HOOKS_DIR, '.ts')
  // Also check web/lib params files and web/app for direct calls
  const webLibFiles = walkDir(WEB_LIB_DIR, '.ts')
  const webAppFiles = walkDir(WEB_APP_DIR, '.tsx')

  const allFiles = [...hookFiles, ...webLibFiles, ...webAppFiles]

  for (const file of allFiles) {
    const src = readFile(file)
    const relFile = path.relative(REPO_ROOT, file)

    // Pattern 1: apiFetch('/api/call/{reducer}', { ... body: JSON.stringify([...]) ... })
    const apiCallRe = /apiFetch\(['"`]\/api\/call\/([a-z_]+)['"`]/g
    let m: RegExpExecArray | null

    while ((m = apiCallRe.exec(src)) !== null) {
      const reducerName = m[1]
      const snippet = extractCallBody(src, m.index)

      // Try to find reducer arg array: same shape as JSON.stringify([...]) or stringifyReducerCallBody([...])
      let bodyMatch = snippet.match(/body:\s*JSON\.stringify\((\[[\s\S]*?\])\s*[,)]/)
      if (!bodyMatch) {
        bodyMatch = snippet.match(/body:\s*stringifyReducerCallBody\((\[[\s\S]*?\])\s*\)/)
      }
      const callSite = bodyMatch ? bodyMatch[1] : snippet.slice(0, 200)

      // Count positional args in the array
      let argCount: number | undefined
      if (bodyMatch) {
        argCount = countTopLevelArgsInBracketArray(bodyMatch[1])
      }

      // Extract field names from params object if detectable
      const passedFields: string[] = []
      const paramsMatch = callSite.match(/\{([^}]{0,2000})\}/)
      if (paramsMatch) {
        const fieldRe = /(\w+)\s*:/g
        let fm: RegExpExecArray | null
        while ((fm = fieldRe.exec(paramsMatch[1])) !== null) {
          passedFields.push(fm[1])
        }
      }

      // Entire params object is passed through serializers — do not require literal keys in source
      if (/\bstdbParamsToJson\s*\(|\bpaymentParamsToJson\s*\(/.test(callSite)) {
        passedFields.length = 0
      }

      const call: HookCall = {
        reducerName,
        hookFile: relFile,
        hookFn: extractFnName(src, m.index),
        callSite,
        argCount,
        passedFields: passedFields.length > 0 ? passedFields : undefined,
      }

      if (!calls.has(reducerName)) calls.set(reducerName, [])
      calls.get(reducerName)!.push(call)
    }

    // Pattern 2: useStdbCallMutation(reducerName, ...) or similar
    const stdbCallRe = /useStdbCallMutation\(['"`]([a-z_]+)['"`]/g
    while ((m = stdbCallRe.exec(src)) !== null) {
      const reducerName = m[1]
      const call: HookCall = {
        reducerName,
        hookFile: relFile,
        hookFn: extractFnName(src, m.index),
        callSite: extractCallBody(src, m.index).slice(0, 200),
      }
      if (!calls.has(reducerName)) calls.set(reducerName, [])
      calls.get(reducerName)!.push(call)
    }
  }

  return calls
}

function extractFnName(src: string, idx: number): string {
  // Walk backwards to find the nearest function name
  const before = src.slice(Math.max(0, idx - 600), idx)
  const m = before.match(/(?:function|export function|export async function)\s+([\w]+)\s*\(/g)
  if (m) return m[m.length - 1].replace(/.*function\s+/, '').replace(/\s*\(/, '')
  const arrowM = before.match(/(export (?:async )?function\s+\w+|const\s+(\w+)\s*=\s*(?:async\s*)?\()/g)
  if (arrowM) {
    const last = arrowM[arrowM.length - 1]
    const nm = last.match(/\b(\w+)\b\s*=/)
    return nm ? nm[1] : '?'
  }
  return '?'
}

/**
 * Return the inner source of a top-level `fn name(...)` body (excluding outer braces),
 * or null if not found / unbalanced.
 */
function extractRustFunctionBodyByName(src: string, fnName: string): string | null {
  const sigRe = new RegExp(`\\bfn\\s+${fnName}\\s*\\(`)
  const sigMatch = sigRe.exec(src)
  if (!sigMatch) return null
  let i = sigMatch.index + sigMatch[0].length
  let depth = 1
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    i++
  }
  if (depth !== 0) return null
  while (i < src.length && src[i] !== '{') {
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else {
      i++
    }
  }
  if (i >= src.length || src[i] !== '{') return null
  i++
  const startBody = i
  depth = 1
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === "'") {
      i++
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  if (depth !== 0) return null
  return src.slice(startBody, i - 1)
}

/** Reducers invoked from query-hooks whose SpacetimeDB module has no generated *_reducer.ts yet. */
const REDUCER_HOOKS_WITHOUT_STDB_BINDINGS = new Set([
  'create_sale_order_line',
  'delete_sale_order_line',
  'lock_sale_order',
  'unlock_sale_order',
  'update_sale_order_line',
])

// ── Pass 4: Scan api-server route handlers ────────────────────────────────────

function loadApiServerHandlers(): Map<string, ApiServerHandler[]> {
  const handlers = new Map<string, ApiServerHandler[]>()

  const rustFiles = walkDir(API_ROUTES_DIR, '.rs')

  for (const file of rustFiles) {
    const src = readFile(file)
    const relFile = path.relative(REPO_ROOT, file)

    // Find: .call_reducer("reducer_name", json!([...]))
    // Some use a variable like json!([org_id, params]) others json!([org_id, body])
    const callRe = /\.call_reducer\s*\(\s*"([a-z_]+)"\s*,\s*json!\s*\(\s*\[([\s\S]*?)\]\s*\)\s*\)/g
    let m: RegExpExecArray | null

    while ((m = callRe.exec(src)) !== null) {
      const reducerName = m[1]
      const argsExpr = m[2].trim()

      // Detect if raw body is passed (last arg is `body`)
      const passesRawBody = /\bbody\b/.test(argsExpr) && !/params/.test(argsExpr)

      // Find associated body.get("field") calls in the surrounding context
      // Look in the 3000 chars before the call_reducer for a transform function
      const context = src.slice(Math.max(0, m.index - 3000), m.index + 500)
      const extractedFields: string[] = []
      // Allow newlines between `body` and `.get("field")` (rustfmt often breaks the chain)
      const fieldRe = /body\s*\.\s*get\s*\(\s*"(\w+)"\s*\)/g
      let fm: RegExpExecArray | null
      while ((fm = fieldRe.exec(context)) !== null) {
        if (!extractedFields.includes(fm[1])) extractedFields.push(fm[1])
      }

      // `let params = foo(&body)?` — body.get keys live in `foo`, often above the 3000-char window
      const nearBefore = src.slice(Math.max(0, m.index - 800), m.index)
      const helperMatch = nearBefore.match(/let\s+params\s*=\s*(\w+)\s*\(\s*&body\s*\)\s*\??/)
      if (helperMatch) {
        const helperBody = extractRustFunctionBodyByName(src, helperMatch[1])
        if (helperBody) {
          fieldRe.lastIndex = 0
          while ((fm = fieldRe.exec(helperBody)) !== null) {
            if (!extractedFields.includes(fm[1])) extractedFields.push(fm[1])
          }
        }
      }

      const handler: ApiServerHandler = {
        reducerName,
        routeFile: relFile,
        extractedFields,
        passesRawBody,
      }

      if (!handlers.has(reducerName)) handlers.set(reducerName, [])
      handlers.get(reducerName)!.push(handler)
    }
  }

  return handlers
}

// ── Pass 5: Cross-reference and report ───────────────────────────────────────

function crossReference(
  bindings: Map<string, ReducerBinding>,
  paramTypes: Map<string, ParamsTypeDef>,
  hookCalls: Map<string, HookCall[]>,
  apiHandlers: Map<string, ApiServerHandler[]>,
): ReducerReport[] {
  const reports: ReducerReport[] = []

  // Union of all reducer names across all sources
  const allReducers = new Set([
    ...bindings.keys(),
    ...hookCalls.keys(),
    ...apiHandlers.keys(),
  ])

  for (const reducerName of allReducers) {
    // Apply filters
    if (reducerFilter && reducerName !== reducerFilter) continue
    if (moduleFilter) {
      const module = guessModule(reducerName)
      if (module !== moduleFilter) continue
    }

    const binding = bindings.get(reducerName)
    const calls = hookCalls.get(reducerName) ?? []
    const handlers = apiHandlers.get(reducerName) ?? []
    const issues: AnalysisIssue[] = []

    // -- Issue: reducer called from frontend but no binding file found
    if (!binding && calls.length > 0 && !REDUCER_HOOKS_WITHOUT_STDB_BINDINGS.has(reducerName)) {
      issues.push({
        severity: 'WARN',
        message: `Called from frontend but no *_reducer.ts binding found — bindings may be stale`,
      })
    }

    // -- Issue: reducer has no frontend call site and no api-server handler
    if (binding && calls.length === 0 && handlers.length === 0) {
      if (!isExcludedReducer(reducerName)) {
        issues.push({ severity: 'INFO', message: `No frontend call site found` })
      }
    }

    if (binding) {
      // Resolve the params type if the last arg is a ref
      const paramsArg = binding.args.find(a => a.type === 'ref')
      const paramsType = paramsArg?.refType ? paramTypes.get(paramsArg.refType) : undefined

      // -- Check arg count matches between binding and hook calls
      for (const call of calls) {
        if (call.argCount !== undefined && call.argCount !== binding.args.length) {
          issues.push({
            severity: 'ERROR',
            message: `Arg count mismatch: binding expects ${binding.args.length} args [${binding.args.map(a => a.name).join(', ')}], hook passes ${call.argCount} args — in ${call.hookFile}`,
          })
        }
      }

      // -- Check api-server handler: fields extracted vs params type fields
      for (const handler of handlers) {
        if (!handler.passesRawBody && paramsType && handler.extractedFields.length > 0) {
          // Check for missing required fields in api-server extraction
          for (const field of paramsType.fields) {
            if (!field.isOptional && field.type !== 'ref') {
              if (!handler.extractedFields.includes(field.name)) {
                issues.push({
                  severity: 'WARN',
                  message: `Required field "${field.name}" (${field.type}) not extracted in api-server handler — ${handler.routeFile}`,
                })
              }
            }
          }

          // Check for fields extracted but not in params type
          for (const extracted of handler.extractedFields) {
            const inType = paramsType.fields.find(f => f.name === extracted)
            if (!inType) {
              issues.push({
                severity: 'INFO',
                message: `Field "${extracted}" extracted in api-server but not in ${paramsArg?.refType} — may be extra or field was renamed`,
              })
            }
          }
        }
      }

      // -- Check params fields against what frontend hooks pass
      if (paramsType) {
        for (const call of calls) {
          if (!call.passedFields || call.passedFields.length === 0) continue

          for (const field of paramsType.fields) {
            if (field.isOptional) continue  // Optional fields are fine if absent
            if (field.type === 'ref') continue

            if (!call.passedFields.includes(field.name)) {
              issues.push({
                severity: 'WARN',
                message: `Required field "${field.name}" (${formatType(field)}) may be missing in hook call — ${call.hookFile}`,
              })
            }
          }
        }
      }

      // -- Type hazard checks for u64/bigint
      for (const call of calls) {
        checkU64Hazards(call, binding, paramsType, issues)
        checkTimestampHazards(call, paramsType, issues)
      }
    }

    reports.push({
      reducerName,
      binding,
      hookCall: calls[0],
      apiHandler: handlers[0],
      issues,
    })
  }

  return reports.sort((a, b) => {
    // Sort: issues first, then by name
    const aHasErrors = a.issues.some(i => i.severity === 'ERROR')
    const bHasErrors = b.issues.some(i => i.severity === 'ERROR')
    if (aHasErrors && !bHasErrors) return -1
    if (!aHasErrors && bHasErrors) return 1
    const aHasWarns = a.issues.some(i => i.severity === 'WARN')
    const bHasWarns = b.issues.some(i => i.severity === 'WARN')
    if (aHasWarns && !bHasWarns) return -1
    if (!aHasWarns && bHasWarns) return 1
    return a.reducerName.localeCompare(b.reducerName)
  })
}

function checkU64Hazards(
  call: HookCall,
  binding: ReducerBinding,
  paramsType: ParamsTypeDef | undefined,
  issues: AnalysisIssue[],
) {
  // Look for u64 fields in the binding args (e.g. organizationId, leadId)
  for (const arg of binding.args) {
    if (arg.type === 'u64' || arg.type === 'u128') {
      // Check the callSite for how this arg is passed
      // Pattern: second element in array [String(orgId), ...]
      // If we see a plain number being passed for a positional u64 arg...
      const posIdx = binding.args.indexOf(arg)
      const snippetPart = call.callSite.split(',')[posIdx]
      if (snippetPart && looksLikeNumber(snippetPart) && !looksLikeBigint(snippetPart)) {
        issues.push({
          severity: 'WARN',
          message: `Positional arg "${arg.name}" (${arg.type}) may be passed as JS number — use String(value) or BigInt for u64 fields. In ${call.hookFile}`,
        })
      }
    }
  }

  // Check params object fields too
  if (paramsType && call.callSite) {
    for (const field of paramsType.fields) {
      if (field.type === 'u64' || field.type === 'u128') {
        // Look for field: <expr> in the call site
        const fieldPattern = new RegExp(`\\b${field.name}\\s*:\\s*([^,}\n]+)`)
        const fm = call.callSite.match(fieldPattern)
        if (fm && looksLikeNumber(fm[1]) && !looksLikeBigint(fm[1])) {
          issues.push({
            severity: 'WARN',
            message: `Params field "${field.name}" (u64) looks like a JS number — stdbParamsToJson won't stringify it. Use BigInt() or pass as bigint. In ${call.hookFile}`,
          })
        }
      }
    }
  }
}

function checkTimestampHazards(
  call: HookCall,
  paramsType: ParamsTypeDef | undefined,
  issues: AnalysisIssue[],
) {
  if (!paramsType || !call.callSite) return
  for (const field of paramsType.fields) {
    const effectiveType = field.type === 'option' ? field.innerType : field.type
    if (effectiveType !== 'timestamp') continue

    // Look for field: <expr> in the call site
    const fieldPattern = new RegExp(`\\b${field.name}\\s*:\\s*([^,}\n]+)`)
    const fm = call.callSite.match(fieldPattern)
    if (!fm) continue
    const expr = fm[1].trim()

    // Hazard: passing a raw string (ISO date) instead of stdbTimestamp object
    if (
      /new Date\(/.test(expr) ||
      /Date\.now\(\)/.test(expr) ||
      (/["']/.test(expr) && !expr.includes('microsSinceUnixEpoch'))
    ) {
      issues.push({
        severity: 'WARN',
        message: `Params field "${field.name}" (timestamp) may not be in {microsSinceUnixEpoch} format. Use stdbTimestampFromDate() helper. In ${call.hookFile}`,
      })
    }
  }
}

function formatType(f: FieldSpec): string {
  if (f.type === 'option') return `Option<${f.innerType ?? '?'}>`
  if (f.type === 'ref') return f.refType ?? 'ref'
  return f.type
}

// ── Module classification ─────────────────────────────────────────────────────

const MODULE_PREFIXES: [RegExp, string][] = [
  [/^create_lead|^update_lead|^delete_lead|^create_contact|^update_contact|^delete_contact|^create_activity|^update_activity|^add_contact_to_segment|^create_opportunity|^update_opportunity/, 'crm'],
  [/^create_sale|^update_sale|^confirm_sale|^cancel_sale|^add_sale|^update_sale_order/, 'sales'],
  [/^create_stock|^update_stock|^create_product|^update_product|^confirm_picking|^validate_picking|^create_warehouse|^update_warehouse|^create_lot|^update_lot|^create_inventory|^update_inventory/, 'inventory'],
  [/^create_account|^update_account|^create_invoice|^post_invoice|^cancel_invoice|^create_journal|^create_payment|^confirm_payment|^create_analytic|^update_analytic|^create_budget|^open_fiscal|^close_fiscal|^create_fiscal|^update_fiscal|^create_period|^add_account/, 'accounting'],
  [/^create_purchase|^update_purchase|^confirm_purchase|^cancel_purchase|^add_purchase|^create_requisition/, 'purchasing'],
  [/^create_project|^update_project|^create_task|^update_task|^log_timesheet|^create_timesheet/, 'projects'],
  [/^create_employee|^update_employee|^create_leave|^approve_leave|^create_payslip|^generate_payslip|^create_department|^create_hr/, 'hr'],
  [/^create_subscription|^update_subscription|^activate_subscription|^cancel_subscription|^renew_subscription|^pause_subscription/, 'subscriptions'],
  [/^create_helpdesk|^update_helpdesk|^assign_helpdesk|^close_helpdesk/, 'helpdesk'],
  [/^create_mrp|^update_mrp|^confirm_mrp|^plan_production|^create_bom|^update_bom|^create_workcenter/, 'manufacturing'],
  [/^create_user|^update_user|^create_role|^update_role|^create_company|^update_company|^create_country|^create_currency/, 'settings'],
  [/^create_document|^update_document|^add_document|^create_article|^update_article/, 'documents'],
  [/^create_proposal|^update_proposal|^add_proposal/, 'proposals'],
  [/^create_pos|^update_pos|^open_pos|^close_pos/, 'pos'],
  [/^create_fleet|^update_fleet/, 'fleet'],
  [/^create_report|^update_report|^generate_report/, 'reports'],
  [/^create_workflow|^update_workflow|^trigger_workflow/, 'workflows'],
  [/^acknowledge_iot|^create_iot|^update_iot/, 'iot'],
]

function guessModule(reducerName: string): string {
  for (const [re, module] of MODULE_PREFIXES) {
    if (re.test(reducerName)) return module
  }
  return 'other'
}

function isExcludedReducer(name: string): boolean {
  return /^(seed_|import_|bootstrap_|ensure_dev|queue_|add_casbin|update_casbin|remove_casbin|load_casbin|add_org_member|add_user_to_org|add_form_field|update_form_field|delete_form_field|set_form_role|add_user_custom|delete_user_custom|client_connected|client_disconnected|init$)/.test(name)
}

// ── Report printing ───────────────────────────────────────────────────────────

function printReport(reports: ReducerReport[], bindings: Map<string, ReducerBinding>) {
  const errors = reports.filter(r => r.issues.some(i => i.severity === 'ERROR'))
  const warns = reports.filter(r => r.issues.some(i => i.severity === 'WARN') && !r.issues.some(i => i.severity === 'ERROR'))
  const infos = reports.filter(r => r.issues.every(i => i.severity === 'INFO'))
  const clean = reports.filter(r => r.issues.length === 0 && !isExcludedReducer(r.reducerName))

  console.log('\n╔══════════════════════════════════════════════════════════')
  console.log('║  Reducer Type Analysis Report')
  console.log('╚══════════════════════════════════════════════════════════\n')

  if (moduleFilter) console.log(`  Filter: module = ${moduleFilter}`)
  if (reducerFilter) console.log(`  Filter: reducer = ${reducerFilter}`)

  // Group by module for display
  const byModule = new Map<string, ReducerReport[]>()
  for (const r of reports) {
    if (onlyIssues && r.issues.length === 0) continue
    const mod = guessModule(r.reducerName)
    if (!byModule.has(mod)) byModule.set(mod, [])
    byModule.get(mod)!.push(r)
  }

  for (const [mod, reps] of [...byModule.entries()].sort()) {
    const hasIssues = reps.some(r => r.issues.length > 0)
    if (onlyIssues && !hasIssues) continue

    console.log(`\n── ${mod.toUpperCase()} ${'─'.repeat(Math.max(0, 50 - mod.length))}`)

    for (const report of reps) {
      const hasErrors = report.issues.some(i => i.severity === 'ERROR')
      const hasWarns = report.issues.some(i => i.severity === 'WARN')

      if (report.issues.length === 0) {
        if (!onlyIssues) {
          console.log(`  ✓ ${report.reducerName}`)
        }
      } else {
        const prefix = hasErrors ? '✗' : hasWarns ? '△' : 'ℹ'
        const binding = report.binding
        const argList = binding ? `(${binding.args.map(a => `${a.name}: ${formatType(a)}`).join(', ')})` : ''
        console.log(`  ${prefix} ${report.reducerName} ${argList}`)
        for (const issue of report.issues) {
          const icon = issue.severity === 'ERROR' ? '    [ERROR]' : issue.severity === 'WARN' ? '    [WARN] ' : '    [INFO] '
          console.log(`${icon} ${issue.message}`)
        }
      }
    }
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('══════════════════════════════════════════════════════════')
  console.log(`  Total reducer bindings:  ${bindings.size}`)
  console.log(`  Analyzed:                ${reports.length}`)
  console.log(`  ✗ Errors:                ${errors.length}`)
  console.log(`  △ Warnings:              ${warns.length}`)
  console.log(`  ℹ Infos:                 ${infos.length}`)
  console.log(`  ✓ Clean:                 ${clean.length}`)
  console.log('')

  if (errors.length > 0) {
    console.log('  Top errors to fix first:')
    for (const r of errors.slice(0, 10)) {
      const errMsg = r.issues.find(i => i.severity === 'ERROR')?.message ?? ''
      console.log(`    • ${r.reducerName}: ${errMsg.slice(0, 100)}`)
    }
    console.log('')
  }

  if (warns.length > 0 && warns.length <= 20) {
    console.log('  Warnings:')
    for (const r of warns.slice(0, 20)) {
      const warnMsg = r.issues.find(i => i.severity === 'WARN')?.message ?? ''
      console.log(`    • ${r.reducerName}: ${warnMsg.slice(0, 100)}`)
    }
    console.log('')
  }

  console.log('  Run with --only-issues to hide clean reducers')
  console.log('  Run with --module <name> to filter by module')
  console.log('  Run with --reducer <name> to inspect one reducer\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading reducer bindings...')
  const bindings = loadReducerBindings()
  console.log(`  Found ${bindings.size} reducer bindings`)

  console.log('Loading param types...')
  const paramTypes = loadParamTypes()
  console.log(`  Found ${paramTypes.size} param type definitions`)

  console.log('Scanning hook call sites...')
  const hookCalls = loadHookCalls()
  console.log(`  Found calls for ${hookCalls.size} reducers`)

  console.log('Scanning api-server handlers...')
  const apiHandlers = loadApiServerHandlers()
  console.log(`  Found ${apiHandlers.size} reducers with api-server handlers`)

  console.log('Cross-referencing...\n')
  const reports = crossReference(bindings, paramTypes, hookCalls, apiHandlers)

  printReport(reports, bindings)
}

main().catch(e => {
  console.error('Error:', e)
  process.exit(1)
})
