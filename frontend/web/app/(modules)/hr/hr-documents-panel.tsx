"use client"

import { useMemo, useState } from "react"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
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
export function HrDocumentsPanel({ organizationId, companyId, employeeId }: HrDocumentsPanelProps) {
  const { t } = useTranslation()
  const { data: documents = [] } = useEmployeeDocuments(organizationId)
  const createDoc = useCreateHrEmployeeDocument(organizationId, companyId)
  const deleteDoc = useDeleteHrEmployeeDocument(organizationId, companyId)
  const [docType, setDocType] = useState("")
  const [attachmentId, setAttachmentId] = useState("")
  const [purpose, setPurpose] = useState<(typeof DOC_PURPOSES)[number]>("general")
  const [title, setTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  const purposeLabels: Record<(typeof DOC_PURPOSES)[number], string> = {
    general: t("hr.documents.purposes.general", { defaultValue: "General" }),
    tax_id: t("hr.documents.purposes.taxId", { defaultValue: "Tax ID" }),
    identity: t("hr.documents.purposes.identity", { defaultValue: "Identity" }),
    payroll: t("hr.documents.purposes.payroll", { defaultValue: "Payroll" }),
  }

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
      setError(e instanceof Error ? e.message : t("hr.documents.actionFailed", { defaultValue: "Action failed" }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">
          {t("hr.documents.attachTitle", {
            defaultValue: "Attach document reference",
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("hr.documents.attachDescription", {
            defaultValue: "Store attachment ID only — upload files via DMS separately.",
          })}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hr-doc-type">{t("hr.documents.typeLabel", { defaultValue: "Document type" })}</Label>
            <Input
              id="hr-doc-type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder={t("hr.documents.typePlaceholder", {
                defaultValue: "passport, contract, …",
              })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr-attachment-id">
              {t("hr.documents.attachmentIdLabel", {
                defaultValue: "Attachment ID",
              })}
            </Label>
            <Input
              id="hr-attachment-id"
              value={attachmentId}
              onChange={(e) => setAttachmentId(e.target.value)}
              placeholder={t("hr.documents.attachmentIdPlaceholder", {
                defaultValue: "DMS attachment ID",
              })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr-doc-purpose">{t("hr.documents.purposeLabel", { defaultValue: "Purpose" })}</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as (typeof DOC_PURPOSES)[number])}>
              <SelectTrigger id="hr-doc-purpose">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_PURPOSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {purposeLabels[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr-doc-title">
              {t("hr.documents.titleOptionalLabel", {
                defaultValue: "Title (optional)",
              })}
            </Label>
            <Input id="hr-doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
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
          {t("hr.documents.attach", { defaultValue: "Attach" })}
        </Button>
      </div>

      <ul className="space-y-2">
        {employeeDocs.length === 0 ? (
          <li className="text-sm text-muted-foreground">
            {t("hr.documents.empty", { defaultValue: "No documents on file." })}
          </li>
        ) : (
          employeeDocs.map((row) => {
            const doc = row as Record<string, unknown>
            const id = rowId(doc)
            return (
              <li key={id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">
                    {String(
                      doc.title ??
                        doc.docType ??
                        doc.doc_type ??
                        t("hr.documents.fallbackTitle", {
                          defaultValue: "Document",
                        }),
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("hr.documents.metadata", {
                      defaultValue: "{{type}} · purpose: {{purpose}} · attachment: {{attachmentId}}",
                      type: String(doc.docType ?? doc.doc_type ?? ""),
                      purpose:
                        purposeLabels[String(doc.purpose ?? "general") as keyof typeof purposeLabels] ??
                        String(doc.purpose ?? "general"),
                      attachmentId: String(doc.attachmentId ?? doc.attachment_id ?? ""),
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleteDoc.isPending}
                  onClick={() => void run(() => deleteDoc.mutateAsync({ employeeId, documentId: id }))}
                >
                  {t("hr.documents.remove", { defaultValue: "Remove" })}
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
