"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Check, ChevronDown, FileText, LoaderCircle } from "lucide-react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import {
  documentTemplateMatchesScope,
  useCreateDocumentTemplate,
  type DocumentTemplateRow,
} from "@lumiere/query-hooks/hooks/templates"
import { Button } from "@lumiere/ui/components/button"
import { Checkbox } from "@lumiere/ui/components/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@lumiere/ui/components/dialog"
import { DocumentTemplateDesigner } from "@lumiere/ui/components/document-template-designer"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { useUnsavedChangesGuard } from "@lumiere/ui/forms/use-unsaved-changes-guard"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
import {
  createDocumentDesignerSnapshot,
  mergeDocumentDesignerMetadata,
  readDocumentDesignerMetadata,
  type DocumentDesignerKind,
  type DocumentDesignerSnapshot,
  type DocumentDesignerState,
} from "@lumiere/ui/lib/document-template-designer"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import "./document-template-designer-dialog.css"

export interface DocumentTemplateDesignSource {
  row: DocumentTemplateRow
  designer: DocumentDesignerState
}

/** Only reuse projects authored by this designer; ordinary HTML and invoice profiles keep their existing workflows. */
export function customizableDocumentTemplate(
  row: DocumentTemplateRow,
  organizationId: number,
  companyId: number | null | undefined,
): DocumentTemplateDesignSource | null {
  if (!documentTemplateMatchesScope(row, organizationId, companyId)) return null
  if (row.reportType === "lumiere-invoice-profile-v1" || row.report_type === "lumiere-invoice-profile-v1") return null
  if (typeof row.name !== "string" || !row.name.trim() || typeof row.model !== "string" || !row.model.trim()) return null
  try {
    const designer = readDocumentDesignerMetadata(row.metadata)
    return designer ? { row, designer } : null
  } catch {
    return null
  }
}

interface DocumentTemplateDesignerDialogProps {
  organizationId: number
  companyId: number
  identity: string
  template?: DocumentTemplateDesignSource
  onClose: () => void
}

