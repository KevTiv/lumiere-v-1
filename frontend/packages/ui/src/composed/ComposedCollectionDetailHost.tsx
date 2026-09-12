"use client"

import { useEffect, useMemo, useState } from "react"
import type { PageNode, PreviewCollection, PreviewResponse } from "@lumiere/presentation-core/preview-contract"
import { Button } from "../components/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table"

export interface ComposedCollectionDetailHostProps {
  preview: PreviewResponse | null
  loading?: boolean
  error?: string
}

type Selection = Readonly<Record<string, string | undefined>>

function selectionKey(pageId: string, nodeId: string): string {
  return `${pageId}:${nodeId}`
}

function collectionFor(collections: readonly PreviewCollection[], pageId: string, nodeId: string) {
  return collections.find((entry) => entry.pageId === pageId && entry.nodeId === nodeId)
}

function fieldsForRow(row: { fields: readonly { field: string; value?: string | null }[] }): ReadonlyMap<string, string | null> {
  return new Map(row.fields.map((field) => [field.field, field.value ?? null]))
}

function nodeFields(node: PageNode): readonly string[] {
  return node.kind === "collection" || node.kind === "detail" ? node.fields : []
}

function nodeTitle(node: PageNode): string {
  return node.kind === "collection" ? "Collection" : "Detail"
}

function CollectionPreview({
  node,
  collection,
  selectedId,
  onSelect,
}: {
  node: Extract<PageNode, { kind: "collection" }>
  collection: PreviewCollection | undefined
  selectedId: string | undefined
  onSelect: (id: string) => void
}) {
  const fields = nodeFields(node)
  return (
    <Card data-testid={`composed-collection-${node.id}`}>
      <CardHeader><CardTitle>{nodeTitle(node)} · {node.id}</CardTitle></CardHeader>
      <CardContent>
        {!collection ? (
          <p className="text-sm text-destructive" data-testid={`composed-unavailable-${node.id}`}>Collection data unavailable.</p>
        ) : collection.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid={`composed-empty-${node.id}`}>No records.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>{fields.map((field) => <TableHead key={field}>{field}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {collection.rows.map((row) => {
                const values = fieldsForRow(row)
                const selected = selectedId === row.id
                return (
                  <TableRow
                    key={row.id}
                    data-testid={`composed-row-${node.id}-${row.id}`}
                    data-state={selected ? "selected" : undefined}
                    tabIndex={0}
                    onClick={() => onSelect(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onSelect(row.id)
                      }
                    }}
                  >
                    {fields.map((field, fieldIndex) => (
                      <TableCell key={field}>
                        {fieldIndex === 0 ? (
                          <Button type="button" variant="ghost" size="sm" className="h-auto px-1" aria-label={`Select ${row.id}`} onClick={() => onSelect(row.id)}>
                            {values.get(field) ?? "—"}
                          </Button>
                        ) : values.get(field) ?? "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {collection?.truncated ? <p className="mt-3 text-sm text-muted-foreground" data-testid={`composed-truncated-${node.id}`}>Preview limit reached. Increase the limit to see more records.</p> : null}
      </CardContent>
    </Card>
  )
}

function DetailPreview({
  node,
  collection,
  selectedId,
}: {
  node: Extract<PageNode, { kind: "detail" }>
  collection: PreviewCollection | undefined
  selectedId: string | undefined
}) {
  const row = collection?.rows.find((entry) => entry.id === selectedId)
  const values = row ? fieldsForRow(row) : null
  return (
    <Card data-testid={`composed-detail-${node.id}`}>
      <CardHeader><CardTitle>{nodeTitle(node)} · {node.id}</CardTitle></CardHeader>
      <CardContent>
        {!values ? <p className="text-sm text-muted-foreground">Select a record to inspect it.</p> : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {node.fields.map((field) => <div key={field}><dt className="text-xs text-muted-foreground">{field}</dt><dd className="text-sm" data-testid={`composed-detail-value-${node.id}-${field}`}>{values.get(field) ?? "—"}</dd></div>)}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

export function ComposedCollectionDetailHost({ preview, loading = false, error }: ComposedCollectionDetailHostProps) {
  const [selection, setSelection] = useState<Selection>({})

  useEffect(() => setSelection({}), [preview])

  const collections = useMemo(() => preview?.collections ?? [], [preview])
  if (loading) return <p data-testid="composed-loading">Loading preview…</p>
  if (error) return <p role="alert" data-testid="composed-error">{error}</p>
  if (!preview) return <p className="text-sm text-muted-foreground" data-testid="composed-empty-preview">No preview available.</p>

  return (
    <div className="space-y-6" data-testid="composed-module-host">
      {preview.definition.pages.map((page) => (
        <section key={page.id} className="space-y-4" data-testid={`composed-page-${page.id}`}>
          <h2 className="text-lg font-semibold">{page.title}</h2>
          {page.nodes.map((node) => {
            const collection = collectionFor(collections, page.id, node.id)
            if (node.kind === "collection") {
              const key = selectionKey(page.id, node.id)
              return <CollectionPreview key={node.id} node={node} collection={collection} selectedId={selection[key]} onSelect={(id) => setSelection((current) => ({ ...current, [key]: id }))} />
            }
            const selectedId = selection[selectionKey(page.id, node.sourceNodeId)]
            return <DetailPreview key={node.id} node={node} collection={collection ?? collectionFor(collections, page.id, node.sourceNodeId)} selectedId={selectedId} />
          })}
        </section>
      ))}
    </div>
  )
}
