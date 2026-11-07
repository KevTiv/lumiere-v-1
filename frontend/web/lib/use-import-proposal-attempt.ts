"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { apiFetch } from "./api-fetch"
import {
  createImportProposalAttempt,
  dispatchImportProposalAttempt,
  ImportWorkflowRequestError,
  parseImportProposalAttempt,
  readImportProposalAttempt,
  type ImportProposal,
  type ImportProposalAttempt,
  type PrepareImportProposal,
  type WorkflowScope,
} from "./import-workflow"

type RetainedPreview = {
  attempt: ImportProposalAttempt
  rejectedStatus?: number
}
const retainedSchema = z
  .object({
    version: z.literal(1),
    attempt: z.unknown(),
    rejectedStatus: z.number().int().min(400).max(499).optional(),
  })
  .strict()
const definitive = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429
const UNKNOWN_PREVIEW =
  "This preview has no confirmed result yet. Check its saved result or retry the same saved preview before changing the source rows or accounting choices."

export function importProposalAttemptStorageKey(
  actor: string,
  scope: WorkflowScope,
): string {
  if (
    !actor ||
    !Number.isSafeInteger(scope.organizationId) ||
    scope.organizationId < 1 ||
    !Number.isSafeInteger(scope.companyId) ||
    scope.companyId < 1 ||
    !/^[a-f0-9]{32}$/.test(scope.taskId)
  ) {
    throw new Error(
      "Select the original company and saved task before recovering a preview.",
    )
  }
  return `lumiere:import-preview:v1:${JSON.stringify([actor, scope.organizationId, scope.companyId, scope.taskId])}`
}

function readRetained(key: string): RetainedPreview | null {
  const raw = window.localStorage.getItem(key)
  if (!raw) return null
  const value = retainedSchema.parse(JSON.parse(raw))
  if (value.rejectedStatus !== undefined && !definitive(value.rejectedStatus))
    throw new Error("The saved preview rejection could not be verified.")
  return {
    attempt: parseImportProposalAttempt(value.attempt),
    rejectedStatus: value.rejectedStatus,
  }
}

