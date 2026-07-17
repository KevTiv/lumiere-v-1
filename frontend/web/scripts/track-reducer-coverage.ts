#!/usr/bin/env node
/**
 * Reducer Coverage Tracker
 *
 * Compares SpacetimeDB Rust reducers against frontend /api/call usage.
 * Now also tracks useStdbReducer, callReducer, and other dynamic patterns.
 *
 * Run: npx tsx scripts/track-reducer-coverage.ts
 */

import { execSync } from 'child_process'
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import * as path from 'path'
import {
  INTENTIONALLY_API_ONLY_REDUCERS,
  classifyReducerByHeuristic,
  type ReducerClassification,
} from './reducer-coverage-classifications'

// Simple glob implementation to avoid module issues
function globSync(pattern: string, options: { cwd: string; absolute?: boolean }): string[] {
  const results: string[] = []
  const dir = options.cwd
  const absolute = options.absolute ?? false

  function walk(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '.next' ||
            entry.name === '.turbo' ||
            entry.name === '.claude' ||
            entry.name === '.git' ||
            entry.name === 'target' ||
            entry.name === 'dist'
          ) {
            continue
          }
          walk(fullPath)
        } else if (entry.isFile() && fullPath.endsWith(pattern.replace('**/', '').replace('*', ''))) {
          results.push(absolute ? fullPath : fullPath.replace(dir + path.sep, ''))
        }
      }
    } catch {
      // Skip permission errors
    }
  }

  walk(dir)
  return results
}

function repoRelative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/')
}

function addIndexValue(index: Map<string, Set<string>>, key: string, value: string): void {
  const existing = index.get(key) ?? new Set<string>()
  existing.add(value)
  index.set(key, existing)
}

function firstSetValue(values: Set<string> | undefined): string | null {
  return values ? Array.from(values).sort()[0] ?? null : null
}

const __filename = new URL(import.meta.url).pathname
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '../../..')
const SPACETIMEDB_SRC = path.join(REPO_ROOT, 'spacetimedb/src')
const WEB_SRC = path.join(REPO_ROOT, 'frontend/web')
const STDB_COMMANDS_SRC = path.join(REPO_ROOT, 'frontend/packages/stdb/src/commands')
const STDB_MUTATIONS_SRC = path.join(REPO_ROOT, 'frontend/packages/stdb/src/mutations')
const QUERY_HOOKS_SRC = path.join(REPO_ROOT, 'frontend/packages/query-hooks/src/hooks')
const UI_SRC = path.join(REPO_ROOT, 'frontend/packages/ui/src')
const REPORTS_DIR = path.join(WEB_SRC, 'reports')
const DOCS_DIR = path.join(REPO_ROOT, 'docs')

/** Roots scanned for `POST /api/call/:reducer` literals and `useStdbReducer` (includes shared hooks package). */
const CLIENT_API_CALL_SCAN_ROOTS = [
  WEB_SRC,
  path.join(REPO_ROOT, 'frontend/packages/query-hooks'),
  path.join(REPO_ROOT, 'frontend/packages/stdb/src'),
  path.join(REPO_ROOT, 'frontend/packages/ui/src'),
]

// Regex patterns for reducer detection
const REDUCER_PATTERNS = [
  /#\[reducer\]\s*(?:#\[[^\]]+\]\s*)*pub fn ([a-z_][a-z0-9_]*)/g,
  /#\[spacetimedb::reducer\]\s*(?:#\[[^\]]+\]\s*)*pub fn ([a-z_][a-z0-9_]*)/g,
]

// Excluded reducers - these are for seeding, imports, bootstrap, or internal use
// They don't need UI coverage
const EXCLUDED_PREFIXES = [
  /^seed_/,
  /^import_/,
  /^bootstrap_/,
  /^ensure_dev/,
  /^queue_/,
  /^add_casbin_rule/,
  /^update_casbin_rule/,
  /^remove_casbin_rule/,
  /^load_casbin_policy/,
  /^add_org_member/, // internal auth, not UI
  /^add_user_to_organization/,
  /^add_form_field/, // form config internal
  /^update_form_field/,
  /^delete_form_field/,
  /^set_form_role_config/,
  /^add_user_custom_field/,
  /^delete_user_custom_field/,
]

/**
 * [reducer-ui-platform] Exact reducer → module bucket (was `uncategorized`).
 * @see .cursor/plans/reducer-coverage-triage-reference.md (platform triage encoded here + script)
 */
const EXPLICIT_REDUCER_MODULE: Record<string, string> = {
  // Company & org structure
  create_company: 'settings',
  update_company: 'settings',
  update_company_address: 'settings',
  update_company_business: 'settings',
  update_company_hierarchy: 'settings',
  delete_company: 'settings',
  migrate_all_organizations: 'forms',
  // Reference masters (often seeded)
  create_country: 'settings',
  create_currency: 'settings',
  create_currency_rate: 'accounting',
  // UTM / attribution
  create_utm_campaign: 'crm',
  update_utm_campaign: 'crm',
  create_utm_medium: 'crm',
  update_utm_medium: 'crm',
  create_utm_source: 'crm',
  update_utm_source: 'crm',
  // Privacy / compliance
  create_data_classification: 'settings',
  create_data_classification_rule: 'settings',
  // Payment terms & payments
  create_payment_term: 'accounting',
  update_payment_term: 'accounting',
  delete_payment_term: 'accounting',
  create_payment_term_line: 'accounting',
  update_payment_term_line: 'accounting',
  delete_payment_term_line: 'accounting',
  create_payment: 'accounting',
  create_payment_method: 'sales',
  cancel_payment: 'accounting',
  post_payment: 'accounting',
  register_payment_on_invoice: 'accounting',
  compute_invoice_totals: 'accounting',
  post_invoice: 'accounting',
  // Bank & fiscal periods
  unreconciled_account_bank_statement_line: 'accounting',
  match_bank_line: 'accounting',
  open_account_period: 'accounting',
  // Partners / PO workflow
  create_partner_bank: 'purchasing',
  update_partner_bank: 'purchasing',
  delete_partner_bank: 'purchasing',
  update_po_receipt_status: 'purchasing',
  update_po_invoice_status: 'purchasing',
  // Logistics & loyalty (POS / sales)
  create_delivery_carrier: 'sales',
  create_delivery_price_rule: 'sales',
  create_shipping_method: 'sales',
  create_loyalty_program: 'sales',
  create_loyalty_card: 'sales',
  // Inventory masters & traceability
  create_adjustment_reason: 'inventory',
  use_serial: 'inventory',
  create_traceability_record: 'inventory',
  create_traceability_report: 'inventory',
  run_traceability_report: 'inventory',
  remove_rule_from_nomenclature: 'inventory',
  process_pending_scans: 'inventory',
  // Fixed assets
  set_asset_active: 'accounting',
  // IoT
  acknowledge_iot_action: 'iot',
  fail_iot_action: 'iot',
  retry_iot_action: 'iot',
  create_iot_action: 'iot',
  create_iot_alert: 'iot',
  resolve_iot_alert: 'iot',
  set_iot_threshold: 'iot',
  update_device_status: 'iot',
  mark_action_sent: 'iot',
  // Search / embeddings
  upsert_search_embedding: 'ai',
  mark_embedding_synced: 'ai',
  delete_search_embedding: 'ai',
  request_embedding_job: 'ai',
  // Messaging / follow
  post_internal_note: 'crm',
  subscribe_to_record: 'crm',
  unsubscribe_from_record: 'crm',
  // Auth / dev (non–end-user surfaces)
  dev_promote_caller_superuser: 'auth',
  link_workos_user: 'auth',
  mark_reset_token_used: 'auth',
  // Workers
  worker_heartbeat: 'internal',
}

/**
 * [reducer-ui-platform] Excluded from **product** UI coverage expectations (API, worker, defer).
 * Still bucketed in {@link EXPLICIT_REDUCER_MODULE} for `byModule.rust`.
 */
