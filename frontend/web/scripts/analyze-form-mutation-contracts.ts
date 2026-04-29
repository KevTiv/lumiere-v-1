#!/usr/bin/env node
/**
 * Form -> mutation contract analyzer
 *
 * Scans `frontend/web` for forms in active use and reports whether:
 * - form fields are actually consumed by the submit handler
 * - submit handlers read fields that do not exist on the form
 * - mutation payload keys line up with the reducer param struct when resolvable
 * - form usages delegate through action routers cleanly
 *
 * Run:
 *   npx tsx scripts/analyze-form-mutation-contracts.ts
 *   npx tsx scripts/analyze-form-mutation-contracts.ts --only-issues
 *   npx tsx scripts/analyze-form-mutation-contracts.ts --file inventory-client
 *   npx tsx scripts/analyze-form-mutation-contracts.ts --json
 *   npx tsx scripts/analyze-form-mutation-contracts.ts --rollup
 *   npx tsx scripts/analyze-form-mutation-contracts.ts --rollup-json
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import * as path from "path"
import ts from "typescript"

const args = process.argv.slice(2)
const onlyIssues = args.includes("--only-issues")
const jsonOutput = args.includes("--json")
const rollupTable = args.includes("--rollup")
const rollupJson = args.includes("--rollup-json")
const fileFilter = args.find((_, i) => args[i - 1] === "--file")

/** Match `app/(modules)/<name>/...` in analyzer-relative paths */
const MODULE_SEGMENT_RE = /\(modules\)\/([^/]+)\//

const __filename = new URL(import.meta.url).pathname
const __dirname = path.dirname(__filename)
const WEB_ROOT = path.resolve(__dirname, "..")
const REPO_ROOT = path.resolve(WEB_ROOT, "../..")
const WEB_APP_DIR = path.join(WEB_ROOT, "app")
const QUERY_HOOKS_DIR = path.join(REPO_ROOT, "frontend/packages/query-hooks/src/hooks")
const GENERATED_DIR = path.join(REPO_ROOT, "frontend/packages/stdb/src/generated")

type Severity = "ERROR" | "WARN" | "INFO"

type FieldType =
  | "u8" | "u16" | "u32" | "u64" | "u128" | "u256"
  | "i8" | "i16" | "i32" | "i64" | "i128" | "i256"
  | "f32" | "f64"
  | "string" | "bool" | "bytes"
  | "identity" | "address" | "timestamp"
  | "array" | "option" | "object" | "ref" | "enum" | "unknown"

interface FieldSpec {
  name: string
  type: FieldType
  innerType?: FieldType
  isOptional: boolean
  refType?: string
}

interface ReducerBinding {
  reducerName: string
  args: FieldSpec[]
  paramsTypeName?: string
}

interface ParamsTypeDef {
  typeName: string
  fields: FieldSpec[]
}

interface Issue {
  severity: Severity
  message: string
}

interface FieldMapping {
  targetPath: string
  sourceFields: string[]
}

interface AnalyzedMutation {
  reducerName?: string
  mutationVar?: string
  mappedFields: FieldMapping[]
}

interface HandlerAnalysis {
  usedFormFields: Set<string>
  mutations: AnalyzedMutation[]
  unresolved: string[]
}

interface FormUsageReport {
  kind: "direct" | "router" | "module-view"
  sourceFile: string
  location: string
  label: string
  action?: string
  reducerNames: string[]
  formFields: string[]
  usedFormFields: string[]
  mutationMappings: FieldMapping[]
  issues: Issue[]
  unresolved: string[]
}

interface ActionFormMapping {
  action: string
  formExpr: ts.Expression
  source: string
}

interface StateFormMapping extends ActionFormMapping {
  stateVar: string
}

interface Resolution<T> {
  values: T[]
  unresolved: string[]
}

function walkDir(dir: string, ext: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkDir(full, ext))
    else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full)
  }
  return out
}

function readFile(p: string): string {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return ""
  }
}

function rel(p: string): string {
  return path.relative(REPO_ROOT, p)
}

function lineOf(node: ts.Node): number {
  return ts.getLineAndCharacterOfPosition(node.getSourceFile(), node.getStart()).line + 1
}

function pathAndLine(node: ts.Node): string {
  return `${rel(node.getSourceFile().fileName)}:${lineOf(node)}`
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current =
      ts.isParenthesizedExpression(current) ? current.expression :
      ts.isAsExpression(current) ? current.expression :
      ts.isTypeAssertionExpression(current) ? current.expression :
      ts.isNonNullExpression(current) ? current.expression :
      current.expression
  }
  return current
}

function getPropertyNameText(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function parseTypeDescriptor(raw: string): Pick<FieldSpec, "type" | "innerType" | "isOptional"> {
  const s = raw.trim()
  if (s.startsWith("__t.option(")) {
    const inner = s.slice("__t.option(".length, -1).trim()
    const innerParsed = parseTypeDescriptor(inner)
    return { type: "option", innerType: innerParsed.type, isOptional: true }
  }
  if (s.startsWith("__t.array(")) return { type: "array", isOptional: false }
  if (s === "__t.u8()") return { type: "u8", isOptional: false }
  if (s === "__t.u16()") return { type: "u16", isOptional: false }
  if (s === "__t.u32()") return { type: "u32", isOptional: false }
  if (s === "__t.u64()") return { type: "u64", isOptional: false }
  if (s === "__t.u128()") return { type: "u128", isOptional: false }
  if (s === "__t.u256()") return { type: "u256", isOptional: false }
  if (s === "__t.i8()") return { type: "i8", isOptional: false }
  if (s === "__t.i16()") return { type: "i16", isOptional: false }
  if (s === "__t.i32()") return { type: "i32", isOptional: false }
  if (s === "__t.i64()") return { type: "i64", isOptional: false }
  if (s === "__t.f32()") return { type: "f32", isOptional: false }
  if (s === "__t.f64()") return { type: "f64", isOptional: false }
  if (s === "__t.string()") return { type: "string", isOptional: false }
  if (s === "__t.bool()") return { type: "bool", isOptional: false }
  if (s === "__t.bytes()") return { type: "bytes", isOptional: false }
  if (s === "__t.identity()") return { type: "identity", isOptional: false }
  if (s === "__t.address()") return { type: "address", isOptional: false }
  if (s === "__t.timestamp()") return { type: "timestamp", isOptional: false }
  return { type: "unknown", isOptional: false }
}

function skipBalancedParen(s: string, start: number): number {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === "(") depth++
    else if (s[i] === ")") {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return s.length
}

function consumeTypeExpr(s: string, start: number): { end: number; expr: string } | null {
  if (!s.slice(start).startsWith("__t.")) return null
  let j = start
  while (j < s.length && s[j] !== "(") j++
  if (j >= s.length || s[j] !== "(") return null
  const end = skipBalancedParen(s, j)
  return { end, expr: s.slice(start, end).trim() }
}

function parseReducerExportFields(exportBody: string): { fields: FieldSpec[]; paramsTypeName?: string } {
  const fields: FieldSpec[] = []
  let paramsTypeName: string | undefined
  const lines = exportBody.split(/\r?\n/)
  for (const rawLine of lines) {
    const prop = rawLine.trimEnd().match(/^\s{2}(\w+):\s*(.*)$/)
    if (!prop) continue
    const name = prop[1]
    const rest = prop[2].replace(/,\s*$/, "").trim()
    if (!rest.startsWith("__t.")) continue
    const consumed = consumeTypeExpr(rest, 0)
    if (!consumed || consumed.end !== rest.length) continue
    fields.push({ name, ...parseTypeDescriptor(consumed.expr) })
  }
  const getterRe = /get (\w+)\(\)\s*\{[\s\n\r]*return\s+([\s\S]*?);[\s\n\r]*\}/g
  let m: RegExpExecArray | null
  while ((m = getterRe.exec(exportBody)) !== null) {
    const [, name, ret] = m
    const retTrim = ret.trim()
    if (retTrim.startsWith("__t.")) {
      fields.push({ name, ...parseTypeDescriptor(retTrim) })
    } else {
      const refType = retTrim.replace(/\s+/g, "")
      fields.push({ name, type: "ref", isOptional: false, refType })
      if ((name === "params" || name.endsWith("Params")) && /^[A-Za-z_]\w*$/.test(refType)) {
        paramsTypeName = refType
      }
    }
  }
  return { fields, paramsTypeName }
}

function loadReducerBindings(): Map<string, ReducerBinding> {
  const bindings = new Map<string, ReducerBinding>()
  for (const file of readdirSync(GENERATED_DIR).filter((f) => f.endsWith("_reducer.ts"))) {
    const reducerName = file.replace("_reducer.ts", "")
    const src = readFile(path.join(GENERATED_DIR, file))
    const exportMatch = src.match(/export default \{([\s\S]*?)\};/)
    if (!exportMatch) continue
    const parsed = parseReducerExportFields(exportMatch[1])
    bindings.set(reducerName, { reducerName, args: parsed.fields, paramsTypeName: parsed.paramsTypeName })
  }
  return bindings
}

function loadParamTypes(): Map<string, ParamsTypeDef> {
  const types = new Map<string, ParamsTypeDef>()
  const src = readFile(path.join(GENERATED_DIR, "types.ts"))
  const startRe = /export const (\w+Params) = __t\.object\("[^"]+",\s*\{/g
  let startMatch: RegExpExecArray | null
  while ((startMatch = startRe.exec(src)) !== null) {
    const typeName = startMatch[1]
    const startIdx = startMatch.index + startMatch[0].length
    let depth = 1
    let i = startIdx
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++
      else if (src[i] === "}") depth--
      i++
    }
    const bodyStr = src.slice(startIdx, i - 1)
    const fields: FieldSpec[] = []
    const fieldRe = /^\s{2}(\w+):\s*(__t\.[^,\n]+),?\s*$/gm
    let m: RegExpExecArray | null
    while ((m = fieldRe.exec(bodyStr)) !== null) {
      fields.push({ name: m[1], ...parseTypeDescriptor(m[2].trim()) })
    }
    const getterRe = /get (\w+)\(\)\s*\{[\s\n\r]*return ([\w]+);[\s\n\r]*\}/g
    while ((m = getterRe.exec(bodyStr)) !== null) {
      fields.push({ name: m[1], type: "ref", isOptional: false, refType: m[2] })
    }
    types.set(typeName, { typeName, fields })
  }
  return types
}

function loadHookReducerMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const file of walkDir(QUERY_HOOKS_DIR, ".ts")) {
    const src = readFile(file)
    const fnRe = /export function (\w+)\(/g
    let fm: RegExpExecArray | null
    while ((fm = fnRe.exec(src)) !== null) {
      const hookName = fm[1]
      const bodyStart = fm.index + fm[0].length
      const nextFn = src.indexOf("\nexport function ", bodyStart)
      const chunk = nextFn === -1 ? src.slice(bodyStart) : src.slice(bodyStart, nextFn)
      const callMatch = chunk.match(/apiFetch\(['"`]\/api\/call\/([a-z_]+)(?:\?[^'"`]+)?['"`]/)
      if (callMatch) map.set(hookName, callMatch[1])
    }
  }
  return map
}

function loadProgram(): ts.Program {
  const configPath = ts.findConfigFile(WEB_ROOT, ts.sys.fileExists, "tsconfig.json")
  if (!configPath) throw new Error("Could not find frontend/web/tsconfig.json")
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"))
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath))
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  })
}

const reducerBindings = loadReducerBindings()
const paramTypes = loadParamTypes()
const hookReducerMap = loadHookReducerMap()
const program = loadProgram()
const checker = program.getTypeChecker()

function resolveAliasedSymbol(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  if (!symbol) return undefined
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol)
    } catch {
      return symbol
    }
  }
  return symbol
}

function getSymbol(node: ts.Node): ts.Symbol | undefined {
  try {
    return resolveAliasedSymbol(checker.getSymbolAtLocation(node))
  } catch {
    return undefined
  }
}

function getDeclarationFromExpression(expr: ts.Expression): ts.Declaration | undefined {
  if (!ts.isIdentifier(expr)) return undefined
  return getSymbol(expr)?.declarations?.[0]
}

function getFunctionLikeFromExpression(expr: ts.Expression): ts.FunctionLikeDeclaration | undefined {
  const unwrapped = unwrapExpression(expr)
  if (
    ts.isArrowFunction(unwrapped) ||
    ts.isFunctionExpression(unwrapped) ||
    ts.isFunctionDeclaration(unwrapped) ||
    ts.isMethodDeclaration(unwrapped)
  ) return unwrapped
  const decl = getDeclarationFromExpression(unwrapped)
  if (!decl) return undefined
  if (
    ts.isFunctionDeclaration(decl) ||
    ts.isMethodDeclaration(decl) ||
    ts.isFunctionExpression(decl) ||
    ts.isArrowFunction(decl)
  ) return decl
  if (ts.isVariableDeclaration(decl) && decl.initializer) {
    const init = unwrapExpression(decl.initializer)
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init
  }
  return undefined
}

function getReturnedExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body]
  if (!fn.body || !ts.isBlock(fn.body)) return []
  const out: ts.Expression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression)
    node.forEachChild(visit)
  }
  fn.body.forEachChild(visit)
  return out
}

function mergeResolution<T>(parts: Resolution<T>[]): Resolution<T> {
  const values: T[] = []
  const unresolved: string[] = []
  for (const part of parts) {
    values.push(...part.values)
    unresolved.push(...part.unresolved)
  }
  return { values, unresolved }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

function resolveFunctionReturnExpressions(expr: ts.Expression, seen = new Set<ts.Node>()): Resolution<ts.Expression> {
  const target = unwrapExpression(expr)
  if (seen.has(target)) return { values: [], unresolved: [] }
  seen.add(target)
  if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) {
    return mergeResolution(getReturnedExpressions(target).map((ret) => resolveFunctionReturnExpressions(ret, seen)))
  }
  if (ts.isCallExpression(target)) {
    const callee = unwrapExpression(target.expression)
    if (ts.isIdentifier(callee) && callee.text === "useMemo" && target.arguments.length > 0) {
      return resolveFunctionReturnExpressions(target.arguments[0] as ts.Expression, seen)
    }
    if (ts.isIdentifier(callee) && callee.text === "mergeSelectOptionsForFields" && target.arguments.length > 0) {
      return resolveFunctionReturnExpressions(target.arguments[0] as ts.Expression, seen)
    }
    const fn = getFunctionLikeFromExpression(callee)
    if (!fn) {
      return { values: [], unresolved: [`Could not resolve form factory at ${pathAndLine(target)}`] }
    }
    if (seen.has(fn)) return { values: [], unresolved: [] }
    seen.add(fn)
    return mergeResolution(getReturnedExpressions(fn).map((ret) => resolveFunctionReturnExpressions(ret, seen)))
  }
  if (ts.isIdentifier(target)) {
    const decl = getDeclarationFromExpression(target)
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
      if (seen.has(decl)) return { values: [], unresolved: [] }
      seen.add(decl)
      return resolveFunctionReturnExpressions(decl.initializer, seen)
    }
    const fn = getFunctionLikeFromExpression(target)
    if (fn) {
      if (seen.has(fn)) return { values: [], unresolved: [] }
      seen.add(fn)
      return mergeResolution(getReturnedExpressions(fn).map((ret) => resolveFunctionReturnExpressions(ret, seen)))
    }
  }
  return { values: [target], unresolved: [] }
}

function getObjectProperty(expr: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of expr.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const propName = getPropertyNameText(prop.name)
      if (propName === name) {
        return ts.isPropertyAssignment(prop) ? prop.initializer : prop.name
      }
    }
    if (ts.isMethodDeclaration(prop) && getPropertyNameText(prop.name) === name) {
      return prop
    }
  }
  return undefined
}

function extractFieldsFromSectionsArray(expr: ts.Expression, seen = new Set<ts.Node>()): Resolution<string> {
  const target = unwrapExpression(expr)
  if (ts.isArrayLiteralExpression(target)) {
    const values: string[] = []
    const unresolved: string[] = []
    for (const el of target.elements) {
      const current = unwrapExpression(el as ts.Expression)
      if (ts.isObjectLiteralExpression(current)) {
        const fieldsExpr = getObjectProperty(current, "fields")
        if (!fieldsExpr) continue
        const fieldsRes = extractFieldNames(fieldsExpr, seen)
        values.push(...fieldsRes.values)
        unresolved.push(...fieldsRes.unresolved)
      } else if (ts.isSpreadElement(current)) {
        const res = extractFieldsFromSectionsArray(current.expression, seen)
        values.push(...res.values)
        unresolved.push(...res.unresolved)
      }
    }
    return { values, unresolved }
  }
  if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === "map") {
    const callback = target.arguments[0]
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      const returns = getReturnedExpressions(callback)
      return mergeResolution(returns.map((ret) => extractFieldsFromSectionsArray(ret, seen)))
    }
  }
  if (ts.isIdentifier(target) || ts.isCallExpression(target)) {
    const resolved = resolveFunctionReturnExpressions(target, seen)
    return mergeResolution(resolved.values.map((value) => extractFieldsFromSectionsArray(value, seen)).concat({
      values: [],
      unresolved: resolved.unresolved,
    }))
  }
  return { values: [], unresolved: [`Could not statically read sections array at ${pathAndLine(target)}`] }
}

function extractFieldNames(expr: ts.Expression, seen = new Set<ts.Node>()): Resolution<string> {
  const target = unwrapExpression(expr)
  if (ts.isConditionalExpression(target)) {
    return mergeResolution([
      extractFieldNames(target.whenTrue, seen),
      extractFieldNames(target.whenFalse, seen),
    ])
  }
  if (ts.isArrayLiteralExpression(target)) {
    const values: string[] = []
    const unresolved: string[] = []
    for (const el of target.elements) {
      const current = unwrapExpression(el as ts.Expression)
      if (ts.isObjectLiteralExpression(current)) {
        const nameExpr = getObjectProperty(current, "name")
        if (nameExpr && ts.isStringLiteralLike(unwrapExpression(nameExpr))) {
          values.push((unwrapExpression(nameExpr) as ts.StringLiteralLike).text)
        } else {
          unresolved.push(`Could not resolve field.name at ${pathAndLine(current)}`)
        }
      } else if (ts.isSpreadElement(current)) {
        const res = extractFieldNames(current.expression, seen)
        values.push(...res.values)
        unresolved.push(...res.unresolved)
      }
    }
    return { values, unresolved }
  }
  if (ts.isIdentifier(target) || ts.isCallExpression(target)) {
    const resolved = resolveFunctionReturnExpressions(target, seen)
    return mergeResolution(resolved.values.map((value) => extractFieldNames(value, seen)).concat({
      values: [],
      unresolved: resolved.unresolved,
    }))
  }
  return { values: [], unresolved: [`Could not statically read fields array at ${pathAndLine(target)}`] }
}

function findStateMappings(sourceFile: ts.SourceFile): Map<string, StateFormMapping[]> {
  const map = new Map<string, StateFormMapping[]>()
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length > 0) {
      const setter = node.expression.text
      if (/^set[A-Z]/.test(setter)) {
        const stateVar = setter[3].toLowerCase() + setter.slice(4)
        const arg = unwrapExpression(node.arguments[0] as ts.Expression)
        if (ts.isObjectLiteralExpression(arg)) {
          const actionExpr = getObjectProperty(arg, "action")
          const formExpr = getObjectProperty(arg, "form")
          if (actionExpr && formExpr && ts.isStringLiteralLike(unwrapExpression(actionExpr))) {
            const mapping: StateFormMapping = {
              stateVar,
              action: (unwrapExpression(actionExpr) as ts.StringLiteralLike).text,
              formExpr,
              source: pathAndLine(node),
            }
            if (!map.has(stateVar)) map.set(stateVar, [])
            map.get(stateVar)!.push(mapping)
          }
        }
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return map
}

function findModuleViewMappings(expr: ts.Expression, seen = new Set<ts.Node>()): Resolution<ActionFormMapping> {
  const target = unwrapExpression(expr)
  if (ts.isObjectLiteralExpression(target)) {
    const mappings: ActionFormMapping[] = []
    const unresolved: string[] = []
    const createFormExpr = getObjectProperty(target, "createForm")
    if (createFormExpr) {
      const createActionExpr = getObjectProperty(target, "createAction") ?? getObjectProperty(target, "id")
      if (createActionExpr && ts.isStringLiteralLike(unwrapExpression(createActionExpr))) {
        mappings.push({
          action: (unwrapExpression(createActionExpr) as ts.StringLiteralLike).text,
          formExpr: createFormExpr,
          source: pathAndLine(target),
        })
      } else {
        unresolved.push(`Found createForm without string createAction/id at ${pathAndLine(target)}`)
      }
    }
    for (const prop of target.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const nested = findModuleViewMappings(prop.initializer, seen)
        mappings.push(...nested.values)
        unresolved.push(...nested.unresolved)
      } else if (ts.isSpreadAssignment(prop)) {
        const nested = findModuleViewMappings(prop.expression, seen)
        mappings.push(...nested.values)
        unresolved.push(...nested.unresolved)
      }
    }
    return { values: mappings, unresolved }
  }
  if (ts.isArrayLiteralExpression(target)) {
    return mergeResolution(target.elements.map((el) => findModuleViewMappings(el as ts.Expression, seen)))
  }
  if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === "map") {
    const callback = target.arguments[0]
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      return mergeResolution(getReturnedExpressions(callback).map((ret) => findModuleViewMappings(ret, seen)))
    }
  }
  if (ts.isConditionalExpression(target)) {
    return mergeResolution([
      findModuleViewMappings(target.whenTrue, seen),
      findModuleViewMappings(target.whenFalse, seen),
    ])
  }
  if (
    ts.isBinaryExpression(target) &&
    (target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      target.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return mergeResolution([
      findModuleViewMappings(target.left, seen),
      findModuleViewMappings(target.right, seen),
    ])
  }
  if (ts.isIdentifier(target) || ts.isCallExpression(target)) {
    const resolved = resolveFunctionReturnExpressions(target, seen)
    return mergeResolution(resolved.values.map((value) => findModuleViewMappings(value, seen)).concat({
      values: [],
      unresolved: resolved.unresolved,
    }))
  }
  return { values: [], unresolved: [] }
}

function resolveFormFields(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  stateMappings: Map<string, StateFormMapping[]>,
  seen = new Set<ts.Node>(),
): Resolution<string> {
  const target = unwrapExpression(expr)
  if (ts.isObjectLiteralExpression(target)) {
    const sectionsExpr = getObjectProperty(target, "sections")
    const fromSections = sectionsExpr ? extractFieldsFromSectionsArray(sectionsExpr, seen) : { values: [], unresolved: [] }
    const fromSpreads = mergeResolution(
      target.properties
        .filter(ts.isSpreadAssignment)
        .map((prop) => resolveFormFields(prop.expression, sourceFile, stateMappings, seen)),
    )
    return {
      values: [...fromSections.values, ...fromSpreads.values],
      unresolved: [...fromSections.unresolved, ...fromSpreads.unresolved],
    }
  }
  if (ts.isConditionalExpression(target)) {
    return mergeResolution([
      resolveFormFields(target.whenTrue, sourceFile, stateMappings, seen),
      resolveFormFields(target.whenFalse, sourceFile, stateMappings, seen),
    ])
  }
  if (
    ts.isBinaryExpression(target) &&
    (target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      target.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return mergeResolution([
      resolveFormFields(target.left, sourceFile, stateMappings, seen),
      resolveFormFields(target.right, sourceFile, stateMappings, seen),
    ])
  }
  if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) {
    const left = unwrapExpression(target.expression)
    if ((ts.isIdentifier(left) || ts.isPropertyAccessExpression(left)) && target.name.text === "form") {
      const stateVar = ts.isIdentifier(left) ? left.text : undefined
      if (stateVar && stateMappings.has(stateVar)) {
        return mergeResolution(
          stateMappings.get(stateVar)!.map((mapping) => resolveFormFields(mapping.formExpr, sourceFile, stateMappings, seen)),
        )
      }
    }
  }
  if (ts.isCallExpression(target)) {
    const callee = unwrapExpression(target.expression)
    if (ts.isIdentifier(callee) && callee.text === "mergeSelectOptionsForFields" && target.arguments.length > 0) {
      return resolveFormFields(target.arguments[0] as ts.Expression, sourceFile, stateMappings, seen)
    }
  }
  if (ts.isIdentifier(target) || ts.isCallExpression(target)) {
    const resolved = resolveFunctionReturnExpressions(target, seen)
    return mergeResolution(resolved.values.map((value) => resolveFormFields(value, sourceFile, stateMappings, seen)).concat({
      values: [],
      unresolved: resolved.unresolved,
    }))
  }
  return { values: [], unresolved: [`Could not resolve form config at ${pathAndLine(target)}`] }
}

function depsUnion(...sets: Iterable<string>[]): Set<string> {
  const out = new Set<string>()
  for (const set of sets) for (const item of set) out.add(item)
  return out
}

function evaluateActionCondition(
  expr: ts.Expression,
  actionParam: string | undefined,
  selectedAction: string | undefined,
): boolean | undefined {
  if (!actionParam || !selectedAction) return undefined
  const target = unwrapExpression(expr)
  if (
    ts.isBinaryExpression(target) &&
    (target.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      target.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
  ) {
    const left = unwrapExpression(target.left)
    const right = unwrapExpression(target.right)
    const isEq = target.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    const compare = (a: ts.Expression, b: ts.Expression) =>
      ts.isIdentifier(a) && a.text === actionParam && ts.isStringLiteralLike(b)
    if (compare(left, right)) return isEq ? right.text === selectedAction : right.text !== selectedAction
    if (compare(right, left)) return isEq ? left.text === selectedAction : left.text !== selectedAction
  }
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const l = evaluateActionCondition(target.left, actionParam, selectedAction)
    const r = evaluateActionCondition(target.right, actionParam, selectedAction)
    if (l === false || r === false) return false
    if (l === true && r === true) return true
    return undefined
  }
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const l = evaluateActionCondition(target.left, actionParam, selectedAction)
    const r = evaluateActionCondition(target.right, actionParam, selectedAction)
    if (l === true || r === true) return true
    if (l === false && r === false) return false
    return undefined
  }
  return undefined
}

interface AnalysisEnv {
  formParamName: string
  locals: Map<string, Set<string>>
  formObjectAliases: Set<string>
}

function getStaticPropertyName(expr: ts.Expression): string | undefined {
  const target = unwrapExpression(expr)
  if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) return target.name.text
  if (ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)) {
    return target.argumentExpression.text
  }
  return undefined
}

/** Submit handlers that delegate all mutations into a shared helper (2nd arg = form values). */
const SUBMIT_DELEGATES = new Set(["submitManufacturingRowAction"])

function getFunctionLikeFromDeclaration(decl: ts.Declaration | undefined): ts.FunctionLikeDeclaration | undefined {
  if (!decl) return undefined
  if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) return decl
  if (ts.isVariableDeclaration(decl) && decl.initializer)
    return getFunctionLikeFromExpression(unwrapExpression(decl.initializer))
  return undefined
}

function resolveDelegatedSubmitHelper(callee: ts.Expression): ts.FunctionLikeDeclaration | undefined {
  const head = unwrapExpression(callee)
  if (!ts.isIdentifier(head)) return undefined
  const decl = getDeclarationFromExpression(head)
  return getFunctionLikeFromDeclaration(decl)
}

function collectFormDeps(expr: ts.Expression | undefined, env: AnalysisEnv): Set<string> {
  if (!expr) return new Set()
  const target = unwrapExpression(expr)
  if (ts.isIdentifier(target)) {
    if (env.formObjectAliases.has(target.text)) return new Set()
    return env.locals.get(target.text) ?? new Set()
  }
  if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target) || ts.isElementAccessExpression(target)) {
    const base = unwrapExpression(target.expression)
    const prop = getStaticPropertyName(target)
    if (ts.isIdentifier(base) && env.formObjectAliases.has(base.text) && prop) {
      return new Set([prop])
    }
    return collectFormDeps(base, env)
  }
  if (ts.isNewExpression(target)) {
    return depsUnion(...(target.arguments ?? []).map((arg) => collectFormDeps(arg as ts.Expression, env)))
  }
  if (ts.isCallExpression(target)) {
    const calleeHead = unwrapExpression(target.expression)
    if (
      ts.isIdentifier(calleeHead) &&
      calleeHead.text === "idFrom" &&
      target.arguments.length >= 2
    ) {
      const first = unwrapExpression(target.arguments[0] as ts.Expression)
      const second = target.arguments[1] as ts.Expression
      if (ts.isIdentifier(first) && env.formObjectAliases.has(first.text) && ts.isArrayLiteralExpression(second)) {
        const keys: string[] = []
        for (const el of second.elements) {
          if (ts.isSpreadElement(el)) continue
          const lit = unwrapExpression(el as ts.Expression)
          if (ts.isStringLiteralLike(lit)) keys.push(lit.text)
        }
        return new Set(keys)
      }
    }
    if (target.arguments.length === 0) {
      const callee = unwrapExpression(target.expression)
      if (ts.isPropertyAccessExpression(callee) || ts.isPropertyAccessChain(callee)) {
        const method = callee.name.text
        if (method === "trim" || method === "trimStart" || method === "trimEnd") {
          return collectFormDeps(callee.expression, env)
        }
        if (method === "toUpperCase" || method === "toLowerCase") {
          return collectFormDeps(callee.expression, env)
        }
        if (method === "text") {
          return collectFormDeps(callee.expression, env)
        }
      }
    }
    return depsUnion(...target.arguments.map((arg) => collectFormDeps(arg, env)))
  }
  if (ts.isAwaitExpression(target)) {
    return collectFormDeps(target.expression, env)
  }
  if (ts.isBinaryExpression(target)) {
    return depsUnion(collectFormDeps(target.left, env), collectFormDeps(target.right, env))
  }
  if (ts.isConditionalExpression(target)) {
    return depsUnion(
      collectFormDeps(target.condition, env),
      collectFormDeps(target.whenTrue, env),
      collectFormDeps(target.whenFalse, env),
    )
  }
  if (ts.isArrayLiteralExpression(target)) {
    return depsUnion(...target.elements.map((el) => collectFormDeps(el as ts.Expression, env)))
  }
  if (ts.isObjectLiteralExpression(target)) {
    const sets: Set<string>[] = []
    for (const prop of target.properties) {
      if (ts.isPropertyAssignment(prop)) sets.push(collectFormDeps(prop.initializer, env))
      else if (ts.isShorthandPropertyAssignment(prop)) sets.push(env.locals.get(prop.name.text) ?? new Set())
      else if (ts.isSpreadAssignment(prop)) sets.push(collectFormDeps(prop.expression, env))
    }
    return depsUnion(...sets)
  }
  return new Set()
}

function getContainingFunctionLike(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let cur: ts.Node | undefined = node
  while (cur) {
    if (ts.isFunctionLike(cur)) return cur
    cur = cur.parent
  }
  return undefined
}

/** Nearest `const name = …` before `refNode` in the same outer function (skips nested functions). */
function getLocalInitializerBefore(name: string, refNode: ts.Node): ts.Expression | undefined {
  const fn = getContainingFunctionLike(refNode)
  if (!fn?.body || !ts.isBlock(fn.body)) return undefined
  const refPos = refNode.getStart()
  let bestPos = -1
  let best: ts.Expression | undefined

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== fn) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const p = node.getStart()
      if (p < refPos && p > bestPos) {
        bestPos = p
        best = node.initializer
      }
    }
    node.forEachChild(visit)
  }
  visit(fn.body)
  return best
}

function resolveHelperFunctionFromCall(expr: ts.CallExpression): ts.FunctionLikeDeclaration | undefined {
  return getFunctionLikeFromExpression(expr.expression)
}

function analyzePayloadFromHelperCall(
  call: ts.CallExpression,
  outerEnv: AnalysisEnv,
  basePath = "",
  seen = new Set<ts.Node>(),
): Resolution<FieldMapping> {
  const fn = resolveHelperFunctionFromCall(call)
  if (!fn || seen.has(fn)) {
    return { values: [], unresolved: [`Could not inspect helper return at ${pathAndLine(call)}`] }
  }
  seen.add(fn)
  const localEnv: AnalysisEnv = {
    formParamName: outerEnv.formParamName,
    locals: new Map(outerEnv.locals),
    formObjectAliases: new Set(outerEnv.formObjectAliases),
  }
  const paramNames = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : undefined))
  call.arguments.forEach((arg, i) => {
    const p = paramNames[i]
    if (!p) return
    const unwrappedArg = unwrapExpression(arg)
    if (ts.isIdentifier(unwrappedArg) && outerEnv.formObjectAliases.has(unwrappedArg.text)) {
      localEnv.formObjectAliases.add(p)
    }
    localEnv.locals.set(p, collectFormDeps(arg, outerEnv))
  })
  if (!fn.body || !ts.isBlock(fn.body)) {
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
      return analyzePayloadExpression(fn.body, localEnv, basePath, seen, fn.body)
    }
    return { values: [], unresolved: [`Helper has no analyzable body at ${pathAndLine(fn)}`] }
  }
  const unresolved: string[] = []
  const out: FieldMapping[] = []
  for (const stmt of fn.body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          localEnv.locals.set(decl.name.text, collectFormDeps(decl.initializer, localEnv))
        }
      }
    }
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      const ret = unwrapExpression(stmt.expression)
      if (ret.kind === ts.SyntaxKind.NullKeyword || ret.kind === ts.SyntaxKind.UndefinedKeyword) {
        continue
      }
      if (ts.isBigIntLiteral(ret) || ts.isNumericLiteral(ret)) {
        continue
      }
      const nested = analyzePayloadExpression(stmt.expression, localEnv, basePath, seen, stmt.expression)
      out.push(...nested.values)
      unresolved.push(...nested.unresolved)
    }
  }
  return { values: out, unresolved }
}

/** Reducer args / IDs that never carry form fields — avoid noise when analyzing tuple payloads. */
const PAYLOAD_SCOPE_IDS = new Set([
  "organizationId",
  "companyId",
  "orgId",
  "ctx",
  "undefined",
  "null",
])

function analyzePayloadExpression(
  expr: ts.Expression,
  env: AnalysisEnv,
  basePath = "",
  seen = new Set<ts.Node>(),
  scopeAnchor?: ts.Node,
): Resolution<FieldMapping> {
  const anchor = scopeAnchor ?? expr
  let target = unwrapExpression(expr)
  if (ts.isAwaitExpression(target)) {
    return analyzePayloadExpression(target.expression, env, basePath, seen, anchor)
  }
  if (ts.isArrayLiteralExpression(target)) {
    const parts = target.elements
      .filter((el): el is ts.Expression => !ts.isSpreadElement(el))
      .map((el) => analyzePayloadExpression(el, env, basePath, seen, anchor))
    return {
      values: parts.flatMap((p) => p.values),
      unresolved: uniqueStrings(parts.flatMap((p) => p.unresolved)),
    }
  }
  if (ts.isIdentifier(target)) {
    const scopedInit = getLocalInitializerBefore(target.text, anchor)
    if (scopedInit) return analyzePayloadExpression(unwrapExpression(scopedInit), env, basePath, seen, anchor)
    const deps = env.locals.get(target.text)
    if (deps) {
      return {
        values: [{
          targetPath: basePath || target.text,
          sourceFields: [...deps].sort(),
        }],
        unresolved: [],
      }
    }
    if (PAYLOAD_SCOPE_IDS.has(target.text)) {
      return { values: [], unresolved: [] }
    }
    return { values: [], unresolved: [`Could not resolve payload identifier "${target.text}" at ${pathAndLine(target)}`] }
  }
  if (ts.isObjectLiteralExpression(target)) {
    const values: FieldMapping[] = []
    const unresolved: string[] = []
    for (const prop of target.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const propName = getPropertyNameText(prop.name)
        if (!propName) {
          unresolved.push(`Computed payload key at ${pathAndLine(prop)}`)
          continue
        }
        const fullPath = basePath ? `${basePath}.${propName}` : propName
        const nested = unwrapExpression(prop.initializer)
        if (ts.isObjectLiteralExpression(nested)) {
          const inner = analyzePayloadExpression(nested, env, fullPath, seen, anchor)
          values.push(...inner.values)
          unresolved.push(...inner.unresolved)
        } else {
          const shallow = new Set(collectFormDeps(nested, env))
          if (ts.isCallExpression(nested)) {
            const calleeHead = unwrapExpression(nested.expression)
            if (
              nested.arguments.length === 0 &&
              (ts.isPropertyAccessExpression(calleeHead) || ts.isPropertyAccessChain(calleeHead))
            ) {
              values.push({
                targetPath: fullPath,
                sourceFields: [...shallow].sort(),
              })
              continue
            }
            const calleeId = unwrapExpression(nested.expression)
            const builtinCallee =
              ts.isIdentifier(calleeId) &&
              [
                "Boolean",
                "String",
                "Number",
                "BigInt",
                "stbTimestampFromDate",
                "timestampFromFormDate",
                "optionalTimestampFromFormDate",
                "optionalTrimmedString",
                "capitalizeTag",
                "toInternalType",
                "toInternalGroup",
                "requiredBigIntU64",
                "optionalBigIntU64",
                "userTypeIdFromInternalGroup",
                "JSON.stringify",
              ].includes(calleeId.text)
            if (!builtinCallee) {
              const helper = analyzePayloadFromHelperCall(nested, env, fullPath, seen)
              for (const m of helper.values) for (const sf of m.sourceFields) shallow.add(sf)
              unresolved.push(...helper.unresolved)
            }
          }
          values.push({
            targetPath: fullPath,
            sourceFields: [...shallow].sort(),
          })
        }
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const name = prop.name.text
        const fullPath = basePath ? `${basePath}.${name}` : name
        let deps = env.locals.get(name) ?? new Set<string>()
        if (deps.size === 0) {
          const init = getLocalInitializerBefore(name, prop.name)
          if (init) {
            const uw = unwrapExpression(init)
            if (ts.isCallExpression(uw)) {
              const calleeId = unwrapExpression(uw.expression)
              const builtinCallee =
                ts.isIdentifier(calleeId) &&
                [
                  "Boolean",
                  "String",
                  "Number",
                  "BigInt",
                  "stbTimestampFromDate",
                  "timestampFromFormDate",
                  "optionalTimestampFromFormDate",
                  "optionalTrimmedString",
                  "capitalizeTag",
                  "toInternalType",
                  "toInternalGroup",
                  "requiredBigIntU64",
                  "optionalBigIntU64",
                  "userTypeIdFromInternalGroup",
                  "JSON.stringify",
                ].includes(calleeId.text)
              if (!builtinCallee) {
                const shallow = new Set(collectFormDeps(uw, env))
                const helper = analyzePayloadFromHelperCall(uw, env, fullPath, seen)
                for (const m of helper.values) for (const sf of m.sourceFields) shallow.add(sf)
                values.push({
                  targetPath: fullPath,
                  sourceFields: [...shallow].sort(),
                })
                unresolved.push(...helper.unresolved)
                continue
              }
            }
            deps = collectFormDeps(init, env)
          }
        }
        values.push({
          targetPath: fullPath,
          sourceFields: [...deps].sort(),
        })
      } else if (ts.isSpreadAssignment(prop)) {
        const inner = analyzePayloadExpression(prop.expression, env, basePath, seen, anchor)
        values.push(...inner.values)
        unresolved.push(...inner.unresolved)
      }
    }
    return { values, unresolved }
  }
  if (ts.isCallExpression(target)) {
    const callee = unwrapExpression(target.expression)
    if (ts.isIdentifier(callee) && callee.text === "idFrom") {
      const shallow = collectFormDeps(target, env)
      if (shallow.size > 0) {
        return {
          values: [{ targetPath: basePath || "__form_id_alias__", sourceFields: [...shallow].sort() }],
          unresolved: [],
        }
      }
    }
    if (ts.isIdentifier(callee) && callee.text === "num" && target.arguments.length >= 1) {
      const shallow = collectFormDeps(target, env)
      if (shallow.size > 0) {
        return {
          values: [{ targetPath: basePath || "__form_num_alias__", sourceFields: [...shallow].sort() }],
          unresolved: [],
        }
      }
    }
    if (
      ts.isIdentifier(callee) &&
      [
        "stdbParamsToJson",
        "crmParamsToJson",
        "projectsParamsToJson",
        "withCompanyScope",
        "paymentParamsToJson",
        "accountingParamsToJson",
        "analyticParamsToJson",
        "reconciliationWidgetParamsToJson",
        "createCurrencyRateParamsToJson",
        "createAccountTaxParamsToStdbHttpJson",
        "bankStatementLineParamsToJson",
        "bankReconcileParamsToJson",
        "updateAccountMoveLineParamsToJson",
      ].includes(callee.text) &&
      target.arguments.length > 0
    ) {
      const idx = callee.text === "withCompanyScope" ? 0 : 0
      return analyzePayloadExpression(target.arguments[idx] as ts.Expression, env, basePath, seen, anchor)
    }
    const shallow = new Set(collectFormDeps(target, env))
    const helper = analyzePayloadFromHelperCall(target, env, basePath, seen)
    if (helper.values.length > 0) {
      return { values: helper.values, unresolved: helper.unresolved }
    }
    if (shallow.size > 0) {
      return {
        values: [{ targetPath: basePath || "payload", sourceFields: [...shallow].sort() }],
        unresolved: helper.unresolved,
      }
    }
    return {
      values: [],
      unresolved: uniqueStrings([
        ...helper.unresolved,
        `Could not analyze payload expression at ${pathAndLine(target)}`,
      ]),
    }
  }
  return { values: [], unresolved: [`Could not analyze payload expression at ${pathAndLine(target)}`] }
}

function resolveMutationReducerName(baseExpr: ts.Expression): { reducerName?: string; mutationVar?: string } {
  const target = unwrapExpression(baseExpr)
  if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) {
    const prop = target.name.text
    const hookGuess = `use${prop.charAt(0).toUpperCase()}${prop.slice(1)}`
    const fromProp = hookReducerMap.get(hookGuess)
    if (fromProp) return { reducerName: fromProp, mutationVar: prop }
    return resolveMutationReducerName(target.expression as ts.Expression)
  }
  if (ts.isIdentifier(target)) {
    const decl = getDeclarationFromExpression(target)
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.isCallExpression(unwrapExpression(decl.initializer))) {
      const init = unwrapExpression(decl.initializer) as ts.CallExpression
      const callee = unwrapExpression(init.expression)
      if (ts.isIdentifier(callee)) {
        const reducerName = hookReducerMap.get(callee.text)
        return { reducerName, mutationVar: target.text }
      }
    }
    return { mutationVar: target.text }
  }
  return {}
}

/** Any `formAlias.someProp` read (control flow, helpers) counts as consuming `someProp`. */
function collectFormPropertyReadsFromFunction(
  fn: ts.FunctionLikeDeclaration,
  aliases: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) {
      const base = unwrapExpression(node.expression)
      if (ts.isIdentifier(base) && aliases.has(base.text)) {
        const prop = node.name.text
        if (prop) out.add(prop)
      }
    }
    node.forEachChild(visit)
  }
  if (fn.body) visit(fn.body)
  return out
}

function analyzeFunctionForAction(
  fn: ts.FunctionLikeDeclaration,
  selectedAction?: string,
  formParamOverride?: string,
): HandlerAnalysis {
  const unresolved: string[] = []
  const mutations: AnalyzedMutation[] = []
  let formParamName = formParamOverride
  const actionParamName =
    selectedAction && fn.parameters.length >= 2 && ts.isIdentifier(fn.parameters[1].name)
      ? fn.parameters[1].name.text
      : undefined
  if (!formParamName) {
    formParamName = getSubmitFormParamName(fn)
  }
  if (!formParamName) {
    return { usedFormFields: new Set(), mutations, unresolved: [`Could not find form param for ${pathAndLine(fn)}`] }
  }
  const env: AnalysisEnv = {
    formParamName,
    locals: new Map(),
    formObjectAliases: new Set([formParamName]),
  }

  /** Merged from nested `submitManufacturingRowAction`-style helpers (includes dispatch-only field reads). */
  let delegatedFormUsage: Set<string> | undefined

  const processStatement = (stmt: ts.Statement) => {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          env.locals.set(decl.name.text, collectFormDeps(decl.initializer, env))
        }
      }
      return
    }
    if (ts.isIfStatement(stmt)) {
      const decision = evaluateActionCondition(stmt.expression, actionParamName, selectedAction)
      if (decision === true) {
        visitNodeBody(stmt.thenStatement)
      } else if (decision === false) {
        if (stmt.elseStatement) visitNodeBody(stmt.elseStatement)
      } else {
        visitNodeBody(stmt.thenStatement)
        if (stmt.elseStatement) visitNodeBody(stmt.elseStatement)
      }
      return
    }
    visitNodeBody(stmt)
  }

  const visitStatements = (statements: readonly ts.Statement[]) => {
    for (const stmt of statements) processStatement(stmt)
  }

  const visitNodeBody = (node: ts.Statement | ts.Node) => {
    if (ts.isBlock(node)) {
      visitStatements(node.statements)
      return
    }
    if (ts.isIfStatement(node)) {
      processStatement(node)
      return
    }
    const visit = (inner: ts.Node) => {
      if (ts.isCallExpression(inner)) {
        const calleeHead = unwrapExpression(inner.expression)
        if (ts.isIdentifier(calleeHead) && SUBMIT_DELEGATES.has(calleeHead.text)) {
          const formArg = inner.arguments[1] ? unwrapExpression(inner.arguments[1] as ts.Expression) : undefined
          if (formArg && ts.isIdentifier(formArg) && env.formObjectAliases.has(formArg.text)) {
            const helperFn = resolveDelegatedSubmitHelper(calleeHead)
            if (helperFn) {
              const nested = analyzeFunctionForAction(helperFn, undefined, undefined)
              mutations.push(...nested.mutations)
              unresolved.push(...nested.unresolved)
              delegatedFormUsage = nested.usedFormFields
            }
          }
        }
        const propExpr = unwrapExpression(inner.expression)
        const methodName =
          ts.isPropertyAccessExpression(propExpr) || ts.isPropertyAccessChain(propExpr)
            ? propExpr.name.text
            : undefined
        if (methodName === "mutateAsync" || methodName === "mutate") {
          const payload = inner.arguments[0]
          const receiver =
            ts.isPropertyAccessExpression(propExpr) || ts.isPropertyAccessChain(propExpr)
              ? unwrapExpression(propExpr.expression)
              : inner.expression
          const { reducerName, mutationVar } = resolveMutationReducerName(receiver)
          const mappings = payload
            ? analyzePayloadExpression(payload, env, "", new Set(), payload)
            : { values: [], unresolved: [] }
          mutations.push({
            reducerName,
            mutationVar,
            mappedFields: mappings.values,
          })
          unresolved.push(...mappings.unresolved)
        }
      }
      inner.forEachChild(visit)
    }
    visit(node)
  }

  if (fn.body && ts.isBlock(fn.body)) visitStatements(fn.body.statements)
  else if (fn.body && !ts.isBlock(fn.body)) visitNodeBody(fn.body)

  const usedFormFields = new Set<string>()
  for (const mutation of mutations) {
    for (const mapping of mutation.mappedFields) {
      for (const sourceField of mapping.sourceFields) usedFormFields.add(sourceField)
    }
  }
  // Without action narrowing, include dispatch-only reads (e.g. *Action). When `selectedAction`
  // is set, scanning the whole function would merge sibling branches' formData.* (false positives).
  if (selectedAction === undefined) {
    for (const prop of collectFormPropertyReadsFromFunction(fn, env.formObjectAliases)) {
      usedFormFields.add(prop)
    }
  }
  if (delegatedFormUsage) {
    for (const prop of delegatedFormUsage) usedFormFields.add(prop)
  }
  return { usedFormFields, mutations, unresolved: uniqueStrings(unresolved) }
}

type SubmitResolution =
  | { mode: "direct"; fn: ts.FunctionLikeDeclaration; formParamName?: string }
  | { mode: "router"; targetFn: ts.FunctionLikeDeclaration; stateVar?: string; action?: string; formParamName?: string }

/** First parameter that is not tab routing / action dispatch (supports `_tabId` etc.). */
function getSubmitFormParamName(fn: ts.FunctionLikeDeclaration): string | undefined {
  const excluded = new Set(["tabId", "action"])
  for (const p of fn.parameters) {
    if (!ts.isIdentifier(p.name)) continue
    const base = p.name.text.replace(/^_+/, "")
    if (!excluded.has(base)) return p.name.text
  }
  return undefined
}

function resolveSubmitExpression(expr: ts.Expression): SubmitResolution | undefined {
  const fn = getFunctionLikeFromExpression(expr)
  if (!fn) return undefined
  const formParamName = getSubmitFormParamName(fn)

  let dispatch: SubmitResolution | undefined
  const visit = (node: ts.Node) => {
    if (dispatch) return
    if (ts.isCallExpression(node)) {
      const calleeFn = getFunctionLikeFromExpression(node.expression)
      const args = node.arguments.map((arg) => unwrapExpression(arg as ts.Expression))
      const hasFormArg = formParamName && args.some((arg) => ts.isIdentifier(arg) && arg.text === formParamName)
      if (calleeFn && hasFormArg) {
        const stateArg = args.find(
          (arg) =>
            (ts.isPropertyAccessExpression(arg) || ts.isPropertyAccessChain(arg)) &&
            arg.name.text === "action" &&
            ts.isIdentifier(unwrapExpression(arg.expression)),
        ) as (ts.PropertyAccessExpression | ts.PropertyAccessChain) | undefined
        const actionPositionArg =
          args.length >= 2 && ts.isStringLiteralLike(args[1])
            ? args[1]
            : args.find((arg) => ts.isStringLiteralLike(arg))
        const stringArg = actionPositionArg as ts.StringLiteralLike | undefined
        if (stateArg || stringArg) {
          dispatch = {
            mode: "router",
            targetFn: calleeFn,
            stateVar: stateArg && ts.isIdentifier(unwrapExpression(stateArg.expression))
              ? (unwrapExpression(stateArg.expression) as ts.Identifier).text
              : undefined,
            action: stateArg ? undefined : stringArg?.text,
            formParamName,
          }
          return
        }
      }
    }
    node.forEachChild(visit)
  }
  if (fn.body) fn.body.forEachChild(visit)
  return dispatch ?? { mode: "direct", fn, formParamName }
}

function compareToReducerParams(
  reducerName: string | undefined,
  mappedFields: FieldMapping[],
): Issue[] {
  if (!reducerName) return []
  const binding = reducerBindings.get(reducerName)
  if (!binding) return []
  const paramsTypeName =
    binding.paramsTypeName ??
    binding.args.find((arg) => arg.name === "params" && arg.type === "ref")?.refType
  const paramsType = paramsTypeName ? paramTypes.get(paramsTypeName) : undefined

  const flatReducerArgNames = binding.args
    .filter((a) => !(a.name === "params" && a.type === "ref"))
    .map((a) => a.name)
  const skipOnClient = new Set(["organizationId", "companyId"])
  const allowedFlatReducerKeys = new Set(flatReducerArgNames.filter((n) => !skipOnClient.has(n)))
  const paramsFieldNames = new Set(paramsType?.fields.map((f) => f.name) ?? [])

  const issues: Issue[] = []
  for (const mapping of mappedFields) {
    const path = mapping.targetPath
    if (path.startsWith("params.")) {
      const key = path.slice("params.".length)
      if (paramsTypeName && !paramsFieldNames.has(key)) {
        issues.push({
          severity: "WARN",
          message: `Mutation payload field "${path}" is not in reducer params ${paramsTypeName}`,
        })
      }
      continue
    }
    if (path.includes(".")) continue
    if (path === "params") continue
    // idFrom(values, ["recordIdField"]) → scalar mutateAsync(id); not a named reducer field
    if (path === "__form_id_alias__") continue
    if (path === "__form_num_alias__") continue
    // Sole mutateAsync(string) for CSV imports — analyzePayloadExpression uses targetPath "payload"
    if (path === "payload" && reducerName && /^import_.*_csv$/.test(reducerName)) continue
    if (allowedFlatReducerKeys.has(path)) continue
    if (paramsFieldNames.has(path)) continue
    issues.push({
      severity: "WARN",
      message: `Mutation payload field "${path}" is not in reducer args or ${paramsTypeName ?? "params struct"}`,
    })
  }
  return issues
}

function makeReport(
  kind: FormUsageReport["kind"],
  sourceFile: ts.SourceFile,
  label: string,
  locationNode: ts.Node,
  formFieldsRes: Resolution<string>,
  analysis: HandlerAnalysis,
  action?: string,
): FormUsageReport {
  const formFields = uniqueStrings(formFieldsRes.values)
  const usedFormFields = uniqueStrings([...analysis.usedFormFields])
  const reducerNames = uniqueStrings(analysis.mutations.map((m) => m.reducerName).filter((v): v is string => !!v))
  const mutationMappings = analysis.mutations.flatMap((m) => m.mappedFields)
  const issues: Issue[] = []
  const formSet = new Set(formFields)
  const usedSet = new Set(usedFormFields)

  for (const field of formFields) {
    if (!usedSet.has(field)) {
      issues.push({ severity: "WARN", message: `Form field "${field}" is not consumed by the submit path` })
    }
  }
  // When form fields could not be resolved statically (e.g. mergeSelectOptions), skip noisy cross-checks.
  if (formFields.length > 0) {
    for (const field of usedFormFields) {
      if (!formSet.has(field)) {
        issues.push({
          severity: "WARN",
          message: `Submit path reads "${field}" but the form does not define it (optional mapper access or hidden field)`,
        })
      }
    }
  }
  for (const mut of analysis.mutations) {
    if (mut.reducerName) {
      issues.push(...compareToReducerParams(mut.reducerName, mut.mappedFields))
    }
  }
  if (!analysis.mutations.some((m) => m.reducerName)) {
    issues.push({ severity: "INFO", message: "Could not resolve reducer name from mutation hook" })
  }

  return {
    kind,
    sourceFile: rel(sourceFile.fileName),
    location: `${rel(sourceFile.fileName)}:${lineOf(locationNode)}`,
    label,
    action,
    reducerNames,
    formFields,
    usedFormFields,
    mutationMappings,
    issues,
    unresolved: uniqueStrings([...formFieldsRes.unresolved, ...analysis.unresolved]),
  }
}

function getJsxPropExpression(node: ts.JsxOpeningLikeElement, name: string): ts.Expression | undefined {
  const attr = node.attributes.properties.find(
    (prop): prop is ts.JsxAttribute =>
      ts.isJsxAttribute(prop) && prop.name.text === name,
  )
  if (!attr || !attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) {
    return undefined
  }
  return attr.initializer.expression
}

function getJsxTagName(node: ts.JsxOpeningLikeElement): string | undefined {
  const tag = node.tagName
  return ts.isIdentifier(tag) ? tag.text : undefined
}

function analyzeSourceFile(sourceFile: ts.SourceFile): FormUsageReport[] {
  const reports: FormUsageReport[] = []
  const stateMappings = findStateMappings(sourceFile)

  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = getJsxTagName(node)

      if (tagName === "ModuleView") {
        const configExpr = getJsxPropExpression(node, "config")
        const submitExpr = getJsxPropExpression(node, "onFormSubmit")
        if (configExpr && submitExpr) {
          const mappings = findModuleViewMappings(configExpr)
          const submit = resolveSubmitExpression(submitExpr)
          if (submit?.mode === "direct" || submit?.mode === "router") {
            const handler = submit.mode === "direct" ? submit.fn : submit.targetFn
            for (const mapping of mappings.values) {
              const formFieldsRes = resolveFormFields(mapping.formExpr, sourceFile, stateMappings)
              const analysis = analyzeFunctionForAction(handler, mapping.action, submit.formParamName)
              reports.push(
                makeReport(
                  "module-view",
                  sourceFile,
                  `ModuleView action ${mapping.action}`,
                  node,
                  formFieldsRes,
                  analysis,
                  mapping.action,
                ),
              )
            }
          }
        }
      }

      if (tagName === "FormModal" || tagName === "ModularForm") {
        const configExpr = getJsxPropExpression(node, "config")
        const submitExpr = getJsxPropExpression(node, "onSubmit")
        if (configExpr && submitExpr) {
          const submit = resolveSubmitExpression(submitExpr)
          if (submit?.mode === "direct") {
            const formFieldsRes = resolveFormFields(configExpr, sourceFile, stateMappings)
            const analysis = analyzeFunctionForAction(submit.fn, undefined, submit.formParamName)
            reports.push(makeReport("direct", sourceFile, `${tagName} direct submit`, node, formFieldsRes, analysis))
          } else if (submit?.mode === "router") {
            if (submit.action) {
              const formFieldsRes = resolveFormFields(configExpr, sourceFile, stateMappings)
              const analysis = analyzeFunctionForAction(submit.targetFn, submit.action, submit.formParamName)
              reports.push(
                makeReport("router", sourceFile, `${tagName} routed submit`, node, formFieldsRes, analysis, submit.action),
              )
            } else if (submit.stateVar && stateMappings.has(submit.stateVar)) {
              for (const mapping of stateMappings.get(submit.stateVar) ?? []) {
                const formFieldsRes = resolveFormFields(mapping.formExpr, sourceFile, stateMappings)
                const analysis = analyzeFunctionForAction(submit.targetFn, mapping.action, submit.formParamName)
                reports.push(
                  makeReport(
                    "router",
                    sourceFile,
                    `${tagName} routed via ${submit.stateVar}`,
                    node,
                    formFieldsRes,
                    analysis,
                    mapping.action,
                  ),
                )
              }
            } else {
              const formFieldsRes = resolveFormFields(configExpr, sourceFile, stateMappings)
              reports.push({
                kind: "router",
                sourceFile: rel(sourceFile.fileName),
                location: `${rel(sourceFile.fileName)}:${lineOf(node)}`,
                label: `${tagName} routed submit`,
                formFields: uniqueStrings(formFieldsRes.values),
                usedFormFields: [],
                reducerNames: [],
                mutationMappings: [],
                issues: [{ severity: "INFO", message: "Could not resolve routed action state" }],
                unresolved: uniqueStrings(formFieldsRes.unresolved),
              })
            }
          }
        }
      }
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return reports
}

interface ModuleRollupRow {
  module: string
  reportCount: number
  files: number
  kinds: { "module-view": number; router: number; direct: number }
  issues: { ERROR: number; WARN: number; INFO: number }
  unresolvedMentions: number
}

interface ModuleRollupSummary {
  totalReports: number
  moduleCount: number
  byModule: ModuleRollupRow[]
  otherReports: ModuleRollupRow | null
  issueTotals: { ERROR: number; WARN: number; INFO: number }
  unresolvedMentionsTotal: number
}

function buildModuleRollup(reports: FormUsageReport[]): ModuleRollupSummary {
  type Acc = {
    reportCount: number
    files: Set<string>
    kinds: Partial<Record<FormUsageReport["kind"], number>>
    issues: { ERROR: number; WARN: number; INFO: number }
    unresolvedMentions: number
  }

  const map = new Map<string, Acc>()
  const issueTotals = { ERROR: 0, WARN: 0, INFO: 0 }
  let unresolvedMentionsTotal = 0

  for (const r of reports) {
    const seg = r.sourceFile.match(MODULE_SEGMENT_RE)
    const key = seg ? seg[1]! : "_other"
    let acc = map.get(key)
    if (!acc) {
      acc = {
        reportCount: 0,
        files: new Set(),
        kinds: {},
        issues: { ERROR: 0, WARN: 0, INFO: 0 },
        unresolvedMentions: 0,
      }
      map.set(key, acc)
    }
    acc.reportCount++
    acc.files.add(r.sourceFile)
    acc.kinds[r.kind] = (acc.kinds[r.kind] ?? 0) + 1
    const ur = r.unresolved.length
    acc.unresolvedMentions += ur
    unresolvedMentionsTotal += ur
    for (const i of r.issues) {
      acc.issues[i.severity]++
      issueTotals[i.severity]++
    }
  }

  const toRow = (module: string, a: Acc): ModuleRollupRow => ({
    module,
    reportCount: a.reportCount,
    files: a.files.size,
    kinds: {
      "module-view": a.kinds["module-view"] ?? 0,
      router: a.kinds.router ?? 0,
      direct: a.kinds.direct ?? 0,
    },
    issues: { ...a.issues },
    unresolvedMentions: a.unresolvedMentions,
  })

  const entries = [...map.entries()]
  const otherPair = entries.find(([k]) => k === "_other")
  const byModule = entries
    .filter(([k]) => k !== "_other")
    .map(([k, a]) => toRow(k, a))
    .sort((x, y) => y.reportCount - x.reportCount)

  const otherReports =
    otherPair && otherPair[1].reportCount > 0 ? toRow("_other", otherPair[1]) : null

  return {
    totalReports: reports.length,
    moduleCount: byModule.length,
    byModule,
    otherReports,
    issueTotals,
    unresolvedMentionsTotal,
  }
}

function formatKindTriple(k: ModuleRollupRow["kinds"]): string {
  return `${k["module-view"]} / ${k.router} / ${k.direct}`
}

function printModuleRollupTable(summary: ModuleRollupSummary): void {
  const rows: ModuleRollupRow[] = [...summary.byModule]
  if (summary.otherReports) rows.push(summary.otherReports)

  console.log("\n╔══════════════════════════════════════════════════════════")
  console.log("║  Form mutation contracts — rollup by app/(modules)/<name>/")
  console.log("╚══════════════════════════════════════════════════════════\n")
  console.log(
    `Total reports: ${summary.totalReports}  |  Issues — ERROR: ${summary.issueTotals.ERROR}, WARN: ${summary.issueTotals.WARN}, INFO: ${summary.issueTotals.INFO}  |  Unresolved mentions: ${summary.unresolvedMentionsTotal}\n`,
  )

  if (fileFilter) console.log(`Filter: ${fileFilter}\n`)
  if (onlyIssues) console.log("(Only reports with non-INFO issues or unresolved items)\n")

  type Col = "module" | "reports" | "files" | "mrd" | "err" | "warn" | "info" | "unres"
  const tableRows: Record<Col, string>[] = rows.map((row) => ({
    module: row.module,
    reports: String(row.reportCount),
    files: String(row.files),
    mrd: formatKindTriple(row.kinds),
    err: String(row.issues.ERROR),
    warn: String(row.issues.WARN),
    info: String(row.issues.INFO),
    unres: String(row.unresolvedMentions),
  }))

  const header: Record<Col, string> = {
    module: "module",
    reports: "reports",
    files: "files",
    mrd: "m / r / d",
    err: "ERROR",
    warn: "WARN",
    info: "INFO",
    unres: "unres",
  }

  const cols: Col[] = ["module", "reports", "files", "mrd", "err", "warn", "info", "unres"]
  const rightAlign: Partial<Record<Col, true>> = {
    reports: true,
    files: true,
    err: true,
    warn: true,
    info: true,
    unres: true,
  }

  const widths: Record<Col, number> = {} as Record<Col, number>
  for (const c of cols) {
    const lens = [header[c].length, ...tableRows.map((r) => r[c].length)]
    widths[c] = Math.max(...lens)
  }

  const padCell = (c: Col, s: string) =>
    rightAlign[c] ? s.padStart(widths[c]!, " ") : s.padEnd(widths[c]!, " ")

  const fmt = (r: Record<Col, string>) => cols.map((c) => padCell(c, r[c])).join("  ")

  console.log(fmt(header))
  console.log(cols.map((c) => "-".repeat(widths[c]!)).join("  "))
  for (const tr of tableRows) console.log(fmt(tr))

  console.log("\nm / r / d = module-view / router / direct\n")
}

function printReports(reports: FormUsageReport[]) {
  const filtered = fileFilter
    ? reports.filter((r) => r.sourceFile.includes(fileFilter) || r.label.includes(fileFilter))
    : reports
  const shown = onlyIssues ? filtered.filter((r) => r.issues.some((i) => i.severity !== "INFO") || r.unresolved.length > 0) : filtered

  if (rollupJson) {
    const summary = buildModuleRollup(shown)
    console.log(
      JSON.stringify(
        {
          totalReports: summary.totalReports,
          moduleCount: summary.moduleCount,
          otherReports: summary.otherReports,
          byModule: summary.byModule,
          issueTotals: summary.issueTotals,
          unresolvedMentionsTotal: summary.unresolvedMentionsTotal,
        },
        null,
        2,
      ),
    )
    return
  }

  if (rollupTable) {
    printModuleRollupTable(buildModuleRollup(shown))
    return
  }

  if (jsonOutput) {
    console.log(JSON.stringify(shown, null, 2))
    return
  }

  const errorCount = shown.reduce((n, r) => n + r.issues.filter((i) => i.severity === "ERROR").length, 0)
  const warnCount = shown.reduce((n, r) => n + r.issues.filter((i) => i.severity === "WARN").length, 0)
  const infoCount = shown.reduce((n, r) => n + r.issues.filter((i) => i.severity === "INFO").length, 0)

  console.log("\n╔══════════════════════════════════════════════════════════")
  console.log("║  Form Mutation Contract Report")
  console.log("╚══════════════════════════════════════════════════════════\n")

  if (fileFilter) console.log(`Filter: ${fileFilter}\n`)

  for (const report of shown) {
    const hasError = report.issues.some((i) => i.severity === "ERROR")
    const hasWarn = report.issues.some((i) => i.severity === "WARN")
    const icon = hasError ? "✗" : hasWarn ? "△" : "✓"
    const reducerText = report.reducerNames.length > 0 ? report.reducerNames.join(", ") : "unresolved"
    console.log(`${icon} ${report.label} -> ${reducerText}`)
    console.log(`   ${report.location}`)
    if (report.action) console.log(`   action: ${report.action}`)
    console.log(`   form fields: ${report.formFields.join(", ") || "(none)"}`)
    console.log(`   used fields: ${report.usedFormFields.join(", ") || "(none)"}`)
    if (report.mutationMappings.length > 0) {
      const samples = report.mutationMappings
        .slice(0, 8)
        .map((mapping) => `${mapping.targetPath} <- ${mapping.sourceFields.join("+") || "derived"}`)
      console.log(`   mappings: ${samples.join("; ")}`)
      if (report.mutationMappings.length > 8) {
        console.log(`   mappings: ... ${report.mutationMappings.length - 8} more`)
      }
    }
    for (const issue of report.issues) {
      const badge = issue.severity === "ERROR" ? "[ERROR]" : issue.severity === "WARN" ? "[WARN] " : "[INFO] "
      console.log(`   ${badge} ${issue.message}`)
    }
    for (const note of report.unresolved) {
      console.log(`   [UNRES] ${note}`)
    }
    console.log("")
  }

  console.log("══════════════════════════════════════════════════════════")
  console.log(`Reports:   ${shown.length}`)
  console.log(`Errors:    ${errorCount}`)
  console.log(`Warnings:  ${warnCount}`)
  console.log(`Infos:     ${infoCount}`)
  console.log("")
}

function main() {
  const sourceFiles = program
    .getSourceFiles()
    .filter((sf) => sf.fileName.startsWith(WEB_APP_DIR) && !sf.isDeclarationFile)

  const reports = sourceFiles.flatMap((sf) => analyzeSourceFile(sf))
  printReports(reports)
}

main()
