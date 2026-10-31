"use client"

import { useEffect, useId, useRef, useState } from "react"
import DOMPurify from "dompurify"
import { BookOpen, Download, ExternalLink, FileText, Loader2, Pencil, Save } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Textarea } from "../components/textarea"
import { Input } from "../components/input"
import { MarkdownView } from "../components/markdown-view"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../components/alert-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"
import { cn } from "../lib/utils"
import { extractGuideHtmlDerivative, isSavedGuide, safeGuideHref } from "../lib/assistant-guide-types"
import type { GuideDocument, GuideDraft, GuideReference, GuideRevisionSummary } from "../lib/assistant-guide-types"
import type { GuideReviewInput, GuideVerificationInput, GuideVerificationChoice } from "../lib/assistant-guide-types"
import { GuideVerificationActions } from "./guide-verification-actions"

export interface AssistantGuideViewerProps {
  document: GuideDraft | GuideDocument
  onSave?: (draft: GuideDraft, expectedRevision?: number) => Promise<GuideDocument | void>
  onAsk?: (question: string, draftOverride?: GuideDraft) => Promise<string | void>
  onLoadVerificationChoices?: () => Promise<GuideVerificationChoice[]>
  onRequestVerification?: (input: GuideVerificationInput) => Promise<void>
  onRecordReview?: (input: GuideReviewInput) => Promise<void>
  onOpenFullPage?: (reference?: GuideReference) => void
  history?: GuideRevisionSummary[]
  onRevisionChange?: (revision: number) => void | Promise<void>
  onDirtyChange?: (dirty: boolean) => void
  moduleOptions?: readonly { value: string; label: string }[]
  busy?: boolean
  verificationUnavailable?: boolean
  onRetryVerification?: () => void
  error?: string | null
  className?: string
}

function guideDisplayLabel(value: string): string {
  return value.replace(/[_.:-]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

function guideDisplayTime(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(time)) : value
}

/** Escape raw HTML before it reaches the existing Markdown parser. */
export function guideMarkdownWithoutHtml(markdown: string): string {
  return markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/).map((part, index) => index % 2 === 1 ? part : part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("")
}

/** Static, isolated rendering: no network endpoints, forms, active content or navigation. */
export function buildGuideHtmlPreview(html: string): string {
  const safe = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["script", "style", "link", "meta", "base", "form", "input", "button", "textarea", "select", "option", "iframe", "object", "embed", "svg", "math", "video", "audio", "img", "picture", "source"],
    FORBID_ATTR: ["style", "href", "src", "srcset", "action", "formaction", "poster", "background", "xlink:href", "ping", "target", "download"],
    ALLOW_DATA_ATTR: false,
  })
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:24px;font:15px/1.7 system-ui,sans-serif;color:#202529;background:#fff;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}pre{white-space:pre-wrap}h1,h2,h3{line-height:1.3}</style></head><body>${safe}</body></html>`
}