const PLATFORM_TRIAGE_EXCLUDED_FROM_PRODUCT: Record<string, string> = {
  migrate_all_organizations: 'platform_api',
  create_country: 'platform_defer',
  create_currency: 'platform_defer',
  /**
   * Scheduled reducer (`TaxDeadlineStatusJob`). Browsers call `refresh_tax_deadline_statuses`
   * (Taxes tab) for the same status refresh logic.
   */
  update_tax_deadlines: 'platform_api',
  update_device_status: 'platform_api',
  upsert_search_embedding: 'platform_api',
  mark_embedding_synced: 'platform_api',
  delete_search_embedding: 'platform_api',
  request_embedding_job: 'platform_api',
  mark_action_sent: 'platform_api',
  process_pending_scans: 'platform_api',
  dev_promote_caller_superuser: 'platform_api',
  link_workos_user: 'platform_api',
  mark_reset_token_used: 'platform_api',
  worker_heartbeat: 'platform_api',
}

// Patterns for detecting reducer usage in TypeScript
const WEB_DETECTION_PATTERNS = {
  // Direct fetch calls like '/api/call/create_account_account'
  apiCallLiteral: /['"]\/api\/call\/([a-z0-9_]+)(\?[^'"]*)?['"]/g,
  // useStdbReducer('name')
  useStdbReducer: /useStdbReducer\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
  // useStdbReducerWithInvalidation('name', ...)
  useStdbReducerWithInvalidation: /useStdbReducerWithInvalidation\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
  // useStdbCallMutation('name', ...)
  useStdbCallMutation: /useStdbCallMutation\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
  // callReducer('name', ...) - server-side lib
  callReducerLiteral: /callReducer\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
  // callReducersBatch entries
  callReducersBatch: /\{\s*reducer\s*:\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
  /** `@lumiere/stdb` browser mutations → same gateway as `/api/call` */
  stdbBrowserCall: /stdbBrowserCall\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
}

interface CoverageReport {
  totalRustReducers: number
  productRustReducers: number // Excluding bootstrap/import/seed
  totalWebReducers: number
  missingFromWeb: string[]
  coverageModel: 'matrix-hook-ui'
  matrixStatusSummary: Record<string, number>
  matrixClassificationSummary: Record<string, number>
  byModule: Record<
    string,
    {
      rust: string[]
      web: string[]
      missing: string[]
      coverage: number
      productReducers: string[] // Excluding bootstrap
      productCoverage: number // Coverage of product reducers only
    }
  >
  excludedReducers: {
    count: number
    byCategory: Record<string, string[]>
  }
  detectionSources: {
    apiCallLiteral: number
    useStdbReducer: number
    useStdbReducerWithInvalidation: number
    useStdbCallMutation: number
    callReducerLiteral: number
    callReducersBatch: number
    stdbBrowserCall: number
  }
}

function countRowsBy(rows: ReducerCoverageRow[], key: 'status' | 'classification'): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row[key]] = (acc[row[key]] ?? 0) + 1
    return acc
  }, {})
}

function hasHookOrUiLayer(row: ReducerCoverageRow): boolean {
  return row.hook != null || row.uiCaller != null
}

type CoverageStatus =
  | 'reachable-ui'
  | 'hook-only'
  | 'command-only'
  | 'backend-only'
  | 'api-only-intentional'
  | 'internal-intentional'
  | 'deprecated'
  | 'needs-triage'

interface ReducerCoverageRow {
  reducer: string
  backendFile: string | null
  module: string
  commandWrapper: string | null
  hook: string | null
  uiCaller: string | null
  routeOrPage: string | null
  classification: ReducerClassification
  status: CoverageStatus
  notes: string
}

interface LayerIndex {
  backendFiles: Map<string, string>
  commandWrappers: Map<string, Set<string>>
  hooks: Map<string, Set<string>>
  uiCallers: Map<string, Set<string>>
}

function isExcludedReducer(name: string): { excluded: boolean; category: string } {
  for (const pattern of EXCLUDED_PREFIXES) {
    if (pattern.test(name)) {
      let category = 'other'
      if (/^seed_/.test(name)) category = 'seed'
      else if (/^import_/.test(name)) category = 'import'
      else if (/^bootstrap_/.test(name)) category = 'bootstrap'
      else if (/^ensure_dev/.test(name)) category = 'bootstrap'
      else if (/^queue_/.test(name)) category = 'internal_queue'
      else if (/^add_casbin_rule|^update_casbin_rule|^remove_casbin_rule|^load_casbin_policy/.test(name)) category = 'casbin_auth'
      else if (/^add_org_member|^add_user_to_organization/.test(name)) category = 'org_membership'
      else if (/^add_form_field|^update_form_field|^delete_form_field|^set_form_role_config/.test(name)) category = 'form_config'
      else if (/^add_user_custom_field|^delete_user_custom_field/.test(name)) category = 'user_custom_fields'
      return { excluded: true, category }
    }
  }
  const platformCat = PLATFORM_TRIAGE_EXCLUDED_FROM_PRODUCT[name]
  if (platformCat) {
    return { excluded: true, category: platformCat }
  }
  return { excluded: false, category: '' }
}

function extractRustReducers(): Set<string> {
  const reducers = new Set<string>()
  const files = globSync('**/*.rs', { cwd: SPACETIMEDB_SRC, absolute: true })

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    for (const pattern of REDUCER_PATTERNS) {
      let match: RegExpExecArray | null
      pattern.lastIndex = 0
      while ((match = pattern.exec(content)) !== null) {
        reducers.add(match[1])
      }
    }
  }

  return reducers
}

function extractRustReducerFiles(): Map<string, string> {
  const reducerFiles = new Map<string, string>()
  const files = globSync('**/*.rs', { cwd: SPACETIMEDB_SRC, absolute: true })

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    for (const pattern of REDUCER_PATTERNS) {
      let match: RegExpExecArray | null
      pattern.lastIndex = 0
      while ((match = pattern.exec(content)) !== null) {
        reducerFiles.set(match[1], repoRelative(file))
      }
    }
  }

  return reducerFiles
}

