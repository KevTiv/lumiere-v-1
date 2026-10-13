/**
 * Which record pages get the standard Archive / Duplicate actions, and why the others do not.
 * Only commands that already exist in the backend (and have a query hook) are listed: no action
 * is faked. Duplicate never copies silently: it opens the module's create form prefilled with the
 * record's values, and the user reviews and saves.
 */

export type RecordModel =
  | 'documents'
  | 'inventory.transfers'
  | 'subscriptions'
  | 'calendar.events'
  | 'manufacturing.orders'
  | 'purchasing.orders'
  | 'accounting.invoices'
  | 'sales.orders'
  | 'projects'
  | 'fleet.vehicles'
  | 'expenses.reports'
  | 'pos.sessions'
  | 'messages'

export interface ArchiveSpec {
  /** Backend reducer that flips the flag. */
  reducer: string
  /** Boolean column on the row; `false` means the record is archived. */
  activeField: string
}

export interface DuplicateSpec {
  /** Backend reducer the prefilled create form ends up calling. */
  createReducer: string
  /** Appended to the name so the copy does not clash with the original's unique name. */
  nameSuffix: string
}

export interface RecordStandardActions {
  archive?: ArchiveSpec
  duplicate?: DuplicateSpec
  /** Why an action is missing: the exact backend gap, for the next pass. */
  gaps?: { archive?: string; duplicate?: string }
}

export const RECORD_STANDARD_ACTIONS: Record<RecordModel, RecordStandardActions> = {
  projects: {
    archive: { reducer: 'set_project_active', activeField: 'active' },
    // Project names are unique among active projects, hence the suffix.
    duplicate: { createReducer: 'create_project', nameSuffix: ' (copy)' },
  },
  'calendar.events': {
    duplicate: { createReducer: 'create_calendar_event', nameSuffix: ' (copy)' },
    gaps: { archive: 'no archive/active reducer for calendar_event (cancel and delete exist)' },
  },
  'fleet.vehicles': {
    gaps: {
      archive: 'no archive/active reducer for fleet_vehicle',
      duplicate: 'license_plate must stay unique per vehicle, so a copy would clash',
    },
  },
  documents: {
    gaps: {
      archive: 'no archive reducer for documents (only delete_document)',
      duplicate: 'a document carries an uploaded file; no copy reducer exists',
    },
  },
  'inventory.transfers': {
    gaps: { archive: 'no archive reducer for stock transfers', duplicate: 'no copy reducer; transfers have child lines' },
  },
  subscriptions: {
    gaps: {
      archive: 'no archive reducer for subscriptions (cancel_subscription is its own action; deactivate_subscription_plan is for plans)',
      duplicate: 'no copy reducer; subscriptions have child lines',
    },
  },
  'manufacturing.orders': {
    gaps: { archive: 'no archive reducer for manufacturing orders', duplicate: 'no copy reducer; orders have child lines' },
  },
  'purchasing.orders': {
    gaps: { archive: 'no archive reducer for purchase orders', duplicate: 'no copy reducer; orders have child lines' },
  },
  'accounting.invoices': {
    gaps: { archive: 'no archive reducer for invoices (posted moves are reversed, not archived)', duplicate: 'no copy reducer; invoices have child lines' },
  },
  'sales.orders': {
    gaps: { archive: 'no archive reducer for sale orders', duplicate: 'no copy reducer; orders have child lines' },
  },
  'expenses.reports': {
    gaps: { archive: 'no archive reducer for expense reports', duplicate: 'no copy reducer; reports have child lines' },
  },
  'pos.sessions': {
    gaps: { archive: 'no archive reducer for POS sessions', duplicate: 'a session is opened, not copied' },
  },
  messages: {
    gaps: { archive: 'no archive reducer for messages', duplicate: 'a message is not a copyable record' },
  },
}

type Row = Record<string, unknown>

/** `archive` while the record is live, `unarchive` once archived, null when the model has no archive command. */
export function archiveAction(model: RecordModel, row: Row): 'archive' | 'unarchive' | null {
  const spec = RECORD_STANDARD_ACTIONS[model].archive
  if (!spec) return null
  // A missing flag counts as live: only an explicit false is archived.
  return row[spec.activeField] === false ? 'unarchive' : 'archive'
}

/** The flag value to send for an archive / unarchive. */
export function archiveTargetActive(action: 'archive' | 'unarchive'): boolean {
  return action === 'unarchive'
}

/** Name for the copy, or '' when the model cannot be duplicated. */
export function duplicateName(model: RecordModel, name: unknown): string {
  const spec = RECORD_STANDARD_ACTIONS[model].duplicate
  if (!spec) return ''
  return `${String(name ?? '').trim()}${spec.nameSuffix}`
}
