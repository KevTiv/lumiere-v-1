/**
 * Pure contact normalization primitives shared by CRM duplicate detection
 * and import duplicate detection. Mirrors the Rust `crm/duplicate.rs` field
 * precedence: phone first, mobile fallback when phone is blank.
 */

import type { RowValueMap } from "./row-values"

export function norm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

export function rowId(row: RowValueMap): string {
  return String(row.id ?? "")
}

export function rowEmail(row: RowValueMap): string {
  return norm(row.email ?? row.emailFrom ?? row.email_from)
}

/**
 * Phone normalization with mobile fallback.
 *
 * Tries `phone` / `phoneNumber` / `phone_number` first. If the result is
 * blank, falls back to `mobile`. This matches the Rust `contact_phone`
 * reference in `spacetimedb/src/crm/duplicate.rs`.
 */
export function rowPhone(row: RowValueMap): string {
  const phone = norm(row.phone ?? row.phoneNumber ?? row.phone_number)
  if (phone) return phone
  return norm(row.mobile)
}

export function rowName(row: RowValueMap): string {
  return norm(row.name ?? row.displayName ?? row.display_name)
}