function extractWebReducers(): {
  reducers: Set<string>
  sources: Record<string, Set<string>>
} {
  const allReducers = new Set<string>()
  const sources: Record<string, Set<string>> = {
    apiCallLiteral: new Set(),
    useStdbReducer: new Set(),
    useStdbReducerWithInvalidation: new Set(),
    useStdbCallMutation: new Set(),
    callReducerLiteral: new Set(),
    callReducersBatch: new Set(),
    stdbBrowserCall: new Set(),
  }

  // Try ripgrep first for fast literal /api/call detection
  try {
    const roots = CLIENT_API_CALL_SCAN_ROOTS.map((p) => JSON.stringify(p)).join(' ')
    const output = execSync(
      `rg -o '/api/call/[a-z0-9_?]+' ${roots} --glob '*.ts' --glob '*.tsx' | sed 's|.*/api/call/||' | sed 's/?.*//' | sort -u`,
      { encoding: 'utf-8', cwd: REPO_ROOT }
    )
    for (const name of output.trim().split('\n').filter(Boolean)) {
      allReducers.add(name)
      sources.apiCallLiteral.add(name)
    }
  } catch {
    // Fallback will handle this
  }

  // Scan files for all patterns (including fallback for /api/call).
  // Note: globSync does not expand `{ts,tsx}` — use separate patterns.
  const files: string[] = []
  for (const root of CLIENT_API_CALL_SCAN_ROOTS) {
    files.push(
      ...globSync('**/*.ts', { cwd: root, absolute: true }),
      ...globSync('**/*.tsx', { cwd: root, absolute: true }),
    )
  }

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8')

      // apiCallLiteral pattern
      let match: RegExpExecArray | null
      WEB_DETECTION_PATTERNS.apiCallLiteral.lastIndex = 0
      while ((match = WEB_DETECTION_PATTERNS.apiCallLiteral.exec(content)) !== null) {
        allReducers.add(match[1])
        sources.apiCallLiteral.add(match[1])
      }

      // useStdbReducer pattern
      WEB_DETECTION_PATTERNS.useStdbReducer.lastIndex = 0
      while ((match = WEB_DETECTION_PATTERNS.useStdbReducer.exec(content)) !== null) {
        allReducers.add(match[1])
        sources.useStdbReducer.add(match[1])
      }

      // useStdbReducerWithInvalidation pattern
      WEB_DETECTION_PATTERNS.useStdbReducerWithInvalidation.lastIndex = 0
      while ((match = WEB_DETECTION_PATTERNS.useStdbReducerWithInvalidation.exec(content)) !== null) {
        allReducers.add(match[1])
        sources.useStdbReducerWithInvalidation.add(match[1])
      }

      // useStdbCallMutation pattern
      WEB_DETECTION_PATTERNS.useStdbCallMutation.lastIndex = 0
      while ((match = WEB_DETECTION_PATTERNS.useStdbCallMutation.exec(content)) !== null) {
        allReducers.add(match[1])
        sources.useStdbCallMutation.add(match[1])
      }

      // callReducer pattern
      WEB_DETECTION_PATTERNS.callReducerLiteral.lastIndex = 0
      while ((match = WEB_DETECTION_PATTERNS.callReducerLiteral.exec(content)) !== null) {
        allReducers.add(match[1])
        sources.callReducerLiteral.add(match[1])
      }

      // callReducersBatch pattern
      WEB_DETECTION_PATTERNS.callReducersBatch.lastIndex = 0
      while ((match = WEB_DETECTION_PATTERNS.callReducersBatch.exec(content)) !== null) {
        allReducers.add(match[1])
        sources.callReducersBatch.add(match[1])
      }

      WEB_DETECTION_PATTERNS.stdbBrowserCall.lastIndex = 0
      while ((match = WEB_DETECTION_PATTERNS.stdbBrowserCall.exec(content)) !== null) {
        allReducers.add(match[1])
        sources.stdbBrowserCall.add(match[1])
      }
    } catch {
      // Skip unreadable files
    }
  }

  return { reducers: allReducers, sources }
}

/** Map generated client method names (camelCase) to Rust reducer names (snake_case). */
function camelReducerMethodToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * SpacetimeDB TS client calls look like `conn.reducers.createFormConfiguration({ ... })`.
 * Those live under frontend/packages/stdb and frontend/packages/ui (not only frontend/web).
 */
function mergeWorkspacePackageReducerCalls(webResult: ReturnType<typeof extractWebReducers>): void {
  const extraRoots = [
    path.join(REPO_ROOT, 'frontend/packages/stdb/src'),
    path.join(REPO_ROOT, 'frontend/packages/ui/src'),
  ]
  const pattern = /\.reducers\.([a-z][a-zA-Z0-9]*)\s*\(/g
  for (const root of extraRoots) {
    const files = [
      ...globSync('**/*.ts', { cwd: root, absolute: true }),
      ...globSync('**/*.tsx', { cwd: root, absolute: true }),
    ]
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8')
        let match: RegExpExecArray | null
        pattern.lastIndex = 0
        while ((match = pattern.exec(content)) !== null) {
          webResult.reducers.add(camelReducerMethodToSnake(match[1]))
        }
      } catch {
        // skip unreadable
      }
    }
  }
}

function extractCommandWrappers(): Map<string, Set<string>> {
  const wrappers = new Map<string, Set<string>>()
  const files = globSync('**/*.ts', { cwd: STDB_COMMANDS_SRC, absolute: true })
  const reducerLiteral = /['"`]([a-z_][a-z0-9_]*)['"`]/g

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    if (!content.includes('_BFF_REDUCERS')) continue
    let match: RegExpExecArray | null
    reducerLiteral.lastIndex = 0
    while ((match = reducerLiteral.exec(content)) !== null) {
      const reducer = match[1]
      if (reducer.includes('_')) {
        addIndexValue(wrappers, reducer, repoRelative(file))
      }
    }
  }

  return wrappers
}

function wrapperFunctionBefore(content: string, offset: number): string | null {
  const before = content.slice(0, offset)
  const matches = Array.from(before.matchAll(/export function ([A-Za-z_][A-Za-z0-9_]*)\s*\(/g))
  return matches.at(-1)?.[1] ?? null
}

function extractHookWrappers(): Map<string, Set<string>> {
  const hooks = new Map<string, Set<string>>()
  const files = [
    ...globSync('**/*.ts', { cwd: QUERY_HOOKS_SRC, absolute: true }),
    ...globSync('**/*.ts', { cwd: STDB_MUTATIONS_SRC, absolute: true }),
  ]
  const patterns = [
    /\b[a-zA-Z]+BffPost\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
    /['"]\/api\/call\/([a-z_][a-z0-9_]*)/g,
    /useAccountingCallMutation\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
    /useStdb(?:Reducer|CallMutation|ReducerWithInvalidation)?\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
    /stdbBrowserCall\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g,
  ]

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      pattern.lastIndex = 0
      while ((match = pattern.exec(content)) !== null) {
        const hook = wrapperFunctionBefore(content, match.index)
        addIndexValue(
          hooks,
          match[1],
          `${repoRelative(file)}${hook ? `#${hook}` : ''}`,
        )
      }
    }
  }

  return hooks
}

function extractUiCallers(hooks: Map<string, Set<string>>): Map<string, Set<string>> {
  const callers = new Map<string, Set<string>>()
  const files = [
    ...globSync('**/*.ts', { cwd: path.join(WEB_SRC, 'app'), absolute: true }),
    ...globSync('**/*.tsx', { cwd: path.join(WEB_SRC, 'app'), absolute: true }),
    ...globSync('**/*.ts', { cwd: path.join(WEB_SRC, 'lib'), absolute: true }),
    ...globSync('**/*.tsx', { cwd: path.join(WEB_SRC, 'lib'), absolute: true }),
    ...globSync('**/*.ts', { cwd: UI_SRC, absolute: true }),
    ...globSync('**/*.tsx', { cwd: UI_SRC, absolute: true }),
  ]
  const hookToReducers = new Map<string, Set<string>>()

  for (const [reducer, hookRefs] of hooks.entries()) {
    for (const ref of hookRefs) {
      const hookName = ref.split('#')[1]
      if (!hookName) continue
      addIndexValue(hookToReducers, hookName, reducer)
    }
  }

  for (const file of files) {
    const rel = repoRelative(file)
    const content = readFileSync(file, 'utf-8')

    for (const [hookName, reducers] of hookToReducers.entries()) {
      if (!content.includes(hookName)) continue
      for (const reducer of reducers) {
        addIndexValue(callers, reducer, rel)
      }
    }

    for (const reducer of hooks.keys()) {
      if (content.includes(`/api/call/${reducer}`) || content.includes(`"${reducer}"`) || content.includes(`'${reducer}'`)) {
        addIndexValue(callers, reducer, rel)
      }
    }
  }

  return callers
}

