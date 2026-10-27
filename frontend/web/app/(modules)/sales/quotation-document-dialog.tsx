"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Download, FileText, LoaderCircle } from "lucide-react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useDocumentTemplates } from "@lumiere/query-hooks/hooks/templates"
import {
  downloadQuotationDocument,
  generateQuotationDocument,
  previewQuotationDocument,
  type GeneratedQuotationDocument,
  type QuotationDocumentPreview,
} from "@lumiere/query-hooks/hooks/quotations"
import { Button } from "@lumiere/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@lumiere/ui/components/dialog"
import { Label } from "@lumiere/ui/components/label"
import { readDocumentDesignerMetadata } from "@lumiere/ui/lib/document-template-designer"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"

interface QuotationDocumentDialogProps {
  organizationId: number
  companyId: number
  identity: string
  orderId: string
  onClose: () => void
}

export function QuotationDocumentDialog({ organizationId, companyId, identity, orderId, onClose }: QuotationDocumentDialogProps) {
  const { t } = useTranslation()
  const session = useErpSession()
  const { checkPermission, currentUser, permissionsReady } = useRBAC()
  const queryClient = useQueryClient()
  const inScope = session.identity === identity && session.organizationId === organizationId &&
    session.activeCompanyReady === true && session.activeCompanyId === companyId &&
    session.companyIds?.includes(companyId) === true
  const readable = inScope && permissionsReady === true && currentUser?.id === identity &&
    checkPermission("document_template", "read").allowed && checkPermission("sale_order", "read").allowed
  const writable = readable && checkPermission("document", "create").allowed && checkPermission("document", "read").allowed
  const liveScope = useRef({ readable, writable })
  liveScope.current = { readable, writable }
  const templatesQuery = useDocumentTemplates(organizationId, readable, { identity, companyId })
  const templatesLoading = templatesQuery.isLoading || (templatesQuery.isPending && templatesQuery.data === undefined)
  const layouts = useMemo(() => (!readable || templatesQuery.isError ? [] : templatesQuery.data ?? []).filter((row) => {
    if ((row.isActive ?? row.is_active) !== true ||
      (row.reportType ?? row.report_type) !== "lumiere-document-layout-v1") return false
    try { return readDocumentDesignerMetadata(row.metadata)?.kind === "document" } catch { return false }
  }), [templatesQuery.data, templatesQuery.isError, readable])
  const [templateId, setTemplateId] = useState("")
  const [preview, setPreview] = useState<QuotationDocumentPreview | null>(null)
  const [output, setOutput] = useState<GeneratedQuotationDocument | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewRequest = useRef<AbortController | null>(null)
  const downloadRequest = useRef<AbortController | null>(null)
  const submitLock = useRef(false)
  const selectedLayout = layouts.find((row) => String(row.id) === templateId)
  const readyPreview = preview?.templateId === templateId && selectedLayout !== undefined ? preview : null

  useEffect(() => {
    liveScope.current = { readable, writable }
    return () => {
      liveScope.current = { readable: false, writable: false }
      previewRequest.current?.abort()
      downloadRequest.current?.abort()
    }
  }, [readable, writable])
  useEffect(() => { if (!readable) { previewRequest.current?.abort(); onClose() } }, [readable, onClose])

  const changeLayout = (value: string) => {
    previewRequest.current?.abort()
    setPreviewing(false)
    setTemplateId(value)
    setPreview(null)
    setOutput(null)
    setError(null)
  }

  const loadPreview = async () => {
    if (!liveScope.current.readable || !selectedLayout || submitLock.current) return
    previewRequest.current?.abort()
    const controller = new AbortController()
    previewRequest.current = controller
    setPreviewing(true)
    setPreview(null)
    setOutput(null)
    setError(null)
    try {
      const result = await previewQuotationDocument({ organizationId, companyId: String(companyId), orderId, templateId }, controller.signal)
      if (!controller.signal.aborted && liveScope.current.readable) setPreview(result)
    } catch (cause) {
      if (!controller.signal.aborted && liveScope.current.readable) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!controller.signal.aborted) setPreviewing(false)
    }
  }

  const generate = async () => {
    if (!liveScope.current.writable || !readyPreview || submitLock.current || output) return
    submitLock.current = true
    setGenerating(true)
    setError(null)
    try {
      const result = await generateQuotationDocument({ organizationId, companyId: String(companyId), orderId, templateId }, readyPreview.revision)
      if (!liveScope.current.writable) return
      setOutput(result)
      void queryClient.invalidateQueries({ queryKey: ["documents"] })
    } catch (cause) {
      if (liveScope.current.writable) {
        setError(`${t("sales.quotationDocument.generationError")} ${cause instanceof Error ? cause.message : String(cause)}`)
        setPreview(null)
      }
    } finally {
      submitLock.current = false
      setGenerating(false)
    }
  }

  const download = async () => {
    if (!liveScope.current.readable || !output || downloading) return
    setDownloading(true)
    setError(null)
    const controller = new AbortController()
    downloadRequest.current = controller
    try { await downloadQuotationDocument(output, organizationId, controller.signal) }
    catch (cause) { if (liveScope.current.readable) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setDownloading(false) }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitLock.current) onClose() }}>
      <DialogContent className="flex h-[94dvh] max-w-[min(96vw,1280px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1280px)]" data-testid="quotation-document-dialog">
        <header className="min-w-0 shrink-0 border-b px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2"><FileText className="size-5 text-primary" />{t("sales.quotationDocument.title")}</DialogTitle>
          <DialogDescription className="mt-2">{t("sales.quotationDocument.description")}</DialogDescription>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <aside className="flex min-w-0 shrink-0 flex-col gap-4 border-b bg-muted/20 p-5 md:min-h-0 md:w-72 md:overflow-y-auto md:border-r md:border-b-0">
            <div className="space-y-2">
              <Label htmlFor="quotation-document-template">{t("sales.quotationDocument.layout")}</Label>
              <Select
                value={String(templateId ?? "") || "__none__"}
                onValueChange={(selectValue) => {
                  const nextValue = selectValue === "__none__" ? "" : selectValue
                  changeLayout(nextValue)
                }}
                disabled={!readable || generating || Boolean(output) || templatesLoading}
              >
                <SelectTrigger
                  id="quotation-document-template"
                  className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={"__none__"}>{t("sales.quotationDocument.chooseLayout")}</SelectItem>
                  {layouts.map((row) => (
                    <SelectItem key={String(row.id)} value={String(String(row.id))}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {templatesLoading ? <p role="status" className="text-sm text-muted-foreground">{t("sales.quotationDocument.loading")}</p> : null}
            {templatesQuery.isError ? <div role="alert" className="space-y-2 text-sm">
              <p>{t("sales.quotationDocument.loadError")}</p>
              <Button variant="outline" onClick={() => void templatesQuery.refetch()}>{t("sales.quotationDocument.retry")}</Button>
            </div> : !templatesLoading && layouts.length === 0 ? <p className="text-sm text-muted-foreground">{t("sales.quotationDocument.noLayouts")}</p> : null}
            <Button variant="outline" disabled={!selectedLayout || previewing || generating || Boolean(output)} onClick={() => void loadPreview()}>
              {previewing ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {t(previewing ? "sales.quotationDocument.previewing" : readyPreview ? "sales.quotationDocument.refreshPreview" : "sales.quotationDocument.preview")}
            </Button>
            {readable && checkPermission("document_template", "create").allowed ? <a className="text-sm text-primary underline-offset-4 hover:underline" href="/documents?tab=document-templates" target="_blank" rel="noopener noreferrer">{t("sales.quotationDocument.manageTemplates")}</a> : null}
            {!writable ? <p className="text-sm text-muted-foreground">{t("sales.quotationDocument.readOnly")}</p> : null}
            {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
            {output ? <div role="status" className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <CheckCircle2 className="size-5 text-primary" />
              <p>{t("sales.quotationDocument.saved")}</p>
              <p className="break-all text-xs text-muted-foreground">{output.fileName}</p>
              <a className="text-primary underline-offset-4 hover:underline" href="/documents?tab=documents">{t("sales.quotationDocument.viewDocuments")}</a>
            </div> : null}
          </aside>
          <main className="min-w-0 flex-none bg-muted/40 p-3 md:min-h-0 md:flex-1 md:overflow-auto md:p-6">
            {readyPreview ? <iframe title={t("sales.quotationDocument.previewTitle")} sandbox="" referrerPolicy="no-referrer"
              className="h-full min-h-[480px] w-full rounded border bg-white shadow-sm" srcDoc={readyPreview.html} /> :
              <div className="flex h-full min-h-48 items-center justify-center p-8 text-center text-sm text-muted-foreground" role="status">
                {t(previewing ? "sales.quotationDocument.previewing" : "sales.quotationDocument.previewHint")}
              </div>}
          </main>
        </div>
        <footer className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-4 [overflow-wrap:anywhere]">
          <p className="text-xs text-muted-foreground">{t("sales.quotationDocument.generateHint")}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2 [&>button]:max-w-full [&>button]:whitespace-normal">
            <Button variant="outline" disabled={generating} onClick={onClose}>{t("sales.quotationDocument.close")}</Button>
            {output ? <Button disabled={downloading || !readable} onClick={() => void download()}>
              {downloading ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t(downloading ? "sales.quotationDocument.downloading" : "sales.quotationDocument.download")}
            </Button> : <Button disabled={!writable || !readyPreview || generating || previewing} onClick={() => void generate()}>
              {generating ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {t(generating ? "sales.quotationDocument.generating" : "sales.quotationDocument.generate")}
            </Button>}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
