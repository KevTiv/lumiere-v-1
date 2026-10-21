"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FileText,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import {
  documentTemplateMatchesScope,
  useCreateDocumentTemplate,
  useUpdateDocumentTemplate,
  type DocumentTemplateRow,
} from "@lumiere/query-hooks/hooks/templates"
import { Button } from "@lumiere/ui/components/button"
import { Checkbox } from "@lumiere/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@lumiere/ui/components/dialog"
import {
  DocumentTemplateDesigner,
  createQuotationTemplateStarter,
  createTextTemplateStarter,
  type TextTemplateStarter,
} from "@lumiere/ui/components/document-template-designer"
import { isManagedInvoiceLogoUrl } from "@lumiere/erp-shared/invoice-personalization"
import { validateInvoiceLogoFile } from "@lumiere/ui/settings/invoice-personalization-settings"
import { uploadDocumentBlob } from "../../../lib/document-blob-upload"
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
  if (
    row.reportType === "lumiere-invoice-profile-v1" ||
    row.report_type === "lumiere-invoice-profile-v1"
  )
    return null
  if (
    typeof row.name !== "string" ||
    !row.name.trim() ||
    typeof row.model !== "string" ||
    !row.model.trim()
  )
    return null
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
  mode?: "create" | "edit" | "duplicate"
  onClose: () => void
}

function templateLogo(
  metadata: string | null | undefined,
  organizationId: number,
): string {
  try {
    const branding = metadata ? JSON.parse(metadata)?.documentBranding : null
    return branding?.schemaVersion === 1 &&
      typeof branding.logoUrl === "string" &&
      isManagedInvoiceLogoUrl(branding.logoUrl, organizationId)
      ? branding.logoUrl
      : ""
  } catch {
    return ""
  }
}