function categorizeByModule(reducerName: string): string {
  const explicit = EXPLICIT_REDUCER_MODULE[reducerName]
  if (explicit) return explicit

  // Map reducer prefixes to modules
  const prefixMap: Record<string, string> = {
    create_account_: 'accounting',
    update_account_: 'accounting',
    delete_account_: 'accounting',
    post_account_: 'accounting',
    cancel_account_: 'accounting',
    confirm_account_: 'accounting',
    close_account_: 'accounting',
    reconcile_: 'accounting',
    budget: 'accounting',
    analytic_: 'accounting',
    tax_: 'accounting',
    fiscal_: 'accounting',
    consolidation: 'accounting',
    intercompany: 'accounting',
    fixed_asset: 'accounting',
    depreciation: 'accounting',
    elimination: 'accounting',
    trial_balance: 'accounting',
    add_account_move_line: 'accounting',
    reconcile_account_move: 'accounting',
    unreconcile_account_move: 'accounting',
    partial_reconcile_account_move: 'accounting',
    apply_reconciliation_rules: 'accounting',
    create_account_journal: 'accounting',
    update_account_journal: 'accounting',
    delete_account_journal: 'accounting',
    update_account_move: 'accounting',
    delete_account_move: 'accounting',
    create_account_payment: 'accounting',
    update_account_payment: 'accounting',
    delete_account_payment: 'accounting',
    post_account_payment: 'accounting',
    cancel_account_payment: 'accounting',
    create_account_asset: 'accounting',
    update_account_asset: 'accounting',
    close_account_asset: 'accounting',
    compute_asset_depreciation: 'accounting',
    dispose_account_asset: 'accounting',
    create_account_fiscal_year: 'accounting',
    update_account_fiscal_year: 'accounting',
    close_account_period: 'accounting',
    reopen_account_period: 'accounting',
    create_account_period: 'accounting',
    update_account_period: 'accounting',

    create_sale_: 'sales',
    update_sale_: 'sales',
    confirm_sales_: 'sales',
    cancel_sale_: 'sales',
    pricelist: 'sales',
    picking_batch: 'sales',
    complete_picking_batch: 'sales',
    pos_: 'sales',
    create_pos_: 'sales',
    update_pos_: 'sales',
    delete_pos_: 'sales',
    activate_pos_: 'sales',
    deactivate_pos_: 'sales',
    open_pos_: 'sales',
    close_pos_: 'sales',
    create_sale_order: 'sales',
    update_sale_order: 'sales',
    delete_sale_order: 'sales',
    confirm_sale_order: 'sales',
    cancel_sale_order: 'sales',
    lock_sale_order: 'sales',
    unlock_sale_order: 'sales',
    create_sale_order_line: 'sales',
    update_sale_order_line: 'sales',
    delete_sale_order_line: 'sales',

    create_purchase_: 'purchasing',
    update_purchase_: 'purchasing',
    confirm_purchase_: 'purchasing',
    cancel_purchase_: 'purchasing',
    receive_po_: 'purchasing',
    invoice_po_: 'purchasing',
    purchase_requisition: 'purchasing',
    landed_cost: 'purchasing',
    supplier_intake: 'purchasing',
    compute_purchase_: 'purchasing',
    create_purchase_order: 'purchasing',
    update_purchase_order: 'purchasing',
    delete_purchase_order: 'purchasing',
    confirm_purchase_order: 'purchasing',
    cancel_purchase_order: 'purchasing',
    lock_purchase_order: 'purchasing',
    unlock_purchase_order: 'purchasing',
    create_purchase_order_line: 'purchasing',
    update_purchase_order_line: 'purchasing',
    delete_purchase_order_line: 'purchasing',
    receive_purchase_order: 'purchasing',
    create_purchase_requisition: 'purchasing',
    update_purchase_requisition: 'purchasing',
    delete_purchase_requisition: 'purchasing',
    confirm_purchase_requisition: 'purchasing',
    cancel_purchase_requisition: 'purchasing',
    create_landed_cost: 'purchasing',
    update_landed_cost: 'purchasing',
    delete_landed_cost: 'purchasing',
    validate_landed_cost: 'purchasing',
    compute_landed_costs: 'purchasing',
    apply_landed_costs: 'purchasing',
    add_landed_cost_line: 'purchasing',
    create_supplier_intake: 'purchasing',
    update_supplier_intake: 'purchasing',
    delete_supplier_intake: 'purchasing',
    approve_supplier_intake: 'purchasing',

    create_project: 'projects',
    update_project: 'projects',
    delete_project: 'projects',
    set_project_: 'projects',
    toggle_project_: 'projects',
    create_task: 'projects',
    update_task: 'projects',
    set_task_: 'projects',
    assign_task_: 'projects',
    timesheet: 'projects',
    log_timesheet: 'projects',
    bill_timesheets: 'projects',
    validate_timesheets: 'projects',
    start_timesheet_timer: 'projects',
    stop_timesheet_timer: 'projects',
    delete_task: 'projects',
    archive_project: 'projects',
    unarchive_project: 'projects',
    duplicate_project: 'projects',
    set_project_template: 'projects',

    create_mrp_: 'manufacturing',
    update_mrp_: 'manufacturing',
    delete_mrp_: 'manufacturing',
    confirm_manufacturing_: 'manufacturing',
    start_manufacturing_: 'manufacturing',
    finish_manufacturing_: 'manufacturing',
    cancel_manufacturing_: 'manufacturing',
    produce_manufacturing_: 'manufacturing',
    consume_mo_: 'manufacturing',
    check_mo_: 'manufacturing',
    bom: 'manufacturing',
    workorder: 'manufacturing',
    workcenter: 'manufacturing',
    routing: 'manufacturing',
    productivity: 'manufacturing',
    create_bom: 'manufacturing',
    update_bom: 'manufacturing',
    delete_bom: 'manufacturing',
    create_mrp_production: 'manufacturing',
    update_mrp_production: 'manufacturing',
    delete_mrp_production: 'manufacturing',
    confirm_mrp_production: 'manufacturing',
    start_mrp_production: 'manufacturing',
    finish_mrp_production: 'manufacturing',
    cancel_mrp_production: 'manufacturing',
    create_mrp_workorder: 'manufacturing',
    update_mrp_workorder: 'manufacturing',
    delete_mrp_workorder: 'manufacturing',
    start_mrp_workorder: 'manufacturing',
    finish_mrp_workorder: 'manufacturing',
    pause_mrp_workorder: 'manufacturing',
    unblock_mrp_workorder: 'manufacturing',
    create_mrp_workcenter: 'manufacturing',
    update_mrp_workcenter: 'manufacturing',
    delete_mrp_workcenter: 'manufacturing',
    record_workcenter_productivity: 'manufacturing',

    create_employee: 'hr',
    update_employee: 'hr',
    delete_employee: 'hr',
    archive_employee: 'hr',
    unarchive_employee: 'hr',
    create_department: 'hr',
    update_department: 'hr',
    delete_department: 'hr',
    create_job_position: 'hr',
    update_job_position: 'hr',
    delete_job_position: 'hr',
    leave_: 'hr',
    approve_leave: 'hr',
    refuse_leave: 'hr',
    reset_leave_: 'hr',
    create_contract: 'hr',
    update_contract: 'hr',
    delete_contract: 'hr',
    cancel_contract: 'hr',
    open_contract: 'hr',
    expire_contract: 'hr',
    payroll: 'hr',
    payslip: 'hr',
    salary_rule: 'hr',
    create_leave_request: 'hr',
    update_leave_request: 'hr',
    delete_leave_request: 'hr',
    create_hr_contract: 'hr',
    update_hr_contract: 'hr',
    delete_hr_contract: 'hr',
    create_hr_payslip: 'hr',
    update_hr_payslip: 'hr',
    delete_hr_payslip: 'hr',
    compute_hr_payslip: 'hr',
    confirm_hr_payslip: 'hr',
    cancel_hr_payslip: 'hr',
    process_payroll: 'hr',
    create_hr_payroll_structure: 'hr',
    update_hr_payroll_structure: 'hr',
    delete_hr_payroll_structure: 'hr',

    create_inventory_: 'inventory',
    update_inventory_: 'inventory',
    delete_inventory_: 'inventory',
    process_inventory_: 'inventory',
    stock_: 'inventory',
    warehouse: 'inventory',
    product_: 'inventory',
    create_product: 'inventory',
    update_product: 'inventory',
    delete_product: 'inventory',
    uom: 'inventory',
    barcode: 'inventory',
    quality: 'inventory',
    replenishment: 'inventory',
    cycle_count: 'inventory',
    picking_wave: 'inventory',
    create_stock_picking: 'inventory',
    update_stock_picking: 'inventory',
    delete_stock_picking: 'inventory',
    confirm_stock_picking: 'inventory',
    assign_stock_picking: 'inventory',
    validate_stock_picking: 'inventory',
    cancel_stock_picking: 'inventory',
    return_stock_picking: 'inventory',
    create_stock_move: 'inventory',
    update_stock_move: 'inventory',
    delete_stock_move: 'inventory',
    create_stock_quant: 'inventory',
    update_stock_quant: 'inventory',
    create_inventory_adjustment: 'inventory',
    update_inventory_adjustment: 'inventory',
    delete_inventory_adjustment: 'inventory',
    confirm_inventory_adjustment: 'inventory',
    validate_inventory_adjustment: 'inventory',
    cancel_inventory_adjustment: 'inventory',
    create_product_category: 'inventory',
    update_product_category: 'inventory',
    delete_product_category: 'inventory',
    create_uom: 'inventory',
    create_product_pricelist: 'inventory',
    update_product_pricelist: 'inventory',
    delete_product_pricelist: 'inventory',
    create_warehouse: 'inventory',
    update_warehouse: 'inventory',
    delete_warehouse: 'inventory',
    create_stock_location: 'inventory',
    update_stock_location: 'inventory',
    delete_stock_location: 'inventory',
    create_stock_production_lot: 'inventory',
    update_stock_production_lot: 'inventory',
    delete_stock_production_lot: 'inventory',
    create_stock_production_serial: 'inventory',
    update_stock_production_serial: 'inventory',
    delete_stock_production_serial: 'inventory',
    create_quality_check: 'inventory',
    pass_quality_check: 'inventory',
    fail_quality_check: 'inventory',
    create_quality_alert: 'inventory',
    assign_quality_alert: 'inventory',
    cancel_quality_alert: 'inventory',
    create_replenishment_rule: 'inventory',
    create_stock_cycle_count: 'inventory',
    update_stock_cycle_count: 'inventory',
    delete_stock_cycle_count: 'inventory',
    start_stock_cycle_count: 'inventory',
    complete_stock_cycle_count: 'inventory',
    cancel_stock_cycle_count: 'inventory',
    create_picking_wave: 'inventory',
    confirm_picking_wave: 'inventory',
    release_picking_wave: 'inventory',
    create_inventory_close: 'inventory',
    create_packaging_material: 'inventory',
    run_cartonization: 'inventory',
    activate_consignment_agreement: 'inventory',
    receive_consignment_stock: 'inventory',
    execute_cross_dock: 'inventory',
    execute_directed_putaway: 'inventory',

    cancel_stock_package: 'inventory',
    confirm_stock_package: 'inventory',
    create_stock_package: 'inventory',
    done_stock_package: 'inventory',
    pack_moves_into_package: 'inventory',
    pack_stock_picking: 'inventory',
    refresh_inventory_exceptions: 'inventory',
    resolve_inventory_exception: 'inventory',
    create_warehouse_sync_intent: 'inventory',
    apply_warehouse_sync_intent: 'inventory',
    fail_warehouse_sync_intent: 'inventory',
    refresh_sale_order_promise_dates: 'sales',
    run_inventory_close: 'inventory',
    reopen_inventory_close: 'inventory',
    create_inventory_integration_intent: 'inventory',
    record_inventory_integration_result: 'inventory',
    complete_picking_wave: 'inventory',
    create_barcode_rule: 'inventory',
    update_barcode_rule: 'inventory',
    delete_barcode_rule: 'inventory',

    create_lead: 'crm',
    update_lead_: 'crm',
    convert_lead_: 'crm',
    create_opportunity: 'crm',
    update_opportunity: 'crm',
    convert_opportunity_: 'crm',
    create_contact: 'crm',
    update_contact: 'crm',
    delete_contact: 'crm',
    create_activity: 'crm',
    complete_activity: 'crm',
    contact_segment: 'crm',
    contact_tag: 'crm',
    assign_tag_to_contact: 'crm',
    add_contact_to_segment: 'crm',
    delete_lead: 'crm',
    archive_lead: 'crm',
    restore_lead: 'crm',
    create_crm_lead: 'crm',
    update_crm_lead: 'crm',
    delete_crm_lead: 'crm',
    convert_crm_lead: 'crm',
    mark_lead_as_lost: 'crm',
    create_crm_opportunity: 'crm',
    update_crm_opportunity: 'crm',
    delete_crm_opportunity: 'crm',
    convert_crm_opportunity: 'crm',
    create_crm_contact: 'crm',
    update_crm_contact: 'crm',
    delete_crm_contact: 'crm',
    create_crm_activity: 'crm',
    update_crm_activity: 'crm',
    delete_crm_activity: 'crm',
    schedule_crm_activity: 'crm',
    complete_crm_activity: 'crm',
    create_contact_segment: 'crm',
    update_contact_segment: 'crm',
    delete_contact_segment: 'crm',
    create_contact_tag: 'crm',
    update_contact_tag: 'crm',
    delete_contact_tag: 'crm',

    create_expense: 'expenses',
    update_expense: 'expenses',
    delete_expense: 'expenses',
    submit_expense: 'expenses',
    approve_expense: 'expenses',
    refuse_expense: 'expenses',
    reset_expense: 'expenses',
    create_expense_sheet: 'expenses',
    update_expense_sheet: 'expenses',
    delete_expense_sheet: 'expenses',
    submit_expense_sheet: 'expenses',
    approve_expense_sheet: 'expenses',
    refuse_expense_sheet: 'expenses',
    post_expense_sheet: 'expenses',
    create_expense_reimbursement_payment: 'expenses',
    create_expense_project_rebill: 'expenses',
    create_expense_integration_intent: 'expenses',
    apply_expense_integration_intent: 'expenses',
    fail_expense_integration_intent: 'expenses',
    create_expense_advance: 'expenses',
    apply_expense_advance_to_sheet: 'expenses',
    request_expense_policy_exception: 'expenses',
    approve_expense_policy_exception: 'expenses',
    set_expense_fraud_hold: 'expenses',
    set_expense_allocations: 'expenses',
    upsert_expense_mileage_rate: 'expenses',
    upsert_expense_per_diem_rate: 'expenses',
    upsert_expense_policy: 'expenses',
    reset_expense_sheet: 'expenses',
    create_expense_report: 'expenses',
    update_expense_report: 'expenses',
    delete_expense_report: 'expenses',

    create_ticket: 'helpdesk',
    update_ticket: 'helpdesk',
    delete_ticket: 'helpdesk',
    assign_ticket: 'helpdesk',
    close_ticket: 'helpdesk',
    reopen_ticket: 'helpdesk',
    helpdesk_team: 'helpdesk',
    helpdesk_stage: 'helpdesk',
    helpdesk_sla: 'helpdesk',
    create_helpdesk_ticket: 'helpdesk',
    update_helpdesk_ticket: 'helpdesk',
    delete_helpdesk_ticket: 'helpdesk',
    merge_helpdesk_tickets: 'helpdesk',
    escalate_helpdesk_ticket: 'helpdesk',
    assign_helpdesk_ticket: 'helpdesk',
    resolve_helpdesk_ticket: 'helpdesk',
    close_helpdesk_ticket: 'helpdesk',
    reopen_helpdesk_ticket: 'helpdesk',
    create_helpdesk_team: 'helpdesk',
    update_helpdesk_team: 'helpdesk',
    delete_helpdesk_team: 'helpdesk',
    create_helpdesk_stage: 'helpdesk',
    update_helpdesk_stage: 'helpdesk',
    delete_helpdesk_stage: 'helpdesk',
    create_helpdesk_sla: 'helpdesk',
    update_helpdesk_sla: 'helpdesk',
    delete_helpdesk_sla: 'helpdesk',

    create_document: 'documents',
    update_document: 'documents',
    delete_document: 'documents',
    lock_document: 'documents',
    unlock_document: 'documents',
    add_document_version: 'documents',
  record_document_view: 'documents',
    knowledge_: 'documents',
    create_knowledge_article: 'documents',
    update_knowledge_article: 'documents',
    delete_knowledge_article: 'documents',
    publish_knowledge_article: 'documents',
    archive_knowledge_article: 'documents',
    create_document_folder: 'documents',
    update_document_folder: 'documents',
    delete_document_folder: 'documents',
    create_document_processing_job: 'documents',
    approve_document_processing_job: 'documents',
    complete_document_processing_job: 'documents',
    acknowledge_insight: 'documents',

    create_subscription: 'subscriptions',
    update_subscription: 'subscriptions',
    delete_subscription: 'subscriptions',
    activate_subscription: 'subscriptions',
    close_subscription: 'subscriptions',
    cancel_subscription: 'subscriptions',
    generate_subscription_: 'subscriptions',
    deferred_revenue: 'subscriptions',
    revenue_recognition: 'subscriptions',
    create_subscription_plan: 'subscriptions',
    update_subscription_plan: 'subscriptions',
    delete_subscription_plan: 'subscriptions',
    create_deferred_revenue_schedule: 'subscriptions',
    update_deferred_revenue_schedule: 'subscriptions',
    delete_deferred_revenue_schedule: 'subscriptions',
    recognize_revenue: 'subscriptions',

    create_proposal: 'proposals',
    update_proposal: 'proposals',
    delete_proposal: 'proposals',
    upsert_proposal_section: 'proposals',
    add_proposal_: 'proposals',
    delete_proposal_: 'proposals',
    update_proposal_: 'proposals',
    save_proposal_version: 'proposals',
    reorder_proposal_line_items: 'proposals',
    clear_proposal_presence: 'proposals',
    resolve_proposal_comment: 'proposals',
    submit_proposal: 'proposals',
    approve_proposal: 'proposals',
    reject_proposal: 'proposals',
    convert_proposal_to_sale_order: 'proposals',
    send_proposal: 'proposals',
    preview_proposal: 'proposals',
    add_proposal_comment: 'proposals',
    delete_proposal_comment: 'proposals',
    update_proposal_comment: 'proposals',
    add_proposal_line_item: 'proposals',
    update_proposal_line_item: 'proposals',
    delete_proposal_line_item: 'proposals',

    create_calendar_event: 'calendar',
    update_calendar_event: 'calendar',
    delete_calendar_event: 'calendar',
    create_meeting: 'calendar',
    update_meeting: 'calendar',
    delete_meeting: 'calendar',

    create_workflow: 'workflows',
    add_workflow_: 'workflows',
    set_workflow_: 'workflows',
    start_workflow: 'workflows',
    signal_workflow: 'workflows',
    cancel_workflow_: 'workflows',
    set_workitem_: 'workflows',
    delete_workflow: 'workflows',
    update_workflow: 'workflows',
    create_workflow_definition: 'workflows',
    update_workflow_definition: 'workflows',
    delete_workflow_definition: 'workflows',
    create_workflow_activity: 'workflows',
    update_workflow_activity: 'workflows',
    delete_workflow_activity: 'workflows',
    add_workflow_transition: 'workflows',
    update_workflow_transition: 'workflows',
    delete_workflow_transition: 'workflows',
    start_workflow_instance: 'workflows',
    cancel_workflow_instance: 'workflows',
    signal_workflow_instance: 'workflows',
    set_workitem_state: 'workflows',
    claim_workitem: 'workflows',
    complete_workitem: 'workflows',

    create_fleet_vehicle: 'fleet',
    update_fleet_vehicle: 'fleet',
    delete_fleet_vehicle: 'fleet',
    update_vehicle_position: 'fleet',
    update_vehicle_odometer: 'fleet',
    create_fleet_driver: 'fleet',
    update_fleet_driver: 'fleet',
    delete_fleet_driver: 'fleet',
    assign_fleet_driver: 'fleet',
    unassign_fleet_driver: 'fleet',
    create_fleet_trip: 'fleet',
    update_fleet_trip: 'fleet',
    delete_fleet_trip: 'fleet',
    start_fleet_trip: 'fleet',
    complete_fleet_trip: 'fleet',
    create_fleet_fuel_log: 'fleet',
    update_fleet_fuel_log: 'fleet',
    delete_fleet_fuel_log: 'fleet',
    create_fleet_service: 'fleet',
    update_fleet_service: 'fleet',
    delete_fleet_service: 'fleet',

    create_financial_report: 'reports',
    generate_financial_report: 'reports',
    export_financial_report: 'reports',
    archive_financial_report: 'reports',
    delete_financial_report: 'reports',
    update_financial_report: 'reports',
    create_report_template: 'reports',
    update_report_template: 'reports',
    delete_report_template: 'reports',
    scheduled_report: 'reports',
    analytics_: 'reports',
    create_dashboard: 'reports',
    update_dashboard: 'reports',
    delete_dashboard: 'reports',
    add_widget_to_dashboard: 'reports',
    update_widget: 'reports',
    delete_widget: 'reports',
    share_dashboard: 'reports',

    iot_: 'iot',
    register_iot_: 'iot',
    update_iot_: 'iot',
    delete_iot_: 'iot',
    link_device: 'iot',
    unlink_device: 'iot',
    telemetry: 'iot',
    iot_action: 'iot',
    iot_alert: 'iot',
    hub: 'iot',
    create_iot_hub: 'iot',
    update_iot_hub: 'iot',
    delete_iot_hub: 'iot',
    create_iot_device: 'iot',
    update_iot_device: 'iot',
    delete_iot_device: 'iot',
    register_iot_device: 'iot',
    unregister_iot_device: 'iot',
    link_iot_device: 'iot',
    unlink_iot_device: 'iot',
    create_iot_telemetry: 'iot',
    create_iot_action: 'iot',
    update_iot_action: 'iot',
    delete_iot_action: 'iot',
    trigger_iot_action: 'iot',
    create_iot_alert: 'iot',
    update_iot_alert: 'iot',
    delete_iot_alert: 'iot',
    acknowledge_iot_alert: 'iot',
    resolve_iot_alert: 'iot',
    claim_hub_with_token: 'iot',
    rotate_iot_device_key: 'iot',

    create_ai_: 'ai',
    update_ai_: 'ai',
    delete_ai_: 'ai',
    dismiss_insight: 'ai',
    ai_spend: 'ai',
    create_ai_insight: 'ai',
    update_ai_insight: 'ai',
    delete_ai_insight: 'ai',
    create_ai_agent: 'ai',
    update_ai_agent: 'ai',
    delete_ai_agent: 'ai',
    train_ai_agent: 'ai',
    activate_ai_agent: 'ai',
    deactivate_ai_agent: 'ai',
    set_ai_agent_active: 'ai',

    form_: 'forms',
    field: 'forms',
    create_form_configuration: 'forms',
    update_form_configuration: 'forms',
    delete_form_configuration: 'forms',
    get_form_configuration: 'forms',
    get_organization_form_configs: 'forms',
    initialize_default_form_configs: 'forms',

    import_: 'imports',
    seed_: 'bootstrap',
    bootstrap_: 'bootstrap',
    ensure_dev_admin: 'bootstrap',
    queue: 'internal',
    casbin: 'auth',
    role: 'auth',
    user_: 'auth',
    org_: 'auth',
    privacy: 'auth',
    audit: 'auth',
    sso: 'auth',
    credential: 'auth',
    invite: 'auth',
    password: 'auth',
  }

  for (const [prefix, module] of Object.entries(prefixMap)) {
    if (reducerName.startsWith(prefix) || reducerName.includes(prefix)) {
      return module
    }
  }

  // Extract from file path if we have it
  return 'uncategorized'
}

