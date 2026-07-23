/**
 * Shared helpers for Create*Params form mappers.
 */
import { Identity } from "spacetimedb"
import type { Timestamp } from "spacetimedb"

import {
  formValue as field,
  optionalBigIntU64,
  optionalTrimmedString,
  u64IdArrayFromForm,
} from "./form-coercion"
import { stbTimestampFromDate } from "./stb-timestamp"

export { field, optionalBigIntU64, optionalTrimmedString, u64IdArrayFromForm, stbTimestampFromDate }
export type { Timestamp }

export function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function stringArrayFromForm(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean)
  const s = String(raw ?? "").trim()
  if (!s) return []
  return s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
}

export function optionalTimestampFromForm(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
}

export function requiredTimestampFromForm(v: unknown): Timestamp | null {
  return optionalTimestampFromForm(v) ?? null
}

export function optionalIdentityFromForm(v: unknown): Identity | undefined {
  if (v == null || v === "") return undefined
  if (v instanceof Identity) return v
  const s = String(v).trim()
  if (!s) return undefined
  try {
    return Identity.fromString(s)
  } catch {
    return undefined
  }
}

export function requiredIdentityFromForm(v: unknown): Identity | null {
  return optionalIdentityFromForm(v) ?? null
}

export function identityArrayFromForm(raw: unknown): Identity[] {
  if (raw == null || raw === "") return []
  const items = Array.isArray(raw) ? raw : String(raw).split(/[\s,;]+/)
  return items
    .map((x) => optionalIdentityFromForm(x))
    .filter((x): x is Identity => x != null)
}

export function unitEnumFromForm<T extends { tag: string }>(
  raw: unknown,
  allowed: readonly string[],
  fallback: string,
): T {
  const tag = String(raw ?? fallback).trim()
  const resolved = allowed.includes(tag) ? tag : fallback
  return { tag: resolved } as T
}

export function unitEnumArrayFromForm<T extends { tag: string }>(
  raw: unknown,
  allowed: readonly string[],
  fallback: string,
): T[] {
  const items = Array.isArray(raw)
    ? raw
    : String(raw ?? "")
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean)
  if (items.length === 0) return []
  return items.map((item) => unitEnumFromForm<T>(item, allowed, fallback))
}

export function messageChannelArrayFromForm(raw: unknown) {
  return unitEnumArrayFromForm<{ tag: string }>(
    raw,
    ["Sms", "WhatsApp", "Email", "InApp"] as const,
    "Sms",
  )
}

export function objectArrayFromForm(raw: unknown): Record<string, unknown>[] {
  if (raw == null || raw === "") return []
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
}
