'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useErpSession } from '@lumiere/erp-session'
import { useOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company'
import { ComposedCollectionDetailHost } from '@lumiere/ui/composed/ComposedCollectionDetailHost'
import { Button } from '@lumiere/ui/components/button'
import { decodePreviewOptions, decodePreviewResponse } from '@lumiere/presentation-core/preview-decoder'
import { decodeSavedDraft, decodeSavedDraftList } from '@lumiere/presentation-core/saved-draft-decoder'
import type { ModuleDraft, PageNode } from '@lumiere/presentation-core/module-contract'
import type { PreviewOptions, PreviewRequest, PreviewResponse } from '@lumiere/presentation-core/preview-contract'
import type { SavedDraft, SavedDraftList, SavedDraftSummary } from '@lumiere/presentation-core'
import { createInitialDraft, draftScopeKey, saveRequest, stateAfterConflict, stateAfterSave, stateFromSavedDraft, type DraftEditorState, updateDraft } from './draft-state'

export function PreviewComposer({ organizationId }: { organizationId: number }) {
  const company = useOperatingCompanyBigInt(organizationId)?.toString()
  const { identity } = useErpSession()
  return <Composer organizationId={organizationId} identity={identity} companyId={company} />
}

class ResponseError extends Error {
  constructor(readonly status: number, readonly body: unknown) { super('Presentation request failed') }
}

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ResponseError(response.status, body)
  return body
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }

function savedList(value: unknown): SavedDraftList { return decodeSavedDraftList(value) }

function serverRevision(value: unknown): string | null {
  return isRecord(value) && typeof value.revision === 'string' ? value.revision : null
}

function firstNode(definition: ModuleDraft, kind: PageNode['kind']): PageNode | undefined {
  return definition.pages.flatMap((page) => page.nodes).find((node) => node.kind === kind)
}

function updateNode(definition: ModuleDraft, kind: PageNode['kind'], fields: string[]): ModuleDraft {
  let changed = false
  const pages = definition.pages.map((page) => ({ ...page, nodes: page.nodes.map((node) => {
    if (!changed && node.kind === kind) { changed = true; return { ...node, fields } }
    return node
  }) }))
  return changed ? { ...definition, pages } : definition
}

function fieldsFor(definition: ModuleDraft, kind: PageNode['kind']): string[] {
  const node = firstNode(definition, kind)
  return node && (node.kind === 'collection' || node.kind === 'detail') ? [...node.fields] : []
}