function generateReport(
  rustReducers: Set<string>,
  webResult: { reducers: Set<string>; sources: Record<string, Set<string>> },
  matrixRows: ReducerCoverageRow[],
): CoverageReport {
  const webCoveredReducers = new Set(
    matrixRows.filter(hasHookOrUiLayer).map((row) => row.reducer),
  )
  const report: CoverageReport = {
    totalRustReducers: rustReducers.size,
    productRustReducers: 0,
    totalWebReducers: webCoveredReducers.size,
    missingFromWeb: [],
    coverageModel: 'matrix-hook-ui',
    matrixStatusSummary: countRowsBy(matrixRows, 'status'),
    matrixClassificationSummary: countRowsBy(matrixRows, 'classification'),
    byModule: {},
    excludedReducers: {
      count: 0,
      byCategory: {},
    },
    detectionSources: {
      apiCallLiteral: webResult.sources.apiCallLiteral.size,
      useStdbReducer: webResult.sources.useStdbReducer.size,
      useStdbReducerWithInvalidation: webResult.sources.useStdbReducerWithInvalidation.size,
      useStdbCallMutation: webResult.sources.useStdbCallMutation.size,
      callReducerLiteral: webResult.sources.callReducerLiteral.size,
      callReducersBatch: webResult.sources.callReducersBatch.size,
      stdbBrowserCall: webResult.sources.stdbBrowserCall.size,
    },
  }

  // Track excluded reducers by category
  const excludedByCategory: Record<string, string[]> = {}
  const productReducers = new Set<string>()

  for (const name of rustReducers) {
    const exclusion = isExcludedReducer(name)
    if (exclusion.excluded) {
      report.excludedReducers.count++
      if (!excludedByCategory[exclusion.category]) {
        excludedByCategory[exclusion.category] = []
      }
      excludedByCategory[exclusion.category].push(name)
    } else {
      productReducers.add(name)
    }
  }
  report.productRustReducers = productReducers.size
  report.excludedReducers.byCategory = excludedByCategory

  // Initialize modules
  const modules = new Set<string>()
  for (const name of rustReducers) {
    modules.add(categorizeByModule(name))
  }
  for (const mod of modules) {
    report.byModule[mod] = { rust: [], web: [], missing: [], coverage: 0, productReducers: [], productCoverage: 0 }
  }

  // Categorize Rust reducers
  for (const name of rustReducers) {
    const mod = categorizeByModule(name)
    report.byModule[mod].rust.push(name)
    if (productReducers.has(name)) {
      report.byModule[mod].productReducers.push(name)
    }
  }

  // Categorize Web reducers
  for (const name of webCoveredReducers) {
    const mod = categorizeByModule(name)
    if (report.byModule[mod]) {
      report.byModule[mod].web.push(name)
    }
  }

  // Calculate missing and coverage per module
  for (const [mod, data] of Object.entries(report.byModule)) {
    const rustSet = new Set(data.rust)
    const webSet = new Set(data.web)
    data.missing = data.rust.filter((r) => !webSet.has(r))
    data.coverage = data.rust.length > 0 ? Math.round((data.web.length / data.rust.length) * 100) : 0

    // Product coverage (excluding bootstrap/seed/import)
    const productSet = new Set(data.productReducers)
    const webInProduct = data.web.filter((w) => productSet.has(w))
    data.productCoverage = data.productReducers.length > 0
      ? Math.round((webInProduct.length / data.productReducers.length) * 100)
      : 0
  }

  // Overall missing
  report.missingFromWeb = Array.from(rustReducers).filter((r) => !webCoveredReducers.has(r)).sort()

  return report
}