export function DocumentTemplateDesignerDialog({ organizationId, companyId, identity, template, onClose }: DocumentTemplateDesignerDialogProps) {
  const { t } = useTranslation()
  const session = useErpSession()
  const { checkPermission, currentUser, permissionsReady } = useRBAC()
  const scope = { identity, companyId }
  const createTemplate = useCreateDocumentTemplate(organizationId, companyId, scope)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const initialKind = template?.designer.kind ?? "rich-text"
  const initialName = template ? t("documents.designer.copyName", { name: template.row.name, defaultValue: "{{name}} (copy)" }) : ""
  const [kind, setKind] = useState<DocumentDesignerKind>(initialKind)
  const [name, setName] = useState(initialName)
  const model = template?.row.model ?? "document"
  const initialActive = template ? (template.row.isActive ?? template.row.is_active ?? false) : true
  const [isActive, setIsActive] = useState(initialActive)
  const [snapshot, setSnapshot] = useState<DocumentDesignerSnapshot | null>(null)
  const [designDirty, setDesignDirty] = useState(false)
  const [designError, setDesignError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const designBaseline = useRef<string | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const pending = createTemplate.isPending
  const inCurrentScope = identity !== "unknown" && session.identity === identity && session.organizationId === organizationId &&
    session.activeCompanyReady === true && session.activeCompanyId === companyId && session.companyIds?.includes(companyId) === true
  const canSave = inCurrentScope && permissionsReady && currentUser?.id === identity && checkPermission("document_template", "create").allowed
  const current = useRef({ pending, canSave })
  current.current = { pending, canSave }
  const dirty = designDirty || name !== initialName || kind !== initialKind || isActive !== initialActive
  const navigationGuard = useUnsavedChangesGuard(dirty, pending)

  async function requestClose() {
    if (submitting.current || current.current.pending) return
    if (dirty && !await confirm({
      title: t("common.discardChanges.title", { defaultValue: "Discard changes?" }),
      description: t("documents.designer.discardDescription", { defaultValue: "Your template changes have not been saved." }),
      confirmLabel: t("common.discardChanges.discard", { defaultValue: "Discard" }),
      cancelLabel: t("common.discardChanges.keep", { defaultValue: "Keep editing" }),
    })) return
    if (mounted.current && !submitting.current && !current.current.pending) onClose()
  }

  async function changeKind(next: DocumentDesignerKind) {
    if (next === kind || template || submitting.current || current.current.pending || !current.current.canSave) return
    if (designDirty && !await confirm({
      title: t("documents.designer.changeKindTitle", { defaultValue: "Start a different template type?" }),
      description: t("documents.designer.changeKindDescription", { defaultValue: "The current design will be cleared. Your template name will be kept." }),
      confirmLabel: t("documents.designer.changeKindConfirm", { defaultValue: "Start new design" }),
      cancelLabel: t("common.discardChanges.keep", { defaultValue: "Keep editing" }),
    })) return
    if (!mounted.current || submitting.current || current.current.pending || !current.current.canSave) return
    designBaseline.current = null
    setSnapshot(null)
    setDesignDirty(false)
    setDesignError(null)
    setKind(next)
  }

  async function save() {
    if (!current.current.canSave || submitting.current || current.current.pending || !snapshot || designError) return
    if (!name.trim()) {
      setSaveError(t("documents.designer.required", { defaultValue: "Enter a template name." }))
      return
    }
    submitting.current = true
    setSaveError(null)
    try {
      const validated = createDocumentDesignerSnapshot(kind, snapshot.designer.project)
      const metadata = mergeDocumentDesignerMetadata(template?.row.metadata, validated.designer)
      if (template && !customizableDocumentTemplate(template.row, organizationId, companyId)) {
        throw new Error(t("documents.designer.scopeError", { defaultValue: "This template is no longer available in the current company." }))
      }
      await createTemplate.mutateAsync({
        name: name.trim(),
        model: model.trim(),
        reportType: kind === "rich-text" ? "lumiere-rich-text-template-v1" : "lumiere-document-layout-v1",
        bodyHtml: validated.bodyHtml,
        metadata,
        isActive,
        isDefault: false,
      })
      if (!mounted.current || !current.current.canSave) return
      showWorkflowToast({ kind: "success", title: t("documents.designer.saved", { defaultValue: "Template saved" }) })
      onClose()
    } catch (error) {
      if (mounted.current) setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      submitting.current = false
    }
  }

  return <>
    {navigationGuard}
    {confirmDialog}
    <Dialog open onOpenChange={(open) => { if (!open) void requestClose() }}>
      <DialogContent className="document-template-dialog" showCloseButton={false}>
        <DialogTitle className="sr-only">{template
            ? t("documents.designer.copyTitle", { defaultValue: "Customize a template copy" })
            : t("documents.designer.createTitle", { defaultValue: "Design a template" })}</DialogTitle>
        <DialogDescription className="sr-only">{t("documents.designer.description", { defaultValue: "Design reusable page layouts or text for editor fields." })}</DialogDescription>
        <header className="document-template-dialog__header">
          <Button variant="ghost" size="icon" className="document-template-dialog__back" disabled={pending} aria-label={t("common.cancel", { defaultValue: "Cancel" })} title={t("common.cancel", { defaultValue: "Cancel" })} onClick={() => { void requestClose() }}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <span className="document-template-dialog__mark" aria-hidden="true"><FileText /></span>
          <div className="document-template-dialog__identity">
            <div className="document-template-dialog__breadcrumb">
              <span>{t("documents.documents.title", { defaultValue: "Documents" })}</span>
              <span aria-hidden="true">/</span>
              <span>{t("documents.designer.studio", { defaultValue: "Template studio" })}</span>
            </div>
            <Label htmlFor="document-designer-name" className="sr-only">{t("documents.documents.columns.name")}</Label>
            <Input id="document-designer-name" className="document-template-dialog__name" placeholder={t("documents.designer.untitled", { defaultValue: "Untitled template" })} value={name} onChange={(event) => setName(event.target.value)} disabled={pending || !canSave} maxLength={200} />
          </div>
          <div className="document-template-dialog__actions">
            <span className="document-template-dialog__draft">
              <span aria-hidden="true" />
              {dirty ? t("documents.designer.unsaved", { defaultValue: "Unsaved changes" }) : t("documents.designer.draft", { defaultValue: "Draft" })}
            </span>
            <Button className="document-template-dialog__save" disabled={pending || !canSave || !snapshot || Boolean(designError) || !name.trim()} onClick={() => { void save() }}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
              {pending ? t("common.saving", { defaultValue: "Saving…" }) : template
                ? t("documents.designer.saveCopy", { defaultValue: "Save template copy" })
                : t("documents.designer.save", { defaultValue: "Save template" })}
            </Button>
          </div>
        </header>
        <div className="document-template-dialog__metadata">
          <div className="document-template-dialog__kind">
            <Label htmlFor="document-designer-kind">{t("documents.designer.kind", { defaultValue: "Template type" })}</Label>
            <div className="document-template-dialog__select">
              <select id="document-designer-kind" value={kind} disabled={Boolean(template) || pending || !canSave} onChange={(event) => { if (event.target.value === "rich-text" || event.target.value === "document") void changeKind(event.target.value) }}>
                <option value="rich-text">{t("documents.designer.richText", { defaultValue: "Text for editor fields" })}</option>
                <option value="document">{t("documents.designer.document", { defaultValue: "Document layout" })}</option>
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
          </div>
          <div className="document-template-dialog__active">
            <Checkbox id="document-designer-active" checked={isActive} onCheckedChange={(checked) => setIsActive(checked === true)} disabled={pending || !canSave} />
            <Label htmlFor="document-designer-active">{t("common.active", { defaultValue: "Active" })}</Label>
          </div>
          <span className="document-template-dialog__hint">{kind === "rich-text"
            ? t("documents.designer.textHint", { defaultValue: "Reusable content for your editor fields" })
            : t("documents.designer.layoutHint", { defaultValue: "Reusable layouts for your documents" })}</span>
        </div>
        <div className="document-template-dialog__workspace">
          <DocumentTemplateDesigner
            key={`${template?.row.id ?? "new"}:${kind}`}
            kind={kind}
            initialDesigner={template?.designer}
            disabled={pending || !canSave}
            onChange={(next) => {
              const serialized = JSON.stringify(next.designer)
              if (designBaseline.current === null) designBaseline.current = serialized
              setDesignDirty(serialized !== designBaseline.current)
              setSnapshot(next)
              setDesignError(null)
            }}
            onError={(message) => {
              setSnapshot(null)
              setDesignDirty(designBaseline.current !== null)
              setDesignError(message)
            }}
          />
        </div>
        {designError || saveError ? <p role="alert" className="document-template-dialog__error">{designError ?? saveError}</p> : null}
      </DialogContent>
    </Dialog>
  </>
}
