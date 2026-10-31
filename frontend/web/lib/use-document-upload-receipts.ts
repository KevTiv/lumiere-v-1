"use client"

import { useEffect, useRef, useState } from "react"
import type { CreateDocumentParams } from "@lumiere/stdb/types"
import {
  documentReceiptStorageKey, findDocumentSubmission, loadDocumentSubmissionPointers,
  prepareDocumentSubmission, readDocumentUploadReceipt, resumeDocumentSubmission,
  saveDocumentSubmissionPointer, uploadDocumentSubmission,
  type DocumentRegistration, type DocumentSubmissionPointer, type DocumentUploadReceipt,
  type DocumentUploadScope,
} from "./document-upload-receipts"

export interface DocumentReceiptRow {
  pointer: DocumentSubmissionPointer
  receipt?: DocumentUploadReceipt
  error?: string
  busy?: boolean
}

export function useDocumentUploadReceipts(options: {
  scope: DocumentUploadScope
  allowed: boolean
  assertCurrent(): void
  create(params: CreateDocumentParams): Promise<{ resource: string; id: string }>
  index(documentId: string): Promise<unknown>
}) {
  const { scope, allowed } = options
  const scopeKey = documentReceiptStorageKey(scope)
  const current = useRef({ scopeKey, allowed, mounted: true, generation: 0 })
  if (current.current.scopeKey !== scopeKey || current.current.allowed !== allowed) current.current.generation++
  current.current = { ...current.current, scopeKey, allowed }
  useEffect(() => {
    current.current.mounted = true
    return () => { current.current.mounted = false; current.current.generation++ }
  }, [])
  const [state, setState] = useState<{ scopeKey: string; rows: DocumentReceiptRow[]; error?: string }>({ scopeKey, rows: [] })
  const running = useRef(new Set<string>())
  const assertCurrent = () => {
    if (!current.current.mounted || current.current.scopeKey !== scopeKey || !current.current.allowed) throw new Error("Your document workspace or permissions changed. Reopen the current workspace to continue.")
    options.assertCurrent()
  }
  const update = (pointer: DocumentSubmissionPointer, changes: Partial<Omit<DocumentReceiptRow, "pointer">>) => {
    if (!current.current.mounted || current.current.scopeKey !== scopeKey || !current.current.allowed) return
    setState((previous) => {
      const rows = previous.scopeKey === scopeKey ? previous.rows : []
      const found = rows.some((row) => row.pointer.submissionId === pointer.submissionId)
      return { scopeKey, rows: found ? rows.map((row) => row.pointer.submissionId === pointer.submissionId ? { ...row, ...changes } : row) : [...rows, { pointer, ...changes }] }
    })
  }

  useEffect(() => {
    let cancelled = false
    if (!allowed) return
    const load = async () => {
      try {
        const pointers = loadDocumentSubmissionPointers(window.localStorage, scope)
        if (cancelled) return
        setState({ scopeKey, rows: pointers.map((pointer) => ({ pointer, busy: true })) })
        // Bounded concurrency avoids turning a large import into hundreds of
        // simultaneous authenticated requests after a refresh.
        for (let start = 0; start < pointers.length && !cancelled; start += 4) {
          await Promise.all(pointers.slice(start, start + 4).map(async (pointer) => {
            try {
              const receipt = await readDocumentUploadReceipt(scope, pointer)
              if (!cancelled) update(pointer, { receipt: receipt ?? undefined, busy: false })
            } catch (error) {
              if (!cancelled) update(pointer, { error: error instanceof Error ? error.message : "Receipt check failed", busy: false })
            }
          }))
        }
      } catch {
        if (!cancelled) setState({ scopeKey, rows: [], error: "Saved submission receipts could not be opened. Resolve browser storage access before uploading." })
      }
    }
    void load()
    return () => { cancelled = true }
    // Scope strings contain every owner key; effect does not follow UI callbacks.
  }, [scopeKey, allowed])

  const run = async (pointer: DocumentSubmissionPointer, upload?: () => Promise<void>, retryIndexing = false) => {
    assertCurrent()
    const generation = current.current.generation
    const assertRunCurrent = () => {
      assertCurrent()
      if (current.current.generation !== generation) throw new Error("This document submission belongs to an earlier workspace session. Check its saved receipt before continuing.")
    }
    const key = `${scopeKey}:${pointer.submissionId}`
    if (running.current.has(key)) throw new Error("This document submission is already running")
    running.current.add(key)
    update(pointer, { busy: true, error: undefined })
    try {
      if (upload) await upload()
      assertRunCurrent()
      const receipt = await resumeDocumentSubmission({
        assertCurrent: assertRunCurrent,
        read: () => readDocumentUploadReceipt(scope, pointer),
        create: options.create,
        index: options.index,
        changed: (receipt) => update(pointer, { receipt }),
      }, { retryIndexing })
      return receipt
    } catch (error) {
      update(pointer, { error: error instanceof Error ? error.message : "The saved submission could not be checked" })
      throw error
    } finally {
      running.current.delete(key)
      update(pointer, { busy: false })
    }
  }

  return {
    rows: allowed && state.scopeKey === scopeKey ? state.rows : [],
    error: allowed && state.scopeKey === scopeKey ? state.error : undefined,
    resume: (pointer: DocumentSubmissionPointer, retryIndexing = false) => run(pointer, undefined, retryIndexing),
    submit: async (file: File, registration: DocumentRegistration, residency?: string) => {
      assertCurrent()
      const generation = current.current.generation
      const assertSubmissionCurrent = () => {
        assertCurrent()
        if (current.current.generation !== generation) throw new Error("This upload belongs to an earlier workspace session. Reopen its saved receipt to continue.")
      }
      const candidate = await prepareDocumentSubmission(file, registration, residency)
      assertSubmissionCurrent()
      const pointer = findDocumentSubmission(loadDocumentSubmissionPointers(window.localStorage, scope), candidate) ?? candidate
      // Persist the recovery pointer before the first network side effect.
      saveDocumentSubmissionPointer(window.localStorage, scope, pointer)
      return run(pointer, async () => {
        const existing = await readDocumentUploadReceipt(scope, pointer)
        assertSubmissionCurrent()
        if (!existing?.fileSaved) await uploadDocumentSubmission(file, scope, pointer, registration)
      })
    },
  }
}
