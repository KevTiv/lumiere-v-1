"use client"

import { useMemo, useState } from "react"

import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import type { QueryRows } from "@lumiere/query-hooks/http"
import {
  useCreateHrEmployeeDocument,
  useDeleteHrEmployeeDocument,
  useEmployeeDocuments,
} from "@lumiere/query-hooks/hooks/hr"

const DOC_PURPOSES = ["general", "tax_id", "identity", "payroll"] as const

function rowId(row: Record<string, unknown>): number {
  return Number(row.id ?? row.Id ?? 0)
}

function rowNum(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const v = row[key]
    if (v != null && v !== "") return Number(v)
  }
  return 0
}

interface HrDocumentsPanelProps {
  organizationId: bigint
  companyId: bigint
  employeeId: number
}

/** Employee record sheet tab — document vault metadata + attachment refs. */
export function HrDocumentsPanel({
  organizationId,
  companyId,
  employeeId,
}: HrDocumentsPanelProps) {
  const { data: documents = [] } = useEmployeeDocuments(organizationId)
  const createDoc = useCreateHrEmployeeDocument(organizationId, companyId)
  const deleteDoc = useDeleteHrEmployeeDocument(organizationId, companyId)
  const [docType, setDocType] = useState("")
  const [attachmentId, setAttachmentId] = useState("")
  const [purpose, setPurpose] = useState<(typeof DOC_PURPOSES)[number]>("general")
  const [title, setTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  const employeeDocs = useMemo(
    () =>
      (documents as QueryRows).filter(
        (row) => rowNum(row as Record<string, unknown>, "employeeId", "employee_id") === employeeId,
      ),
    [documents, employeeId],
  )

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Attach document reference</p>
        <p className="text-xs text-muted-foreground">
          Store attachment ID only — upload files via DMS separately.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hr-doc-type">Document type</Label>
            <Input
              id="hr-doc-type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder="passport, contract, …"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr-attachment-id">Attachment ID</Label>
            <Input
              id="hr-attachment-id"
              value={attachmentId}
              onChange={(e) => setAttachmentId(e.target.value)}
              placeholder="DMS attachment id"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr-doc-purpose">Purpose</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as (typeof DOC_PURPOSES)[number])}>
              <SelectTrigger id="hr-doc-purpose">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_PURPOSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr-doc-title">Title (optional)</Label>
            <Input
              id="hr-doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </div>
        <Button
          size="sm"
          disabled={!docType.trim() || !attachmentId.trim() || createDoc.isPending}
          onClick={() =>
            void run(async () => {
              await createDoc.mutateAsync({
                employeeId,
                docType: docType.trim(),
                attachmentId: attachmentId.trim(),
                purpose,
                title: title.trim() || undefined,
              })
              setDocType("")
              setAttachmentId("")
              setTitle("")
            })
          }
        >
          Attach
        </Button>
      </div>

      <ul className="space-y-2">
        {employeeDocs.length === 0 ? (
          <li className="text-sm text-muted-foreground">No documents on file.</li>
        ) : (
          employeeDocs.map((row) => {
            const doc = row as Record<string, unknown>
            const id = rowId(doc)
            return (
              <li
                key={id}
                className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {String(doc.title ?? doc.docType ?? doc.doc_type ?? "Document")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {String(doc.docType ?? doc.doc_type ?? "")} · purpose:{" "}
                    {String(doc.purpose ?? "general")} · attachment:{" "}
                    {String(doc.attachmentId ?? doc.attachment_id ?? "")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleteDoc.isPending}
                  onClick={() =>
                    void run(() => deleteDoc.mutateAsync({ employeeId, documentId: id }))
                  }
                >
                  Remove
                </Button>
              </li>
            )
          })
        )}
      </ul>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
