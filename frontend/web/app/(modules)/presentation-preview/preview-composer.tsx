'use client'

import { useEffect, useRef, useState } from 'react'
import { useOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company'
import { ComposedCollectionDetailHost } from '@lumiere/ui/composed/ComposedCollectionDetailHost'
import { Button } from '@lumiere/ui/components/button'
import { decodePreviewOptions, decodePreviewResponse } from '@lumiere/presentation-core/preview-decoder'
import type { PreviewOptions, PreviewRequest, PreviewResponse } from '@lumiere/presentation-core/preview-contract'

export function PreviewComposer({ organizationId }: { organizationId: number }) {
  const company = useOperatingCompanyBigInt(organizationId)?.toString()
  if (!company) return <p>Select an active company to preview a module.</p>
  return <Composer key={`${organizationId}:${company}`} companyId={company} />
}

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : 'Unable to load preview'
    throw new Error(message)
  }
  return body
}

function Composer({ companyId }: { companyId: string }) {
  const [options, setOptions] = useState<PreviewOptions | null>(null)
  const [title, setTitle] = useState('Collections preview')
  const [fields, setFields] = useState<string[]>([])
  const [detailFields, setDetailFields] = useState<string[]>([])
  const [limit, setLimit] = useState(25)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ key: string; value: PreviewResponse } | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const key = JSON.stringify([companyId, title, fields, detailFields, limit])

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/presentation/preview', { signal: controller.signal, cache: 'no-store' })
      .then(readResponse).then(decodePreviewOptions).then((value) => {
        if (controller.signal.aborted) return
        setOptions(value)
        const initial = ['id', 'name', 'state', 'amount_total'].filter((field) => value.fields.includes(field))
        setFields(initial)
        setDetailFields(initial)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load fields')
      })
    return () => { controller.abort(); activeRequest.current?.abort() }
  }, [])

  async function preview() {
    if (!options) return
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setLoading(true)
    setError(undefined)
    setResult(null)
    const request: PreviewRequest = {
      companyId,
      definition: {
        schemaVersion: 1, moduleId: 'collections-preview', title,
        applicationContract: options.applicationContract, componentCatalogVersion: 1,
        pages: [{ id: 'entries', title: 'Accounting entries', nodes: [
          { kind: 'collection', id: 'entries', slot: 'primary', component: { id: 'erp.collection', version: 1 }, resource: 'account-moves', fields, pageSize: limit },
          { kind: 'detail', id: 'entry-detail', slot: 'secondary', component: { id: 'erp.detail', version: 1 }, sourceNodeId: 'entries', fields: detailFields },
        ] }],
      },
    }
    try {
      const response = await fetch('/api/presentation/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal, cache: 'no-store' })
      const value = decodePreviewResponse(await readResponse(response))
      if (!controller.signal.aborted) setResult({ key, value })
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load preview')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  function toggle(field: string, selected: string[], update: (value: string[]) => void) {
    if (!selected.includes(field) && selected.length >= 32) {
      setError('Choose up to 32 fields per view.')
      return
    }
    setError(undefined)
    update(selected.includes(field) ? selected.filter((value) => value !== field) : [...selected, field])
  }

  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Module preview</h1>
    <p>Choose fields for accounting entries in your active company. Preview changes are not saved.</p>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void preview() }}>
      <label className="block">Module title<input className="ml-3 rounded border p-2" value={title} maxLength={160} required onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="block">Preview limit<input className="ml-3 w-24 rounded border p-2" type="number" min={1} max={100} required value={limit} onChange={(event) => setLimit(Number(event.target.value))} /></label>
      {options ? <div className="grid gap-4 sm:grid-cols-2">
        <fieldset><legend className="font-semibold">Collection fields</legend>{options.fields.map((field) => <label key={field} className="block"><input type="checkbox" checked={fields.includes(field)} onChange={() => toggle(field, fields, setFields)} /> {field.replaceAll('_', ' ')}</label>)}</fieldset>
        <fieldset><legend className="font-semibold">Detail fields</legend>{options.fields.map((field) => <label key={field} className="block"><input type="checkbox" checked={detailFields.includes(field)} onChange={() => toggle(field, detailFields, setDetailFields)} /> {field.replaceAll('_', ' ')}</label>)}</fieldset>
      </div> : <p>{error ? 'Available fields could not be loaded. Reload this page to retry.' : 'Loading available fields…'}</p>}
      <Button type="submit" disabled={!options || loading || fields.length === 0}>Preview module</Button>
    </form>
    {result?.key === key ? <h2 className="text-xl font-semibold">{result.value.definition.title}</h2> : null}
    <ComposedCollectionDetailHost preview={result?.key === key ? result.value : null} loading={loading} error={error} />
  </main>
}
