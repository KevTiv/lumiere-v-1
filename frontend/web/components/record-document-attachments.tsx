"use client"

import { RecordAttachmentsPanel } from "@lumiere/ui"
import {
  useCreateDocument,
  useDocuments,
} from "@lumiere/query-hooks/hooks/documents"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  firstFileFromFormValue,
  uploadDocumentBlob,
} from "@/lib/document-blob-upload"

type Props = {
  organizationId: bigint
  resModel: string
  resId: bigint | number
  title?: string
}

/**
 * Upload + list DMS attachments for an ERP record (`res_model` / `res_id`).
 */
export function RecordDocumentAttachments({
  organizationId,
  resModel,
  resId,
  title,
}: Props) {
  const companyId = useOperatingCompanyBigInt(Number(organizationId)) ?? 0n
  const { data: documents = [] } = useDocuments(organizationId)
  const createDocument = useCreateDocument(organizationId, companyId)

  return (
    <RecordAttachmentsPanel
      title={title}
      resModel={resModel}
      resId={resId}
      documents={documents as never[]}
      disabled={createDocument.isPending}
      onUpload={async (file, meta) => {
        const uploaded = await uploadDocumentBlob({
          file,
          companyId,
        })
        await createDocument.mutateAsync({
          name: meta.name,
          description: undefined,
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          mimetype: uploaded.mimetype,
          url: uploaded.url,
          checksum: uploaded.checksum,
          folderId: undefined,
          resModel,
          resId: BigInt(resId),
          partnerId: undefined,
          tagIds: [],
          isFavorite: false,
          indexContent: undefined,
          classificationId: undefined,
          retentionDays: undefined,
          fiscalKind: undefined,
          residencyRegion: undefined,
          metadata: undefined,
        })
      }}
    />
  )
}

/** Re-export for callers that already hold a FileList from forms. */
export { firstFileFromFormValue, uploadDocumentBlob }