function reducerStatus(
  classification: ReducerClassification,
  hasCommand: boolean,
  hasHook: boolean,
  hasUi: boolean,
  reducerName: string,
): CoverageStatus {
  if (classification === 'deprecated') return 'deprecated'
  if (INTENTIONALLY_API_ONLY_REDUCERS[reducerName]) return 'api-only-intentional'
  if (classification === 'internal/background' || classification === 'dev-only') {
    return 'internal-intentional'
  }
  if (hasUi) return 'reachable-ui'
  if (hasHook) return 'hook-only'
  if (hasCommand) return 'command-only'
  if (classification === 'import' || classification === 'admin') return 'needs-triage'
  return 'backend-only'
}

function routeOrPageFromCaller(caller: string | null): string | null {
  if (!caller) return null
  const appPrefix = 'frontend/web/app/'
  if (!caller.startsWith(appPrefix)) return caller
  const route = caller.slice(appPrefix.length)
  return route.replace(/\/(page|route|[^/]*client)\.(tsx|ts)$/, '')
}

function buildCoverageMatrix(
  rustReducers: Set<string>,
  layerIndex: LayerIndex,
): ReducerCoverageRow[] {
  return Array.from(rustReducers)
    .sort()
    .map((reducer) => {
      const moduleName = categorizeByModule(reducer)
      const classification = classifyReducerByHeuristic(reducer, moduleName)
      const commandWrapper = firstSetValue(layerIndex.commandWrappers.get(reducer))
      const hook = firstSetValue(layerIndex.hooks.get(reducer))
      const uiCaller = firstSetValue(layerIndex.uiCallers.get(reducer))
      const status = reducerStatus(
        classification,
        commandWrapper != null,
        hook != null,
        uiCaller != null,
        reducer,
      )
      const notes =
        INTENTIONALLY_API_ONLY_REDUCERS[reducer] ??
        (status === 'needs-triage' ? 'classification requires explicit UI/API decision' : '')

      return {
        reducer,
        backendFile: layerIndex.backendFiles.get(reducer) ?? null,
        module: moduleName,
        commandWrapper,
        hook,
        uiCaller,
        routeOrPage: routeOrPageFromCaller(uiCaller),
        classification,
        status,
        notes,
      }
    })
}

