"use client"

import { useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { RecordAttachmentsPanel } from "@lumiere/ui/documents/record-attachments-panel"
import { useDocuments } from "@lumiere/query-hooks/hooks/documents"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useManagedDocumentUpload } from "../lib/use-managed-document-upload"
import { DocumentUploadReceipts } from "./document-upload-receipts"
import { DocumentViewerDialog } from "./document-viewer-dialog"

type Props = {
  organizationId: bigint
  resModel: string
  resId: bigint | number
  title?: string
}

/** Both file creation and ERP linking belong to one recoverable document submission. */
export function RecordDocumentAttachments(props: Props) {
  const companyId = useOperatingCompanyBigInt(Number(props.organizationId)) ?? 0n
  const session = useErpSession()
  return <ScopedRecordDocumentAttachments key={JSON.stringify([String(props.organizationId), String(companyId), session.identity, props.resModel, String(props.resId)])} {...props} companyId={companyId} />
}

function ScopedRecordDocumentAttachments({ organizationId, companyId, resModel, resId, title }: Props & { companyId: bigint }) {
  const { t } = useTranslation()
  const documents = useDocuments(organizationId)
  const uploads = useManagedDocumentUpload(organizationId, companyId, {
    enabled: documents.isSuccess && !documents.isError,
    contextKey: `${resModel}:${resId}`,
  })
  const [documentId, setDocumentId] = useState<string | null>(null)
  const receipts = uploads.rows.filter(({ receipt, pointer }) => {
    const target = receipt?.registration ?? pointer.target
    return target?.resModel === resModel && target.resId === String(resId)
  })
  return <>
    {documents.isError ? <p role="alert" className="text-sm text-destructive">{t("documents.attachments.readFailed", { defaultValue: "Attachments could not be loaded. Refresh before uploading." })}</p> : null}
    <RecordAttachmentsPanel
      title={title}
      resModel={resModel}
      resId={resId}
      documents={uploads.canRead ? (documents.data ?? []).map((document) => ({
        id: document.id, name: document.name, fileName: document.fileName,
        mimetype: document.mimetype, resModel: document.resModel,
        resId: document.resId, isDeleted: document.isDeleted,
      })) : []}
      disabled={!uploads.canCreate || uploads.pending}
      onOpen={uploads.canRead ? setDocumentId : undefined}
      onUpload={async (file, meta) => {
        uploads.assertCurrent("create")
        await uploads.submit(file, {
          name: meta.name, resModel, resId: String(resId), tagIds: [], isFavorite: false,
        })
      }}
    />
    <DocumentUploadReceipts rows={receipts} error={uploads.error} onResume={uploads.resume} />
    <DocumentViewerDialog organizationId={organizationId} documentId={uploads.canRead ? documentId : null} onOpenChange={(open) => { if (!open) setDocumentId(null) }} />
  </>
}

/** Re-export for callers that already hold a FileList from forms. */
export { firstFileFromFormValue, uploadDocumentBlob } from "../lib/document-blob-upload"