function Composer({ organizationId, identity, companyId }: { organizationId: number; identity: string | null; companyId: string | undefined }) {
  const moduleKey = 'collections-preview'
  const scopeKey = draftScopeKey(organizationId, identity, moduleKey)
  const [options, setOptions] = useState<PreviewOptions | null>(null)
  const [draft, setDraft] = useState<DraftEditorState | null>(null)
  const [savedSummary, setSavedSummary] = useState<SavedDraftSummary | null>(null)
  const [pendingSaved, setPendingSaved] = useState<SavedDraft | null>(null)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ key: string; value: PreviewResponse } | null>(null)
  const [conflict, setConflict] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)
  const scopeRequest = useRef<AbortController | null>(null)
  const saveRequestRef = useRef<AbortController | null>(null)
  const reopenRequestRef = useRef<AbortController | null>(null)
  const scopeKeyRef = useRef(scopeKey)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const key = JSON.stringify([companyId, draft?.definition])

  const loadSavedDraft = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/presentation/drafts/${encodeURIComponent(moduleKey)}`, { signal, cache: 'no-store' })
    const saved = decodeSavedDraft(await readResponse(response))
    if (saved.moduleKey !== moduleKey) throw new Error('Saved draft module key mismatch')
    return saved
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    scopeRequest.current?.abort()
    scopeRequest.current = controller
    activeRequest.current?.abort()
    saveRequestRef.current?.abort()
    reopenRequestRef.current?.abort()
    scopeKeyRef.current = scopeKey
    setOptions(null); setDraft(null); setSavedSummary(null); setPendingSaved(null); setResult(null); setConflict(false); setError(undefined); setSaving(false)
    void Promise.all([
      fetch('/api/presentation/preview', { signal: controller.signal, cache: 'no-store' }).then(readResponse).then(decodePreviewOptions),
      fetch('/api/presentation/drafts', { signal: controller.signal, cache: 'no-store' }).then(readResponse).then(savedList),
    ]).then(async ([previewOptions, list]) => {
      if (controller.signal.aborted) return
      setOptions(previewOptions)
      const summary = list.drafts.find((entry) => entry.moduleKey === moduleKey) ?? null
      setSavedSummary(summary)
      if (summary) {
        const saved = await loadSavedDraft(controller.signal)
        if (!controller.signal.aborted) setDraft(stateFromSavedDraft(saved))
      } else {
        const initial = createInitialDraft(previewOptions.applicationContract)
        const defaults = ['id', 'name', 'state', 'amount_total'].filter((field) => previewOptions.fields.includes(field))
        setDraft({ definition: updateNode(updateNode(initial, 'collection', defaults), 'detail', defaults), revision: null, dirty: false, conflictRevision: null })
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load drafts')
    })
    return () => {
      controller.abort()
      saveRequestRef.current?.abort()
      reopenRequestRef.current?.abort()
    }
  }, [loadSavedDraft, scopeKey])

  useEffect(() => { activeRequest.current?.abort(); setResult(null); setLoading(false) }, [companyId])

  async function reopen() {
    reopenRequestRef.current?.abort()
    const controller = new AbortController()
    reopenRequestRef.current = controller
    const requestScope = scopeKey
    try {
      const saved = await loadSavedDraft(controller.signal)
      if (controller.signal.aborted || scopeKeyRef.current !== requestScope) return
      if (draftRef.current?.dirty) setPendingSaved(saved)
      else setDraft(stateFromSavedDraft(saved))
      setError(undefined)
    } catch (reason: unknown) {
      if (!controller.signal.aborted && scopeKeyRef.current === requestScope) setError(reason instanceof Error ? reason.message : 'Unable to reopen saved draft')
    }
  }

  function editDefinition(next: ModuleDraft) { setDraft((current) => current ? updateDraft(current, next) : current); setConflict(false) }
  function applySavedDraft(saved: SavedDraft) { setDraft(stateFromSavedDraft(saved)); setPendingSaved(null); setConflict(false) }
  function toggle(kind: PageNode['kind'], field: string) {
    if (!draft) return
    const current = fieldsFor(draft.definition, kind)
    const fields = current.includes(field) ? current.filter((value) => value !== field) : [...current, field]
    if (fields.length <= 32) editDefinition(updateNode(draft.definition, kind, fields))
  }

  async function preview() {
    if (!options || !draft || !companyId) return
    activeRequest.current?.abort()
    const controller = new AbortController(); activeRequest.current = controller
    setLoading(true); setError(undefined); setResult(null)
    try {
      const response = await fetch('/api/presentation/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, definition: draft.definition } satisfies PreviewRequest), signal: controller.signal, cache: 'no-store' })
      const value = decodePreviewResponse(await readResponse(response))
      if (!controller.signal.aborted) setResult({ key, value })
    } catch (reason: unknown) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load preview') }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }

  async function save() {
    if (!draft) return
    saveRequestRef.current?.abort()
    const controller = new AbortController()
    saveRequestRef.current = controller
    const requestScope = scopeKey
    const submittedDefinition = draft.definition
    setSaving(true); setError(undefined)
    try {
      const response = await fetch('/api/presentation/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(saveRequest(draft)), signal: controller.signal })
      const saved = decodeSavedDraft(await readResponse(response))
      if (saved.moduleKey !== moduleKey) throw new Error('Saved draft module key mismatch')
      if (controller.signal.aborted || scopeKeyRef.current !== requestScope) return
      setDraft((current) => current ? stateAfterSave(current, saved, submittedDefinition) : current)
      setSavedSummary({ moduleKey: saved.moduleKey, title: saved.definition.title, revision: saved.revision }); setConflict(false)
    } catch (reason: unknown) {
      if (controller.signal.aborted || scopeKeyRef.current !== requestScope) return
      if (reason instanceof ResponseError && reason.status === 409) {
        setDraft((current) => current ? stateAfterConflict(current, serverRevision(reason.body)) : current); setConflict(true)
      } else setError(reason instanceof Error ? reason.message : 'Unable to save draft')
    } finally {
      if (!controller.signal.aborted && scopeKeyRef.current === requestScope) setSaving(false)
    }
  }

  const collectionFields = useMemo(() => fieldsFor(draft?.definition ?? createInitialDraft(''), 'collection'), [draft])
  const detailFields = useMemo(() => fieldsFor(draft?.definition ?? createInitialDraft(''), 'detail'), [draft])
  if (!draft) return <main className="mx-auto max-w-5xl p-6"><p>{error ?? 'Loading saved drafts…'}</p></main>

  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Module preview</h1>
    <p>Choose fields for accounting entries in your active company. Saved definitions are visible only to you in this organization.</p>
    {!companyId ? <p>Select an active company to preview this draft.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {conflict ? <div role="alert" className="space-y-2"><p>This draft changed elsewhere. Your edits are preserved.</p><Button type="button" onClick={() => void reopen()}>Reload saved draft</Button></div> : null}
    {pendingSaved ? <div role="alert" className="space-y-2"><p>A newer saved draft is available.</p><Button type="button" onClick={() => applySavedDraft(pendingSaved)}>Load saved draft</Button><Button type="button" variant="ghost" onClick={() => setPendingSaved(null)}>Keep editing</Button></div> : null}
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void preview() }}>
      <label className="block">Module title<input className="ml-3 rounded border p-2" value={draft.definition.title} maxLength={160} required onChange={(event) => editDefinition({ ...draft.definition, title: event.target.value })} /></label>
      {options ? <div className="grid gap-4 sm:grid-cols-2"><fieldset><legend className="font-semibold">Collection fields</legend>{options.fields.map((field) => <label key={field} className="block"><input type="checkbox" checked={collectionFields.includes(field)} onChange={() => toggle('collection', field)} /> {field.replaceAll('_', ' ')}</label>)}</fieldset><fieldset><legend className="font-semibold">Detail fields</legend>{options.fields.map((field) => <label key={field} className="block"><input type="checkbox" checked={detailFields.includes(field)} onChange={() => toggle('detail', field)} /> {field.replaceAll('_', ' ')}</label>)}</fieldset></div> : null}
      <div className="flex gap-2"><Button type="submit" disabled={!options || !companyId || loading}>Preview module</Button><Button type="button" variant="secondary" disabled={saving || !draft.dirty} onClick={() => void save()}>Save draft</Button>{savedSummary ? <Button type="button" variant="ghost" disabled={saving} onClick={() => void reopen()}>Reopen saved draft</Button> : null}</div>
    </form>
    {result?.key === key ? <h2 className="text-xl font-semibold">{result.value.definition.title}</h2> : null}
    <ComposedCollectionDetailHost preview={result?.key === key ? result.value : null} loading={loading} error={error} />
  </main>
}