export function AssistantGuideViewer({ document: guide, onSave, onAsk, onLoadVerificationChoices, onRequestVerification, onRecordReview, onOpenFullPage, history, onRevisionChange, onDirtyChange, moduleOptions, busy = false, verificationUnavailable = false, onRetryVerification, error, className }: AssistantGuideViewerProps) {
  const { t } = useTranslation()
  const id = useId()
  const [edit, setEdit] = useState(false)
  const [title, setTitle] = useState(guide.title)
  const [module, setModule] = useState(guide.module)
  const [markdown, setMarkdown] = useState(guide.markdown)
  const [question, setQuestion] = useState("")
  const [reviewInput, setReviewInput] = useState(false)
  const [followUp, setFollowUp] = useState<string | null>(null)
  const [pending, setPending] = useState<"save" | "ask" | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [format, setFormat] = useState<"markdown" | "html">("markdown")
  const [htmlPreview, setHtmlPreview] = useState("")
  const saved = isSavedGuide(guide)
  const invalidIdentity = "guideId" in guide && !saved
  const identity = saved ? `${guide.guideId}:${guide.revision}` : guide.draftKey
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  const canSave = !invalidIdentity && Boolean(onSave) && (!saved || guide.canWrite === true)
  const disabled = busy || pending !== null
  const dirty = title !== guide.title || module !== guide.module || markdown !== guide.markdown
  const hasPendingInput = dirty || question.trim().length > 0 || reviewInput
  const moduleLabel = moduleOptions?.find((option) => option.value === guide.module)?.label ?? guideDisplayLabel(guide.module)
  const filingLabel = moduleOptions?.find((option) => option.value === module)?.label ?? guideDisplayLabel(module)
  useEffect(() => { onDirtyChange?.(hasPendingInput) }, [hasPendingInput, onDirtyChange])
  useEffect(() => { setHtmlPreview(guide.html ? buildGuideHtmlPreview(guide.html) : "") }, [guide.html])

  useEffect(() => {
    setTitle(guide.title)
    setModule(guide.module)
    setMarkdown(guide.markdown)
    setEdit(false)
    setLocalError(null)
    setFormat("markdown")
    setFollowUp(null)
    setPending(null)
  }, [identity, guide.title, guide.module, guide.markdown])

  const labels = {
    draft: t("aiChat.guide.reviewDraft", { defaultValue: "Draft" }),
    verified: t("aiChat.guide.verified", { defaultValue: "Verified" }),
    needs_review: t("aiChat.guide.needsReview", { defaultValue: "Needs review" }),
    superseded: t("aiChat.guide.superseded", { defaultValue: "Superseded" }),
  }

  function currentDraft(): GuideDraft {
    return {
      draftKey: guide.draftKey, title: title.trim(), module: module.trim(), markdown,
      html: markdown !== guide.markdown ? extractGuideHtmlDerivative(markdown) : guide.html,
      companyId: guide.companyId, sources: guide.sources, workflow: guide.workflow,
      language: guide.language, workflowVersion: guide.workflowVersion,
      originMessageId: guide.originMessageId, runId: guide.runId,
    }
  }

  async function save() {
    if (!onSave || !canSave || disabled || verificationUnavailable || !title.trim() || !module.trim() || !markdown.trim()) return
    setPending("save")
    setLocalError(null)
    try {
      const result = await onSave(currentDraft(), saved ? guide.revision : undefined)
      // Only the host's returned/published durable document can change the saved state.
      if (currentIdentity.current === identity && result && isSavedGuide(result)) setEdit(false)
    } catch (cause) {
      if (currentIdentity.current === identity) setLocalError(cause instanceof Error ? cause.message : t("aiChat.guide.saveFailed", { defaultValue: "The guide could not be saved. Your changes are retained." }))
    } finally {
      if (currentIdentity.current === identity) setPending(null)
    }
  }

  async function ask() {
    if (!onAsk || !question.trim() || disabled || verificationUnavailable) return
    const submitted = question.trim()
    setPending("ask")
    setLocalError(null)
    try {
      const response = dirty ? await onAsk(submitted, currentDraft()) : await onAsk(submitted)
      if (currentIdentity.current === identity) {
        if (typeof response === "string") setFollowUp(response)
        setQuestion((current) => current.trim() === submitted ? "" : current)
      }
    } catch (cause) {
      if (currentIdentity.current === identity) setLocalError(cause instanceof Error ? cause.message : t("aiChat.guide.askFailed", { defaultValue: "The question could not be sent. Your message is retained." }))
    } finally {
      if (currentIdentity.current === identity) setPending(null)
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = globalThis.document.createElement("a")
    link.href = url
    link.download = `${title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 100) || "erp-guide"}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (invalidIdentity) return <p role="alert" className="p-6 text-sm text-destructive">{t("aiChat.guide.invalidReference", { defaultValue: "This document reference is invalid. Reopen the guide from your library." })}</p>

  return <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", className)} aria-label={t("aiChat.guide.document", { defaultValue: "ERP guide" })} data-testid="assistant-guide-viewer">
    <header className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><BookOpen className="size-3.5" aria-hidden="true" /><span>{moduleLabel}{guide.workflow ? ` / ${guideDisplayLabel(guide.workflow)}` : ""}</span></div>
          <h2 className="break-words text-xl font-semibold tracking-tight">{guide.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" role="status">
            <span data-testid="assistant-guide-save-state">{saved ? dirty ? t("aiChat.guide.unsavedChanges", { defaultValue: "Unsaved changes" }) : t("aiChat.guide.savedRevision", { defaultValue: "Saved · revision {{revision}}", revision: guide.revision }) : t("aiChat.guide.unsavedDraft", { defaultValue: "Unsaved draft" })}</span>
            {saved ? <span>{labels[guide.reviewState]}</span> : null}
            {saved && guide.updatedAt ? <time dateTime={guide.updatedAt} suppressHydrationWarning>{guideDisplayTime(guide.updatedAt)}</time> : null}
            {saved && guide.headRevision && guide.headRevision > guide.revision ? <span>{t("aiChat.guide.historical", { defaultValue: "A newer revision is available" })}</span> : null}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto">
          {onOpenFullPage ? <Button variant="outline" size="sm" disabled={disabled || verificationUnavailable || hasPendingInput} onClick={() => onOpenFullPage(saved ? { guideId: guide.guideId, revision: guide.revision } : undefined)}><ExternalLink className="size-3.5" aria-hidden="true" />{saved ? t("aiChat.guide.openFullPage", { defaultValue: "Open full page" }) : t("aiChat.guide.saveOpenFullPage", { defaultValue: "Save and open full page" })}</Button> : null}
          <Button variant="ghost" size="icon-sm" onClick={download} aria-label={t("aiChat.guide.download", { defaultValue: "Download Markdown" })}><Download className="size-4" /></Button>
        </div>
      </div>
      {verificationUnavailable && onRetryVerification ? <Button className="mt-3" variant="outline" size="sm" disabled={disabled} onClick={onRetryVerification}>{t("aiChat.guide.retryAccess", { defaultValue: "Retry access check" })}</Button> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canSave ? <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setEdit((value) => !value); setFormat("markdown") }}><Pencil className="size-3.5" aria-hidden="true" />{edit ? t("aiChat.guide.read", { defaultValue: "Read guide" }) : t("aiChat.guide.edit", { defaultValue: "Edit guide" })}</Button> : null}
        {guide.html && !edit && !dirty ? <div className="flex gap-1" aria-label={t("aiChat.guide.format", { defaultValue: "Document format" })}>
          <Button variant={format === "markdown" ? "secondary" : "ghost"} size="sm" aria-pressed={format === "markdown"} onClick={() => setFormat("markdown")}>Markdown</Button>
          <Button variant={format === "html" ? "secondary" : "ghost"} size="sm" aria-pressed={format === "html"} onClick={() => setFormat("html")}>{t("aiChat.guide.htmlPreview", { defaultValue: "HTML preview" })}</Button>
        </div> : null}
        {history && history.length > 0 && onRevisionChange && saved ? <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><span>{t("aiChat.guide.history", { defaultValue: "History" })}</span><Select value={String(guide.revision)} disabled={disabled || verificationUnavailable || hasPendingInput} onValueChange={(value) => {
          setLocalError(null)
          Promise.resolve(onRevisionChange(Number(value))).catch((cause) => setLocalError(cause instanceof Error ? cause.message : t("aiChat.guide.openFailed", { defaultValue: "The document could not be opened. Try again." })))
        }}><SelectTrigger className="max-w-48 text-foreground" aria-label={t("aiChat.guide.history", { defaultValue: "History" })}><SelectValue /></SelectTrigger><SelectContent>{history.map((revision) => <SelectItem key={revision.revision} value={String(revision.revision)}>{t("aiChat.guide.revision", { defaultValue: "Revision {{revision}}", revision: revision.revision })} · {labels[revision.reviewState]}</SelectItem>)}</SelectContent></Select></label> : null}
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
      {error || localError ? <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error || localError}</p> : null}
      {edit ? <div className="space-y-4">
        <label className="block space-y-1.5 text-sm" htmlFor={`${id}-title`}><span>{t("aiChat.guide.title", { defaultValue: "Title" })}</span><Input id={`${id}-title`} value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></label>
        {saved ? <div className="space-y-1 text-sm"><p>{t("aiChat.guide.fileUnder", { defaultValue: "File under module" })}: {moduleLabel}</p><p className="text-xs text-muted-foreground">{t("aiChat.guide.moduleFixed", { defaultValue: "The module stays fixed when you revise a saved guide." })}</p></div> : moduleOptions?.length ? <label className="block space-y-1.5 text-sm"><span>{t("aiChat.guide.fileUnder", { defaultValue: "File under module" })}</span><Select value={module} disabled={disabled} onValueChange={setModule}><SelectTrigger aria-label={t("aiChat.guide.fileUnder", { defaultValue: "File under module" })}><SelectValue /></SelectTrigger><SelectContent>{!moduleOptions.some((option) => option.value === guide.module) ? <SelectItem value={guide.module}>{moduleLabel}</SelectItem> : null}{moduleOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label> : <label className="block space-y-1.5 text-sm" htmlFor={`${id}-module`}><span>{t("aiChat.guide.fileUnder", { defaultValue: "File under module" })}</span><Input id={`${id}-module`} value={module} disabled={disabled} onChange={(event) => setModule(event.target.value)} maxLength={80} /></label>}
        <label className="block space-y-1.5 text-sm" htmlFor={`${id}-content`}><span>{t("aiChat.guide.content", { defaultValue: "Guide content (Markdown)" })}</span><Textarea variant="plain" id={`${id}-content`} value={markdown} disabled={disabled} onChange={(event) => setMarkdown(event.target.value)} className="min-h-72 font-mono text-sm" /></label>
      </div> : format === "html" && htmlPreview ? <iframe title={t("aiChat.guide.htmlDocument", { defaultValue: "Static HTML document preview" })} sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPreview} className="h-[55dvh] min-h-72 w-full rounded-lg border border-border bg-white" /> : <MarkdownView value={guideMarkdownWithoutHtml(markdown)} />}
      {guide.sources.length > 0 ? <aside className="mt-8 border-t border-border pt-4" aria-label={t("aiChat.guide.sources", { defaultValue: "Sources used" })}>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t("aiChat.guide.sources", { defaultValue: "Sources used" })}</h3>
        <ul className="space-y-2 text-sm">{guide.sources.map((source, index) => {
          const href = safeGuideHref(source.href) ?? safeGuideHref(source.url)
          const label = source.label ?? `${source.entity_type ?? source.source_kind ?? "Source"}${source.entity_id ? ` #${source.entity_id}` : ` ${index + 1}`}`
          return <li key={`${source.source_key ?? source.entity_id ?? index}:${source.source_version ?? ""}`} className="break-words">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{label}</a> : <span>{label}</span>}{source.source_version ? <span className="ml-2 text-xs text-muted-foreground">{source.source_version}</span> : null}{source.snapshot_at ? <time dateTime={source.snapshot_at} suppressHydrationWarning className="block text-xs text-muted-foreground">{t("aiChat.guide.sourceAsOf", { defaultValue: "Record as of {{time}}", time: guideDisplayTime(source.snapshot_at) })}</time> : null}</li>
        })}</ul>
      </aside> : <p className="mt-6 text-xs text-muted-foreground">{t("aiChat.guide.noSources", { defaultValue: "This draft has no linked ERP sources. Check its guidance before relying on it." })}</p>}
      {saved && (guide.reviewEvidence || guide.compatibility === "unknown") ? <aside className="mt-6 space-y-2 rounded-lg border border-border p-4 text-xs text-muted-foreground" aria-label={t("aiChat.guide.verification", { defaultValue: "Guide verification" })}>
        <p>{guide.reviewState === "verified" ? t("aiChat.guide.independentReviews", { defaultValue: "This revision has the required independent evidence, domain and implementation reviews. Business actions still require current ERP checks." }) : t("aiChat.guide.reviewBoundary", { defaultValue: "Saving a guide does not verify it. Verification requires canonical evidence and independent reviews; changing the guide or its evidence invalidates prior approval." })}</p>
        {guide.reviewEvidence && guide.reviewEvidence.state !== "not_requested" ? <p>{t("aiChat.guide.reviewStatus", { defaultValue: "Review status: {{state}}", state: guide.reviewEvidence.state.replaceAll("_", " ") })}</p> : null}
        {guide.reviewEvidence?.reviews?.length ? <ul className="space-y-1">{guide.reviewEvidence.reviews.map((review) => <li key={review.kind} className="break-words">{t(`aiChat.guide.reviewKinds.${review.kind}`, { defaultValue: review.kind.replaceAll("_", " ") })}: {t(`aiChat.guide.reviewOutcomes.${review.outcome}`, { defaultValue: review.outcome })}<details className="mt-1"><summary>{review.reviewerName ?? t("aiChat.guide.reviewerUnavailable", { defaultValue: "Reviewer details unavailable" })}</summary><p>{review.reviewerName ? t("aiChat.guide.currentReviewerName", { defaultValue: "Name from the current authorized directory." }) : null}</p><code className="break-all">{review.reviewer}</code></details></li>)}</ul> : null}
        {guide.compatibility === "unknown" ? <p>{t("aiChat.guide.compatibilityUnknown", { defaultValue: "Product and workflow compatibility have not been established. Check applicability before following this guide." })}</p> : null}
        <GuideVerificationActions key={identity} document={guide} disabled={disabled || verificationUnavailable || dirty || guide.reviewState === "superseded"} onLoad={onLoadVerificationChoices} onNominate={onRequestVerification} onReview={onRecordReview} onPendingInput={setReviewInput} />
      </aside> : null}
    </div>
    <footer className="shrink-0 space-y-3 border-t border-border bg-muted/20 px-4 py-3 sm:px-6">
      {followUp ? <div role="status" className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-3 text-sm"><MarkdownView value={guideMarkdownWithoutHtml(followUp)} /></div> : null}
      {onAsk ? <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void ask() }}>
        <label className="min-w-0 flex-1" htmlFor={`${id}-question`}><span className="sr-only">{t("aiChat.guide.ask", { defaultValue: "Ask about this document" })}</span><Textarea variant="plain" id={`${id}-question`} placeholder={t("aiChat.guide.ask", { defaultValue: "Ask about this document" })} rows={2} value={question} disabled={disabled} onChange={(event) => setQuestion(event.target.value)} className="max-h-28 min-h-16 resize-none bg-background" /></label>
        <Button type="submit" disabled={disabled || verificationUnavailable || !question.trim()}>{pending === "ask" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{t("aiChat.guide.send", { defaultValue: "Send" })}</Button>
      </form> : null}
      {canSave ? <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{t("aiChat.guide.saveScope", { defaultValue: "Save to {{module}} · current company", module: filingLabel })}</span><Button disabled={disabled || verificationUnavailable || !title.trim() || !module.trim() || !markdown.trim() || (saved && !dirty)} onClick={() => void save()}>{pending === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}{saved ? t("aiChat.guide.saveRevision", { defaultValue: "Save new revision" }) : t("aiChat.guide.save", { defaultValue: "Save guide" })}</Button></div> : null}
    </footer>
  </section>
}

export interface AssistantGuideModalProps extends AssistantGuideViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AssistantGuideModal({ open, onOpenChange, ...viewer }: AssistantGuideModalProps) {
  const { t } = useTranslation()
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  return <><Dialog open={open} onOpenChange={(next) => {
    if (!next && dirty) { setConfirmClose(true); return }
    onOpenChange(next)
  }}>
    <DialogContent className="flex h-[min(900px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-full max-sm:rounded-none sm:max-w-5xl" showCloseButton>
      <DialogTitle className="sr-only">{viewer.document.title}</DialogTitle>
      <DialogDescription className="sr-only">{t("aiChat.guide.modalDescription", { defaultValue: "Read and save this guide without leaving your ERP task. Follow-up questions use the same conversation." })}</DialogDescription>
      <div className="flex min-h-0 flex-1 flex-col [&_header]:pr-14"><AssistantGuideViewer {...viewer} onDirtyChange={(next) => { setDirty(next); viewer.onDirtyChange?.(next) }} /></div>
    </DialogContent>
  </Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
      <AlertDialogContent>
        <AlertDialogTitle>{t("aiChat.guide.discardTitle", { defaultValue: "Discard unsaved changes?" })}</AlertDialogTitle>
        <AlertDialogDescription>{t("aiChat.guide.discardDescription", { defaultValue: "Your guide edits or unsent question will be discarded. Your ERP task stays as it is." })}</AlertDialogDescription>
        <AlertDialogFooter><AlertDialogCancel>{t("aiChat.guide.keepEditing", { defaultValue: "Keep editing" })}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { setConfirmClose(false); setDirty(false); onOpenChange(false) }}>{t("aiChat.guide.discard", { defaultValue: "Discard" })}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}

export interface AssistantGuideCardProps {
  title: string
  module?: string
  revision?: number
  onOpen: () => void
}

export function AssistantGuideCard({ title, module, revision, onOpen }: AssistantGuideCardProps) {
  const { t } = useTranslation()
  return <button type="button" onClick={onOpen} className="mt-3 flex w-full max-w-lg items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="assistant-guide-card">
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background"><FileText className="size-5 text-primary" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{module ? `${guideDisplayLabel(module)} · ` : ""}{revision ? t("aiChat.guide.savedRevision", { defaultValue: "Saved · revision {{revision}}", revision }) : t("aiChat.guide.unsavedDraft", { defaultValue: "Unsaved draft" })}</span></span>
    <span className="text-xs font-medium text-primary">{t("aiChat.guide.open", { defaultValue: "Open document" })}</span>
  </button>
}