function markdownCell(value: string | null): string {
  if (!value) return ''
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function generateCoverageMarkdown(rows: ReducerCoverageRow[]): string {
  const generatedAt = new Date().toISOString()
  const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1
    return acc
  }, {})
  const byClassification = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1
    return acc
  }, {})

  const lines = [
    '# Reducer Coverage Matrix',
    '',
    `Generated by \`frontend/web/scripts/track-reducer-coverage.ts\` at ${generatedAt}.`,
    '',
    '## Summary',
    '',
    '| Dimension | Count |',
    '| --- | ---: |',
    ...Object.entries(byStatus)
      .sort()
      .map(([status, count]) => `| status:${status} | ${count} |`),
    ...Object.entries(byClassification)
      .sort()
      .map(([classification, count]) => `| classification:${classification} | ${count} |`),
    '',
    '## Matrix',
    '',
    '| Reducer | Module | Classification | Status | Backend | Command | Hook | UI caller | Route/Page | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]

  for (const row of rows) {
    lines.push(
      [
        row.reducer,
        row.module,
        row.classification,
        row.status,
        row.backendFile,
        row.commandWrapper,
        row.hook,
        row.uiCaller,
        row.routeOrPage,
        row.notes,
      ]
        .map((value) => markdownCell(value))
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    )
  }

  lines.push('')
  return lines.join('\n')
}

function writeCoverageMatrix(rows: ReducerCoverageRow[]): void {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true })
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true })

  const jsonPath = path.join(REPORTS_DIR, 'reducer-coverage.json')
  writeFileSync(jsonPath, JSON.stringify({ rows }, null, 2))
  console.log(`📄 Reducer coverage matrix written to: ${jsonPath}`)

  const markdownPath = path.join(DOCS_DIR, 'reducer-coverage-matrix.md')
  writeFileSync(markdownPath, generateCoverageMarkdown(rows))
  console.log(`📄 Reducer coverage matrix written to: ${markdownPath}`)
}

function assertCoverageMatrix(rows: ReducerCoverageRow[]): void {
  const failures = rows.filter(
    (row) =>
      row.classification === 'user-facing' &&
      row.status !== 'reachable-ui' &&
      row.status !== 'api-only-intentional',
  )
  const untriaged = rows.filter((row) => row.status === 'needs-triage')

  if (failures.length === 0 && untriaged.length === 0) return

  console.error('\nReducer coverage check failed.')
  if (failures.length > 0) {
    console.error(`User-facing reducers without reachable UI/API-only intent: ${failures.length}`)
    for (const row of failures.slice(0, 30)) {
      console.error(`  - ${row.reducer} (${row.module}, ${row.status})`)
    }
  }
  if (untriaged.length > 0) {
    console.error(`Reducers requiring triage: ${untriaged.length}`)
    for (const row of untriaged.slice(0, 30)) {
      console.error(`  - ${row.reducer} (${row.module}, ${row.classification})`)
    }
  }
  process.exitCode = 1
}

