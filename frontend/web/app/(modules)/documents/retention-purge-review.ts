"use client"

import { useEffect, useRef } from "react"
import { assertRetentionPreviewUnchanged, type RetentionPreview } from "@lumiere/query-hooks/hooks/document-retention-preview"

/** Every actor/company or admission transition expires the previous destructive intent. */
export function useRetentionPurgeAuthority(scopeKey: string, immediate: boolean, scheduled: boolean, scopeChangedMessage: string) {
  const live = useRef({ scopeKey, immediate, scheduled, mounted: false })
  if (live.current.scopeKey !== scopeKey || live.current.immediate !== immediate || live.current.scheduled !== scheduled) {
    live.current = { scopeKey, immediate, scheduled, mounted: false }
  }
  const lifetime = live.current
  useEffect(() => {
    lifetime.mounted = true
    return () => { lifetime.mounted = false }
  }, [lifetime])

  const mayDispatch = (delaySeconds: number) => live.current === lifetime && lifetime.mounted &&
    (delaySeconds === 0 ? lifetime.immediate : lifetime.scheduled)
  return {
    mayDispatch,
    assertCurrent(delaySeconds: number) {
      if (!mayDispatch(delaySeconds)) throw new Error(scopeChangedMessage)
    },
  }
}

/** The preview, confirmation and final read must belong to one mounted scope lifetime. */
export async function reviewRetentionPurgeScope(
  authority: ReturnType<typeof useRetentionPurgeAuthority>,
  delaySeconds: number,
  options: {
    read: () => Promise<RetentionPreview>
    validate: (preview: RetentionPreview) => void
    confirm: (preview: RetentionPreview) => Promise<boolean>
  },
): Promise<RetentionPreview | null> {
  authority.assertCurrent(delaySeconds)
  const preview = await options.read()
  authority.assertCurrent(delaySeconds)
  options.validate(preview)
  const accepted = await options.confirm(preview)
  authority.assertCurrent(delaySeconds)
  if (!accepted) return null
  const current = await options.read()
  authority.assertCurrent(delaySeconds)
  assertRetentionPreviewUnchanged(preview, current)
  return current
}
