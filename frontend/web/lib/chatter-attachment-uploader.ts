"use client"

import { useCallback } from "react"
import type { ChatterUploadFn } from "@lumiere/ui"
import {
  useCreateDocumentWithRef,
  useIngestDocumentEvidence,
} from "@lumiere/query-hooks/hooks/documents"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { uploadDocumentBlob } from "@/lib/document-blob-upload"

/**
 * Chatter file upload: the same blob upload + `create_document` + evidence ingest that
 * RecordDocumentAttachments performs, resolving the created document's id.
 */
export function useWebChatterUploader(organizationId: number): ChatterUploadFn | undefined {
  const org = BigInt(organizationId)
  const companyId = useOperatingCompanyBigInt(organizationId) ?? 0n
  const createDocument = useCreateDocumentWithRef(org, companyId)
  const ingest = useIngestDocumentEvidence(org)
  const createAsync = createDocument.mutateAsync
  const ingestAsync = ingest.mutateAsync

  return useCallback<ChatterUploadFn>(
    async (file, host) => {
      const uploaded = await uploadDocumentBlob({ file, companyId })
      const ref = await createAsync({
        name: file.name,
        description: undefined,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimetype: uploaded.mimetype,
        url: uploaded.url,
        checksum: uploaded.checksum,
        folderId: undefined,
        resModel: host.resModel,
        resId: host.resId,
        partnerId: undefined,
        tagIds: [],
        isFavorite: false,
        classificationId: undefined,
        retentionDays: undefined,
        fiscalKind: undefined,
        residencyRegion: undefined,
        metadata: undefined,
      })
      await ingestAsync({ companyId, objectKey: uploaded.objectKey })
      return BigInt(ref.id)
    },
    [companyId, createAsync, ingestAsync],
  )
}