function printReport(report: CoverageReport): void {
  console.log('\n=== SpacetimeDB Reducer Coverage Report ===\n')
  console.log(`Total Rust reducers: ${report.totalRustReducers}`)
  console.log(`  └─ Product reducers (excl. bootstrap/seed/import): ${report.productRustReducers}`)
  console.log(`  └─ Excluded reducers (internal): ${report.excludedReducers.count}`)
  console.log(`Total reducers with hook/UI coverage: ${report.totalWebReducers}`)

  const productLayerReducers = Object.values(report.byModule).reduce(
    (count, data) => count + data.web.filter((name) => data.productReducers.includes(name)).length,
    0,
  )
  const rawCoverage = Math.round((report.totalWebReducers / report.totalRustReducers) * 100)
  const productCoverage = Math.round((productLayerReducers / report.productRustReducers) * 100)
  console.log(`\n📊 Coverage (raw): ${rawCoverage}%`)
  console.log(`📊 Coverage (product only, hook/UI): ${productCoverage}%`)
  console.log(`Missing hook/UI coverage: ${report.missingFromWeb.length}`)

  console.log('\n=== Matrix Status Summary ===')
  for (const [status, count] of Object.entries(report.matrixStatusSummary).sort()) {
    console.log(`  status:${status}: ${count}`)
  }

  console.log('\n=== Matrix Classification Summary ===')
  for (const [classification, count] of Object.entries(report.matrixClassificationSummary).sort()) {
    console.log(`  classification:${classification}: ${count}`)
  }

  // Detection sources
  console.log('\n=== Detection Sources ===')
  console.log(`  /api/call literal strings: ${report.detectionSources.apiCallLiteral}`)
  console.log(`  useStdbReducer('...'): ${report.detectionSources.useStdbReducer}`)
  console.log(`  useStdbReducerWithInvalidation('...'): ${report.detectionSources.useStdbReducerWithInvalidation}`)
  console.log(`  useStdbCallMutation('...'): ${report.detectionSources.useStdbCallMutation}`)
  console.log(`  callReducer('...'): ${report.detectionSources.callReducerLiteral}`)
  console.log(`  callReducersBatch entries: ${report.detectionSources.callReducersBatch}`)
  console.log(`  stdbBrowserCall('...'): ${report.detectionSources.stdbBrowserCall}`)

  // Excluded by category
  if (report.excludedReducers.count > 0) {
    console.log('\n=== Excluded Reducers (not required for UI) ===')
    for (const [category, names] of Object.entries(report.excludedReducers.byCategory)) {
      console.log(`  ${category}: ${names.length}`)
      if (names.length <= 5) {
        for (const n of names) {
          console.log(`    - ${n}`)
        }
      }
    }
  }

  console.log('\n=== By Module (Product Coverage) ===\n')
  const sortedModules = Object.entries(report.byModule).sort((a, b) => b[1].productReducers.length - a[1].productReducers.length)

  for (const [mod, data] of sortedModules) {
    if (data.productReducers.length === 0) continue
    const webInProduct = data.web.filter((w) => data.productReducers.includes(w)).length
    const status = data.productCoverage >= 80 ? '✅' : data.productCoverage >= 50 ? '⚠️' : '❌'
    console.log(`${status} ${mod}: ${webInProduct}/${data.productReducers.length} (${data.productCoverage}%) [raw: ${data.web.length}/${data.rust.length}]`)
    const missingProduct = data.missing.filter((m) => data.productReducers.includes(m))
    if (missingProduct.length > 0 && missingProduct.length <= 8) {
      for (const m of missingProduct) {
        console.log(`   - ${m}`)
      }
    } else if (missingProduct.length > 8) {
      console.log(`   - ... ${missingProduct.length} missing`)
    }
  }

  console.log('\n=== Top Missing (UI Priority - Product Only) ===\n')
  const uiPriorityModules = ['projects', 'inventory', 'sales', 'purchasing', 'crm', 'accounting', 'settings']
  for (const mod of uiPriorityModules) {
    const data = report.byModule[mod]
    if (!data) continue
    const missingProduct = data.missing.filter((m) => data.productReducers.includes(m))
    if (missingProduct.length > 0) {
      console.log(`\n${mod.toUpperCase()} (${missingProduct.length} missing):`)
      for (const m of missingProduct.slice(0, 15)) {
        console.log(`  - ${m}`)
      }
      if (missingProduct.length > 15) {
        console.log(`  ... and ${missingProduct.length - 15} more`)
      }
    }
  }
}

function generateReducerNamesTs(rustReducers: Set<string>): string {
  const sortedNames = Array.from(rustReducers).sort()
  const productNames = sortedNames.filter((n) => !isExcludedReducer(n).excluded)

  return `/**
 * Auto-generated reducer names from SpacetimeDB
 *
 * Generated by: scripts/track-reducer-coverage.ts
 * Do not edit manually - will be overwritten on next run
 */

/**
 * All reducer names defined in SpacetimeDB Rust backend.
 * Includes seed, import, bootstrap, and internal reducers.
 */
export const ALL_REDUCER_NAMES = [
${sortedNames.map((n) => `  '${n}',`).join('\n')}
] as const

/**
 * Product-level reducer names (excludes seed/import/bootstrap/internal).
 * These are the reducers that should have UI coverage.
 */
export const PRODUCT_REDUCER_NAMES = [
${productNames.map((n) => `  '${n}',`).join('\n')}
] as const

/**
 * Type for all reducer names
 */
export type ReducerName = typeof ALL_REDUCER_NAMES[number]

/**
 * Type for product reducer names
 */
export type ProductReducerName = typeof PRODUCT_REDUCER_NAMES[number]

/**
 * Check if a string is a valid reducer name
 */
export function isValidReducerName(name: string): name is ReducerName {
  return ALL_REDUCER_NAMES.includes(name as ReducerName)
}

/**
 * Check if a reducer is a product-level reducer (not seed/import/bootstrap)
 */
export function isProductReducer(name: string): boolean {
  return PRODUCT_REDUCER_NAMES.includes(name as ProductReducerName)
}
`
}

function main(): void {
  const checkMode = process.argv.includes('--check')
  console.log('Scanning SpacetimeDB reducers...')
  const rustReducers = extractRustReducers()
  console.log(`Found ${rustReducers.size} reducers in Rust`)

  console.log('Scanning Web reducer usage...')
  const webResult = extractWebReducers()
  mergeWorkspacePackageReducerCalls(webResult)
  console.log(`Found ${webResult.reducers.size} reducer calls in Web + workspace packages`)

  const layerIndex: LayerIndex = {
    backendFiles: extractRustReducerFiles(),
    commandWrappers: extractCommandWrappers(),
    hooks: extractHookWrappers(),
    uiCallers: new Map<string, Set<string>>(),
  }
  layerIndex.uiCallers = extractUiCallers(layerIndex.hooks)
  const matrixRows = buildCoverageMatrix(rustReducers, layerIndex)

  const report = generateReport(rustReducers, webResult, matrixRows)
  printReport(report)

  writeCoverageMatrix(matrixRows)
  if (checkMode) {
    assertCoverageMatrix(matrixRows)
  }

  // Write JSON report for CI
  const reportPath = path.join(__dirname, '..', 'reducer-coverage-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n📄 Report written to: ${reportPath}`)

  // Generate TypeScript reducer names file
  const libDir = path.join(__dirname, '..', 'lib')
  if (!existsSync(libDir)) {
    mkdirSync(libDir, { recursive: true })
  }
  const reducerNamesPath = path.join(libDir, 'reducer-names.ts')
  writeFileSync(reducerNamesPath, generateReducerNamesTs(rustReducers))
  console.log(`📄 Reducer names written to: ${reducerNamesPath}`)
}

main()