export function DocumentTemplateDesignerDialog({
  organizationId,
  companyId,
  identity,
  template,
  mode = template ? "duplicate" : "create",
  onClose,
}: DocumentTemplateDesignerDialogProps) {
  const { t } = useTranslation()
  const session = useErpSession()
  const { checkPermission, currentUser, permissionsReady } = useRBAC()
  const scope = { identity, companyId }
  const createTemplate = useCreateDocumentTemplate(
    organizationId,
    companyId,
    scope,
  )
  const updateTemplate = useUpdateDocumentTemplate(organizationId, scope)
  const editing = mode === "edit" && Boolean(template)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const initialKind = template?.designer.kind ?? "rich-text"
  const initialName = template
    ? editing
      ? template.row.name!
      : t("documents.designer.copyName", {
          name: template.row.name,
          defaultValue: "{{name}} (copy)",
        })
    : ""
  const [kind, setKind] = useState<DocumentDesignerKind>(initialKind)
  const [name, setName] = useState(initialName)
  const model = template?.row.model ?? "document"
  const initialActive = template
    ? (template.row.isActive ?? template.row.is_active ?? false)
    : true
  const [isActive, setIsActive] = useState(initialActive)
  const [snapshot, setSnapshot] = useState<DocumentDesignerSnapshot | null>(
    null,
  )
  const [starter, setStarter] = useState<TextTemplateStarter>("blank")
  const [starterDesigner, setStarterDesigner] =
    useState<DocumentDesignerState>()
  const [documentStarter, setDocumentStarter] = useState<"blank" | "quotation">(
    "blank",
  )
  const initialLogo = templateLogo(template?.row.metadata, organizationId)
  const [logoUrl, setLogoUrl] = useState(initialLogo)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const uploading = useRef(false)
  const [designDirty, setDesignDirty] = useState(false)
  const [designError, setDesignError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const designBaseline = useRef<string | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const pending =
    createTemplate.isPending || updateTemplate.isPending || logoUploading
  const inCurrentScope =
    identity !== "unknown" &&
    session.identity === identity &&
    session.organizationId === organizationId &&
    session.activeCompanyReady === true &&
    session.activeCompanyId === companyId &&
    session.companyIds?.includes(companyId) === true
  const canSave =
    inCurrentScope &&
    permissionsReady &&
    currentUser?.id === identity &&
    checkPermission("document_template", editing ? "write" : "create").allowed
  const current = useRef({ pending, canSave })
  current.current = { pending, canSave }
  const dirty =
    designDirty ||
    starter !== "blank" ||
    documentStarter !== "blank" ||
    logoUrl !== initialLogo ||
    name !== initialName ||
    kind !== initialKind ||
    isActive !== initialActive
  const hasContent = Boolean(
    snapshot?.bodyHtml
      .replace(/<[^>]*>/g, "")
      .replace(/&(?:nbsp|#160);/g, " ")
      .trim(),
  )
  const navigationGuard = useUnsavedChangesGuard(dirty, pending)

  async function requestClose() {
    if (submitting.current || uploading.current || current.current.pending)
      return
    if (
      dirty &&
      !(await confirm({
        title: t("common.discardChanges.title", {
          defaultValue: "Discard changes?",
        }),
        description: t("documents.designer.discardDescription", {
          defaultValue: "Your template changes have not been saved.",
        }),
        confirmLabel: t("common.discardChanges.discard", {
          defaultValue: "Discard",
        }),
        cancelLabel: t("common.discardChanges.keep", {
          defaultValue: "Keep editing",
        }),
      }))
    )
      return
    if (mounted.current && !submitting.current && !current.current.pending)
      onClose()
  }

  async function changeKind(next: DocumentDesignerKind) {
    if (
      next === kind ||
      template ||
      submitting.current ||
      current.current.pending ||
      !current.current.canSave
    )
      return
    if (
      designDirty &&
      !(await confirm({
        title: t("documents.designer.changeKindTitle", {
          defaultValue: "Start a different template type?",
        }),
        description: t("documents.designer.changeKindDescription", {
          defaultValue:
            "The current design will be cleared. Your template name will be kept.",
        }),
        confirmLabel: t("documents.designer.changeKindConfirm", {
          defaultValue: "Start new design",
        }),
        cancelLabel: t("common.discardChanges.keep", {
          defaultValue: "Keep editing",
        }),
      }))
    )
      return
    if (
      !mounted.current ||
      submitting.current ||
      current.current.pending ||
      !current.current.canSave
    )
      return
    designBaseline.current = null
    setSnapshot(null)
    setDesignDirty(false)
    setDesignError(null)
    setStarter("blank")
    setDocumentStarter("blank")
    setStarterDesigner(undefined)
    setKind(next)
  }

  async function changeDocumentStarter(next: "blank" | "quotation") {
    if (
      next === documentStarter ||
      template ||
      kind !== "document" ||
      submitting.current ||
      current.current.pending ||
      !current.current.canSave
    )
      return
    if (
      designDirty &&
      !(await confirm({
        title: t("documents.designer.starterReplaceTitle", {
          defaultValue: "Replace this draft with a starter?",
        }),
        description: t("documents.designer.starterReplaceDescription", {
          defaultValue:
            "Your current text will be cleared. The template name will be kept.",
        }),
        confirmLabel: t("documents.designer.starterReplaceConfirm", {
          defaultValue: "Use starter",
        }),
        cancelLabel: t("common.discardChanges.keep", {
          defaultValue: "Keep editing",
        }),
      }))
    )
      return
    if (
      !mounted.current ||
      submitting.current ||
      current.current.pending ||
      !current.current.canSave
    )
      return
    designBaseline.current = null
    setSnapshot(null)
    setDesignDirty(false)
    setDesignError(null)
    setStarterDesigner(
      next === "quotation" ? createQuotationTemplateStarter(t) : undefined,
    )
    setDocumentStarter(next)
  }

  async function uploadLogo(file: File) {
    if (
      uploading.current ||
      submitting.current ||
      current.current.pending ||
      !current.current.canSave
    )
      return
    uploading.current = true
    setLogoUploading(true)
    setLogoError(null)
    try {
      await validateInvoiceLogoFile(file)
      if (!mounted.current || !current.current.canSave) return
      const sourceCompany =
        editing && template
          ? template.row.companyId !== undefined
            ? template.row.companyId
            : template.row.company_id
          : companyId
      if (sourceCompany === undefined)
        throw new Error(
          t("documents.designer.scopeError", {
            defaultValue:
              "This template is no longer available in the current company.",
          }),
        )
      const uploaded = await uploadDocumentBlob({
        file,
        companyId: sourceCompany === null ? undefined : BigInt(sourceCompany),
      })
      const pinned = `${uploaded.url}?sha256=${uploaded.checksum}`
      if (!isManagedInvoiceLogoUrl(pinned, organizationId))
        throw new Error(
          t("documents.designer.logoInvalid", {
            defaultValue:
              "The uploaded logo is not a verified image for this organization.",
          }),
        )
      if (mounted.current && current.current.canSave) setLogoUrl(pinned)
    } catch (error) {
      if (mounted.current)
        setLogoError(
          error instanceof Error
            ? error.message
            : t("documents.designer.logoFailed", {
                defaultValue: "The logo could not be uploaded. Try again.",
              }),
        )
    } finally {
      uploading.current = false
      if (mounted.current) setLogoUploading(false)
      if (logoInput.current) logoInput.current.value = ""
    }
  }

  async function changeStarter(next: TextTemplateStarter) {
    if (
      next === starter ||
      template ||
      kind !== "rich-text" ||
      submitting.current ||
      current.current.pending ||
      !current.current.canSave
    )
      return
    if (
      designDirty &&
      !(await confirm({
        title: t("documents.designer.starterReplaceTitle", {
          defaultValue: "Replace this draft with a starter?",
        }),
        description: t("documents.designer.starterReplaceDescription", {
          defaultValue:
            "Your current text will be cleared. The template name will be kept.",
        }),
        confirmLabel: t("documents.designer.starterReplaceConfirm", {
          defaultValue: "Use starter",
        }),
        cancelLabel: t("common.discardChanges.keep", {
          defaultValue: "Keep editing",
        }),
      }))
    )
      return
    if (
      !mounted.current ||
      submitting.current ||
      current.current.pending ||
      !current.current.canSave
    )
      return
    designBaseline.current = null
    setSnapshot(null)
    setDesignDirty(false)
    setDesignError(null)
    setStarterDesigner(createTextTemplateStarter(next, t))
    setStarter(next)
  }

  async function save() {
    if (
      !current.current.canSave ||
      submitting.current ||
      uploading.current ||
      current.current.pending ||
      !snapshot ||
      designError ||
      !hasContent
    )
      return
    if (!name.trim()) {
      setSaveError(
        t("documents.designer.required", {
          defaultValue: "Enter a template name.",
        }),
      )
      return
    }
    submitting.current = true
    setSaveError(null)
    try {
      const validated = createDocumentDesignerSnapshot(
        kind,
        snapshot.designer.project,
      )
      const metadataEnvelope: unknown = JSON.parse(
        mergeDocumentDesignerMetadata(
          template?.row.metadata,
          validated.designer,
        ),
      )
      if (
        !metadataEnvelope ||
        typeof metadataEnvelope !== "object" ||
        Array.isArray(metadataEnvelope)
      )
        throw new Error(
          t("documents.designer.metadataError", {
            defaultValue: "The template metadata could not be read.",
          }),
        )
      const merged = Object.fromEntries(
        Object.entries(metadataEnvelope).filter(
          ([key]) => kind !== "document" || key !== "documentBranding",
        ),
      )
      if (kind === "document") {
        if (logoUrl) {
          if (!isManagedInvoiceLogoUrl(logoUrl, organizationId))
            throw new Error(
              t("documents.designer.logoInvalid", {
                defaultValue:
                  "The uploaded logo is not a verified image for this organization.",
              }),
            )
          merged.documentBranding = { schemaVersion: 1, logoUrl }
        }
      }
      const metadata = JSON.stringify(merged)
      if (
        template &&
        !customizableDocumentTemplate(template.row, organizationId, companyId)
      ) {
        throw new Error(
          t("documents.designer.scopeError", {
            defaultValue:
              "This template is no longer available in the current company.",
          }),
        )
      }
      const params = {
        name: name.trim(),
        reportType:
          kind === "rich-text"
            ? "lumiere-rich-text-template-v1"
            : "lumiere-document-layout-v1",
        bodyHtml: validated.bodyHtml,
        metadata,
        isActive,
      }
      if (editing && template) {
        const sourceCompany =
          template.row.companyId !== undefined
            ? template.row.companyId
            : template.row.company_id
        if (sourceCompany === undefined)
          throw new Error(
            t("documents.designer.scopeError", {
              defaultValue:
                "This template is no longer available in the current company.",
            }),
          )
        await updateTemplate.mutateAsync({
          templateId: template.row.id,
          companyId: sourceCompany,
          params,
        })
      } else {
        await createTemplate.mutateAsync({
          ...params,
          model: model.trim(),
          isDefault: false,
        })
      }
      if (!mounted.current || !current.current.canSave) return
      showWorkflowToast({
        kind: "success",
        title: t("documents.designer.saved", {
          defaultValue: "Template saved",
        }),
      })
      onClose()
    } catch (error) {
      if (mounted.current)
        setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      submitting.current = false
    }
  }

  return (
    <>
      {navigationGuard}
      {confirmDialog}
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) void requestClose()
        }}
      >
        <DialogContent
          className="document-template-dialog"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {editing
              ? t("documents.designer.editTitle", {
                  defaultValue: "Edit template",
                })
              : template
                ? t("documents.designer.copyTitle", {
                    defaultValue: "Customize a template copy",
                  })
                : t("documents.designer.createTitle", {
                    defaultValue: "Design a template",
                  })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("documents.designer.description", {
              defaultValue:
                "Design reusable page layouts or text for editor fields.",
            })}
          </DialogDescription>
          <header className="document-template-dialog__header">
            <Button
              variant="ghost"
              size="icon"
              className="document-template-dialog__back"
              disabled={pending}
              aria-label={t("common.cancel", { defaultValue: "Cancel" })}
              title={t("common.cancel", { defaultValue: "Cancel" })}
              onClick={() => {
                void requestClose()
              }}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <span className="document-template-dialog__mark" aria-hidden="true">
              <FileText />
            </span>
            <div className="document-template-dialog__identity">
              <div className="document-template-dialog__breadcrumb">
                <span>
                  {t("documents.documents.title", {
                    defaultValue: "Documents",
                  })}
                </span>
                <span aria-hidden="true">/</span>
                <span>
                  {t("documents.designer.studio", {
                    defaultValue: "Template studio",
                  })}
                </span>
              </div>
              <Label htmlFor="document-designer-name" className="sr-only">
                {t("documents.documents.columns.name")}
              </Label>
              <Input
                id="document-designer-name"
                className="document-template-dialog__name"
                placeholder={t("documents.designer.untitled", {
                  defaultValue: "Untitled template",
                })}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending || !canSave}
                maxLength={200}
              />
            </div>
            <div className="document-template-dialog__actions">
              <span className="document-template-dialog__draft">
                <span aria-hidden="true" />
                {dirty
                  ? t("documents.designer.unsaved", {
                      defaultValue: "Unsaved changes",
                    })
                  : t("documents.designer.draft", { defaultValue: "Draft" })}
              </span>
              <Button
                className="document-template-dialog__save"
                disabled={
                  pending ||
                  !canSave ||
                  !snapshot ||
                  Boolean(designError) ||
                  !name.trim() ||
                  !hasContent
                }
                onClick={() => {
                  void save()
                }}
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                {pending
                  ? t("common.saving", { defaultValue: "Saving…" })
                  : editing
                    ? t("documents.designer.saveChanges", {
                        defaultValue: "Save changes",
                      })
                    : template
                      ? t("documents.designer.saveCopy", {
                          defaultValue: "Save template copy",
                        })
                      : t("documents.designer.save", {
                          defaultValue: "Save template",
                        })}
              </Button>
            </div>
          </header>
          <div className="document-template-dialog__metadata">
            <div className="document-template-dialog__kind">
              <Label htmlFor="document-designer-kind">
                {t("documents.designer.kind", {
                  defaultValue: "Template type",
                })}
              </Label>
              <div className="document-template-dialog__select">
                <select
                  id="document-designer-kind"
                  value={kind}
                  disabled={Boolean(template) || pending || !canSave}
                  onChange={(event) => {
                    if (
                      event.target.value === "rich-text" ||
                      event.target.value === "document"
                    )
                      void changeKind(event.target.value)
                  }}
                >
                  <option value="rich-text">
                    {t("documents.designer.richText", {
                      defaultValue: "Text for editor fields",
                    })}
                  </option>
                  <option value="document">
                    {t("documents.designer.document", {
                      defaultValue: "Document layout",
                    })}
                  </option>
                </select>
                <ChevronDown aria-hidden="true" />
              </div>
            </div>
            {!template && kind === "rich-text" ? (
              <div className="document-template-dialog__kind">
                <Label htmlFor="document-designer-starter">
                  {t("documents.designer.starter", {
                    defaultValue: "Start with",
                  })}
                </Label>
                <div className="document-template-dialog__select">
                  <select
                    id="document-designer-starter"
                    value={starter}
                    disabled={pending || !canSave}
                    onChange={(event) => {
                      void changeStarter(
                        event.target.value as TextTemplateStarter,
                      )
                    }}
                  >
                    <option value="blank">
                      {t("documents.designer.starters.blank", {
                        defaultValue: "Blank text",
                      })}
                    </option>
                    <option value="proposal">
                      {t("documents.designer.starters.proposal", {
                        defaultValue: "Proposal introduction",
                      })}
                    </option>
                    <option value="scope">
                      {t("documents.designer.starters.scope", {
                        defaultValue: "Scope of work",
                      })}
                    </option>
                    <option value="terms">
                      {t("documents.designer.starters.terms", {
                        defaultValue: "Working terms",
                      })}
                    </option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </div>
              </div>
            ) : null}
            {!template && kind === "document" ? (
              <div className="document-template-dialog__kind">
                <Label htmlFor="document-designer-document-starter">
                  {t("documents.designer.starter", {
                    defaultValue: "Start with",
                  })}
                </Label>
                <div className="document-template-dialog__select">
                  <select
                    id="document-designer-document-starter"
                    value={documentStarter}
                    disabled={pending || !canSave}
                    onChange={(event) => {
                      if (
                        event.target.value === "blank" ||
                        event.target.value === "quotation"
                      )
                        void changeDocumentStarter(event.target.value)
                    }}
                  >
                    <option value="blank">
                      {t("documents.designer.starters.blankDocument", {
                        defaultValue: "Blank document",
                      })}
                    </option>
                    <option value="quotation">
                      {t("documents.designer.starters.quotation", {
                        defaultValue: "Quotation",
                      })}
                    </option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </div>
              </div>
            ) : null}
            <div className="document-template-dialog__active">
              <Checkbox
                id="document-designer-active"
                aria-label={t("common.active", { defaultValue: "Active" })}
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
                disabled={pending || !canSave}
              />
              <Label htmlFor="document-designer-active">
                {t("common.active", { defaultValue: "Active" })}
              </Label>
            </div>
            <span className="document-template-dialog__hint">
              {kind === "rich-text"
                ? !hasContent
                  ? t("documents.designer.emptyHint", {
                      defaultValue:
                        "Choose a starter or add your own text before saving.",
                    })
                  : t("documents.designer.textHint", {
                      defaultValue:
                        "Insert active templates from the Templates menu in text fields.",
                    })
                : t("documents.designer.layoutHint", {
                    defaultValue:
                      "Use quotation fields, then preview this layout from a sales quotation.",
                  })}
            </span>
          </div>
          {kind === "document" ? (
            <div className="document-template-dialog__branding">
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                aria-label={t("documents.designer.uploadLogo", {
                  defaultValue: "Upload brand logo",
                })}
                disabled={pending || !canSave}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void uploadLogo(file)
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || !canSave}
                onClick={() => logoInput.current?.click()}
              >
                <Upload />
                {logoUploading
                  ? t("documents.designer.logoUploading", {
                      defaultValue: "Uploading logo…",
                    })
                  : t("documents.designer.uploadLogo", {
                      defaultValue: "Upload brand logo",
                    })}
              </Button>
              {logoUrl ? (
                <>
                  <span>
                    {t("documents.designer.logoReady", {
                      defaultValue: "Brand logo attached",
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("documents.designer.removeLogo", {
                      defaultValue: "Remove brand logo",
                    })}
                    disabled={pending || !canSave}
                    onClick={() => setLogoUrl("")}
                  >
                    <X />
                  </Button>
                </>
              ) : (
                <span>
                  {t("documents.designer.logoHint", {
                    defaultValue:
                      "PNG or JPEG, up to 2 MiB. Add the Brand logo block to place it in quotation output.",
                  })}
                </span>
              )}
              {logoError ? <p role="alert">{logoError}</p> : null}
            </div>
          ) : null}
          <div className="document-template-dialog__workspace">
            <DocumentTemplateDesigner
              key={`${template?.row.id ?? "new"}:${kind}:${starter}:${documentStarter}`}
              kind={kind}
              initialDesigner={template?.designer ?? starterDesigner}
              disabled={pending || !canSave}
              onChange={(next) => {
                const serialized = JSON.stringify(next.designer)
                if (designBaseline.current === null)
                  designBaseline.current = serialized
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
          {designError || saveError ? (
            <p role="alert" className="document-template-dialog__error">
              {designError ?? saveError}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
