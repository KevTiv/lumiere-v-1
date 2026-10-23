"use client"

import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { History } from "lucide-react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "../components/button"
import type { FormConfig, FormField } from "../lib/form-types"

/** Local, best-effort copies of unsaved form values. Never a source of truth. */

const DRAFT_PREFIX = "lumiere:form-draft:v1"
export const FORM_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const FORM_DRAFT_DEBOUNCE_MS = 800

const SECRET_NAME = /pass(word|wd|phrase|code)?$|password|secret|token|api[-_]?key|private[-_]?key|credential|cvv|cvc|card[-_]?number|iban|ssn|otp/i

interface StoredDraft {
  savedAt: number
  /** Fingerprint of the values the form opened with; a draft only applies to the same starting point. */
  base: string
  values: Record<string, unknown>
}

/**
 * Storage key for a form draft, scoped to the signed-in identity and
 * organization so a shared browser never offers one user's draft to another.
 */
export function useFormDraftStorageKey(configId: string, draftKey?: string | number | null): string {
  const { identity, organizationId } = useErpSession()
  return formDraftStorageKey(configId, draftKey, identity, organizationId)
}

export function formDraftStorageKey(
  configId: string,
  draftKey: string | number | null | undefined,
  identity: string | null | undefined,
  organizationId: number | null | undefined,
): string {
  const record = draftKey == null || draftKey === "" ? "new" : String(draftKey)
  return [DRAFT_PREFIX, identity || "anon", organizationId ?? "none", configId, record].join(":")
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function clearFormDraft(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Storage may be blocked; there is nothing to clear then.
  }
}

function readDraft(key: string, now = Date.now()): StoredDraft | null {
  try {
    const raw = storage()?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (typeof parsed?.savedAt !== "number" || typeof parsed.base !== "string"
      || !parsed.values || typeof parsed.values !== "object") {
      clearFormDraft(key)
      return null
    }
    if (now - parsed.savedAt > FORM_DRAFT_TTL_MS) {
      clearFormDraft(key)
      return null
    }
    return parsed as StoredDraft
  } catch {
    return null
  }
}

function writeDraft(key: string, draft: StoredDraft): void {
  try {
    storage()?.setItem(key, JSON.stringify(draft))
  } catch {
    // Quota exceeded or storage blocked: drafts are a convenience only.
  }
}

/** Fields whose values may be written to browser storage. */
export function isDraftableField(field: FormField): boolean {
  if (field.type === "file" || field.type === "password" || field.type === "hidden") return false
  return !SECRET_NAME.test(field.name) && !SECRET_NAME.test(field.id)
}

function isJsonSafe(value: unknown): boolean {
  if (value == null) return true
  const kind = typeof value
  if (kind === "string" || kind === "boolean") return true
  if (kind === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonSafe)
  if (kind === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value as Record<string, unknown>).every(isJsonSafe)
  }
  return false
}

function draftableValues(config: FormConfig, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const section of config.sections) {
    for (const field of section.fields) {
      if (!isDraftableField(field) || !(field.name in values)) continue
      const value = values[field.name]
      if (isJsonSafe(value)) out[field.name] = value
    }
  }
  return out
}

function fingerprint(config: FormConfig, values: Record<string, unknown>): string {
  const draftable = draftableValues(config, values)
  return JSON.stringify(Object.keys(draftable).sort().map((name) => [name, draftable[name]]))
}

function formatRelative(savedAt: number, language: string | undefined): string {
  const diffSec = Math.round((savedAt - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  let rtf: Intl.RelativeTimeFormat
  try {
    rtf = new Intl.RelativeTimeFormat(language || "en", { numeric: "auto" })
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  }
  if (abs < 60) return rtf.format(diffSec, "second")
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour")
  return rtf.format(Math.round(diffSec / 86400), "day")
}

interface UseFormDraftOptions {
  enabled: boolean
  config: FormConfig
  draftKey?: string | number | null
  values: Record<string, unknown>
  /** Values the form opened with (read on first render only). */
  initialValues: Record<string, unknown>
  dirty: boolean
  /** Applies restored values on top of the current ones. */
  onRestore: (draftValues: Record<string, unknown>) => void
  /** Puts the form back to the values it opened with. */
  onRevert: () => void
}

/**
 * Debounce-saves dirty form values to localStorage and restores them when the
 * same form reopens from the same starting values.
 */
export function useFormDraft({
  enabled,
  config,
  draftKey,
  values,
  initialValues,
  dirty,
  onRestore,
  onRevert,
}: UseFormDraftOptions): { banner: React.ReactNode; clear: () => void } {
  const { t, i18n } = useTranslation()
  const key = useFormDraftStorageKey(config.id, draftKey)
  const baseRef = useRef<string | null>(null)
  if (baseRef.current === null) baseRef.current = fingerprint(config, initialValues)
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const checkedKeyRef = useRef<string | null>(null)
  const pendingRef = useRef<(() => void) | null>(null)
  // The restored values land one render later; keep the draft until they do.
  const restoringRef = useRef(false)
  const latest = useRef({ dirty, onRestore, values })
  latest.current = { dirty, onRestore, values }

  // Restore before the save effect below can see a clean form and drop the draft.
  useEffect(() => {
    if (!enabled || checkedKeyRef.current === key) return
    checkedKeyRef.current = key
    // The session may resolve after mount; never overwrite edits made meanwhile.
    if (latest.current.dirty) return
    const draft = readDraft(key)
    if (!draft) return
    if (draft.base !== baseRef.current) {
      // The record changed since the draft was taken; never apply it to newer data.
      clearFormDraft(key)
      return
    }
    const restorable = draftableValues(config, draft.values)
    if (fingerprint(config, { ...latest.current.values, ...restorable }) === baseRef.current) {
      clearFormDraft(key)
      return
    }
    restoringRef.current = true
    latest.current.onRestore(restorable)
    setRestoredAt(draft.savedAt)
  }, [enabled, key, config])

  useEffect(() => {
    if (!enabled || checkedKeyRef.current !== key) return
    if (dirty) restoringRef.current = false
    else if (restoringRef.current) return
    if (!dirty) {
      pendingRef.current = null
      clearFormDraft(key)
      return
    }
    const save = () => {
      pendingRef.current = null
      writeDraft(key, { savedAt: Date.now(), base: baseRef.current ?? "", values: draftableValues(config, values) })
    }
    pendingRef.current = save
    const timer = setTimeout(save, FORM_DRAFT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [enabled, key, config, values, dirty])

  // A reload or tab close inside the debounce window still keeps the last edit.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return
    const flush = () => pendingRef.current?.()
    window.addEventListener("pagehide", flush)
    return () => window.removeEventListener("pagehide", flush)
  }, [enabled])

  const clear = useCallback(() => {
    pendingRef.current = null
    restoringRef.current = false
    setRestoredAt(null)
    clearFormDraft(key)
  }, [key])

  const banner = enabled && restoredAt !== null ? (
    <div
      role="status"
      data-testid={`form-draft-banner-${config.id}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
    >
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <History className="h-4 w-4 shrink-0" aria-hidden />
        {t("common.formDraft.restored", {
          time: formatRelative(restoredAt, i18n?.language),
          defaultValue: "Restored unsaved changes from {{time}}",
        })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid={`form-draft-discard-${config.id}`}
        onClick={() => {
          clear()
          onRevert()
        }}
      >
        {t("common.formDraft.discard", { defaultValue: "Discard draft" })}
      </Button>
    </div>
  ) : null

  return { banner, clear }
}
