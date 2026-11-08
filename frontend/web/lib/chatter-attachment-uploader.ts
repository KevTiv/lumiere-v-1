"use client"

import type { ChatterUploadFn } from "@lumiere/ui/crm-components/chatter-attachments"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useManagedDocumentUpload } from "./use-managed-document-upload"

/** Chatter shares the document receipt; an indexing failure never restarts file creation. */
export function useWebChatterUploader(organizationId: number): ChatterUploadFn | undefined {
  const companyId = useOperatingCompanyBigInt(organizationId) ?? 0n
  const uploads = useManagedDocumentUpload(BigInt(organizationId), companyId)
  if (!uploads.canCreate) return undefined
  return async (file, host) => {
    uploads.assertCurrent("create")
    const receipt = await uploads.submit(file, {
      name: file.name, resModel: host.resModel, resId: String(host.resId),
      tagIds: [], isFavorite: false,
    })
    if (!receipt.documentId) throw new Error("The attachment is saved; check its document receipt to confirm linking.")
    return BigInt(receipt.documentId)
  }
}
