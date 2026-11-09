"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { BillSourceDocuments } from "@lumiere/ui/accounting-components/bill-source-documents"
import { useQuery } from "@tanstack/react-query"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import type { BillSourceDocument } from "@lumiere/ui/lib/bill-source-document-model"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { useRBAC } from "@/lib/rbac-context"
import { useManagedDocumentUpload } from "@/lib/use-managed-document-upload"
import { DocumentUploadReceipts } from "../../../components/document-upload-receipts"
import { DocumentViewerDialog } from "../../../components/document-viewer-dialog"
import { resolveBillDocumentAttempt, uploadBillSourceDocument, type BillDocumentAttempt, type BillDocumentScope } from "@/lib/bill-document-upload"
import { billDocumentAttemptKey, readBillDocumentAttempt, subscribeBillDocumentAttempt, writeBillDocumentAttempt } from "@/lib/bill-document-attempts"

export function BillDocumentIntake(props: BillDocumentScope) {
  const { checkPermission, permissionsReady, currentUser } = useRBAC()
  if (permissionsReady === false || !checkPermission("document", "read").allowed) return <BillSourceDocuments {...props} documents={[]} sourceState={{ status: permissionsReady === false ? "loading" : "denied" }} />
  return <LoadedBillDocumentIntake key={`${props.organizationId}:${props.companyId}:${props.billId}:${currentUser?.id ?? ""}`} {...props} actorId={currentUser?.id} canCreate={Boolean(currentUser?.id) && checkPermission("document", "create").allowed} />
}

function LoadedBillDocumentIntake(props: BillDocumentScope & { canCreate: boolean }) {
  const live = useRef({ mounted: true, allowed: false })
  const documents = useQuery<BillSourceDocument[]>({ queryKey: ["bill-source-documents", String(props.organizationId), String(props.companyId), String(props.billId), props.actorId], queryFn: () => fetchQueryList("/api/query/documents", "Failed to read supplier documents"), staleTime: 0 })
  const activeCompanyId = useOperatingCompanyBigInt(Number(props.organizationId))
  const scopeKey = billDocumentAttemptKey(props, props.actorId ?? "")
  const subscribe = useCallback((listener: () => void) => subscribeBillDocumentAttempt(scopeKey, listener), [scopeKey])
  const snapshot = useCallback(() => readBillDocumentAttempt(scopeKey), [scopeKey])
  const attempt = useSyncExternalStore(subscribe, snapshot, () => undefined)
  const state = moduleQueryState(documents)
  live.current.allowed = props.canCreate && state.status === "ready" && activeCompanyId === props.companyId
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false } }, [])
  const updateAttempt = (next: BillDocumentAttempt) => writeBillDocumentAttempt(scopeKey, next)
  const uploads = useManagedDocumentUpload(props.organizationId, props.companyId, { enabled: state.status === "ready" && activeCompanyId === props.companyId, contextKey: scopeKey })
  const [documentId, setDocumentId] = useState<string | null>(null)
  const receipts = uploads.rows.filter(({ receipt, pointer }) => {
    const target = receipt?.registration ?? pointer.target
    return target?.resModel === "account_move" && target.resId === String(props.billId)
  })

  return <><BillSourceDocuments
    {...props}
    documents={documents.data ?? []}
    sourceState={activeCompanyId !== props.companyId ? { status: "error" } : state}
    uploadState={attempt && { phase: attempt.phase === "attached" ? "idle" : attempt.phase, message: attempt.phase === "attached" ? undefined : attempt.message }}
    onOpen={uploads.canRead ? setDocumentId : undefined}
    onRefresh={() => { void documents.refetch().then((result) => {
      const current = readBillDocumentAttempt(scopeKey)
      if (result.isError || !result.data || current?.phase !== "unknown" || !current.uploaded) return
      const id = resolveBillDocumentAttempt(result.data, props, current.uploaded, current.documentId)
      if (id) updateAttempt({ ...current, phase: "attached", documentId: id, message: undefined })
    }) }}
    onUpload={uploads.canCreate ? async (file) => {
      const current = readBillDocumentAttempt(scopeKey)
      if (current?.phase === "pending" || current?.phase === "unknown") throw new Error("Check the previous attachment attempt before uploading again")
      await uploadBillSourceDocument({ file, scope: props, isCurrent: () => live.current.mounted && live.current.allowed, submit: uploads.submit, readDocuments: async () => {
        const result = await documents.refetch()
        if (result.isError || !result.data) throw new Error("Document readback is unavailable; refresh this bill's documents before uploading again")
        return result.data
      }, onAttempt: updateAttempt })
    } : undefined}
  />
    <DocumentUploadReceipts rows={receipts} error={uploads.error} onResume={async (pointer, retryIndexing) => {
      const receipt = await uploads.resume(pointer, retryIndexing)
      const uploaded = { objectKey: receipt.objectKey, url: receipt.url, checksum: receipt.checksum, fileName: receipt.fileName, fileSize: BigInt(receipt.fileSize), mimetype: receipt.mimetype }
      const result = await documents.refetch()
      const id = result.data && receipt.documentId && !result.isError ? resolveBillDocumentAttempt(result.data, props, uploaded, receipt.documentId) : null
      if (!id) {
        updateAttempt({ phase: "unknown", uploaded, documentId: receipt.documentId ?? undefined, message: "The saved supplier document could not be confirmed on this bill. Refresh its documents." })
        return receipt
      }
      updateAttempt({ phase: "attached", uploaded, documentId: id })
      return receipt
    }} />
    <DocumentViewerDialog organizationId={props.organizationId} documentId={uploads.canRead ? documentId : null} onOpenChange={(open) => { if (!open) setDocumentId(null) }} />
  </>
}