/** Retain the exact preview intent before dispatch. Lists and source edits never replace it. */
export function useImportProposalAttempt({
  actor,
  scope: selectedScope,
  onAccepted,
}: {
  actor: string
  scope: WorkflowScope
  onAccepted: (proposal: ImportProposal) => void
}) {
  const scope = useMemo(
    () => ({
      organizationId: selectedScope.organizationId,
      companyId: selectedScope.companyId,
      taskId: selectedScope.taskId,
    }),
    [
      selectedScope.organizationId,
      selectedScope.companyId,
      selectedScope.taskId,
    ],
  )
  const key = importProposalAttemptStorageKey(actor, scope)
  const currentScope = useRef({ key, epoch: 0 })
  if (currentScope.current.key !== key)
    currentScope.current = { key, epoch: currentScope.current.epoch + 1 }
  const epoch = currentScope.current.epoch
  const mounted = useRef(false)
  const sequence = useRef(0)
  const running = useRef<number | null>(null)
  const onAcceptedRef = useRef(onAccepted)
  onAcceptedRef.current = onAccepted
  const [state, setState] = useState<{
    key: string
    epoch: number
    ready: boolean
    busy: boolean
    retained: RetainedPreview | null
    error: string | null
  }>({ key, epoch, ready: false, busy: false, retained: null, error: null })
  const isCurrent = useCallback(
    () =>
      mounted.current &&
      currentScope.current.key === key &&
      currentScope.current.epoch === epoch,
    [key, epoch],
  )
  const write = useCallback(
    (retained: RetainedPreview) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ version: 1, ...retained }),
      )
      setState((previous) => ({
        ...previous,
        key,
        epoch,
        ready: true,
        retained,
      }))
    },
    [key, epoch],
  )
  const retire = useCallback(
    (retained: RetainedPreview) => {
      const current = readRetained(key)
      if (current && current.attempt.requestKey !== retained.attempt.requestKey)
        throw new Error(
          "Another saved preview is awaiting a result. Check it before changing this task.",
        )
      window.localStorage.removeItem(key)
      setState((previous) => ({
        ...previous,
        key,
        epoch,
        ready: true,
        retained: null,
      }))
    },
    [key, epoch],
  )

  const operate = useCallback(
    async (mode: "check" | "retry" | "new", input?: PrepareImportProposal) => {
      if (!isCurrent() || running.current !== null) return
      const operation = ++sequence.current
      running.current = operation
      const current = () => isCurrent() && running.current === operation
      setState((previous) => ({
        ...previous,
        key,
        epoch,
        busy: true,
        error: null,
      }))
      try {
        let retained = readRetained(key)
        if (mode === "new") {
          if (retained) throw new Error(UNKNOWN_PREVIEW)
          if (!input)
            throw new Error(
              "Choose the source rows and accounting treatment first.",
            )
          const attempt = await createImportProposalAttempt(scope, input)
          if (!current()) return
          // Another tab may have submitted while the canonical request was hashed.
          if (readRetained(key)) throw new Error(UNKNOWN_PREVIEW)
          retained = { attempt }
          write(retained)
        }
        if (!retained) {
          if (current())
            setState({
              key,
              epoch,
              ready: true,
              busy: false,
              retained: null,
              error: null,
            })
          return
        }
        setState((previous) => ({
          ...previous,
          key,
          epoch,
          ready: true,
          retained,
        }))
        if (mode !== "check") {
          retained = { attempt: retained.attempt }
          write(retained)
          try {
            const proposal = await dispatchImportProposalAttempt(
              apiFetch,
              scope,
              retained.attempt,
            )
            if (!current()) return
            retire(retained)
            onAcceptedRef.current(proposal)
            return
          } catch (failure) {
            if (!current()) return
            if (
              failure instanceof ImportWorkflowRequestError &&
              definitive(failure.status)
            ) {
              retained = { ...retained, rejectedStatus: failure.status }
              write(retained)
            }
            // A lost response never causes another POST. Re-read this exact key.
          }
        }
        const proposal = await readImportProposalAttempt(
          apiFetch,
          scope,
          retained.attempt.requestKey,
        )
        if (!current()) return
        if (proposal) {
          retire(retained)
          onAcceptedRef.current(proposal)
        } else if (retained.rejectedStatus !== undefined) {
          retire(retained)
          setState((previous) => ({
            ...previous,
            error:
              "The preview request was rejected and its exact absence was confirmed. Review the source rows and accounting choices before trying again.",
          }))
        } else {
          setState((previous) => ({ ...previous, error: UNKNOWN_PREVIEW }))
        }
      } catch (failure) {
        if (current()) {
          // Keep invalid or unavailable storage locked: its absence was not established.
          let retained: RetainedPreview | null = null
          let ready = false
          try {
            retained = readRetained(key)
            ready = true
          } catch {
            /* require a successful check */
          }
          setState({
            key,
            epoch,
            ready,
            busy: false,
            retained,
            error: failure instanceof Error ? failure.message : UNKNOWN_PREVIEW,
          })
        }
      } finally {
        if (current()) {
          running.current = null
          setState((previous) => ({ ...previous, busy: false }))
        }
      }
    },
    [scope, key, epoch, isCurrent, write, retire],
  )

  useEffect(() => {
    mounted.current = true
    // A scope change can start a new read, while a previous scope's promise is ignored.
    running.current = null
    void operate("check")
    return () => {
      mounted.current = false
    }
  }, [operate])

  const visible = state.key === key && state.epoch === epoch ? state : null
  return {
    pending: visible?.retained?.attempt ?? null,
    ready: visible?.ready ?? false,
    busy: visible?.busy ?? true,
    error: visible?.error ?? null,
    submit: (input: PrepareImportProposal) => operate("new", input),
    retry: () => operate("retry"),
    check: () => operate("check"),
  }
}
