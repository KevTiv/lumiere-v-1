"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AssistantGuideModal } from "@lumiere/ui"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@lumiere/ui/components/dialog"
import { useTranslation } from "@lumiere/i18n"
import { isSavedGuide, type GuideDraft, type GuideDocument, type GuideReference, type OpenGuideRequest } from "@lumiere/ui/lib/assistant-guide-types"
import { assistantGuideHistory, guidePageHref, guideSaveRequestKey, readAssistantGuide, saveAssistantGuide } from "@/lib/assistant-guides"
import { AI_WORKSPACE_SCOPES } from "@/lib/ai-workspace-scope"

const GUIDE_MODULE_OPTIONS = AI_WORKSPACE_SCOPES.filter((option) => option.value.startsWith("module:")).map((option) => ({ value: option.value.slice(7), label: option.label }))

export function AssistantGuideHost({ request, companyId, organizationId, onClose, onSaved, onAsk }: {
  request: OpenGuideRequest | null
  companyId?: number
  organizationId: number
  onClose: () => void
  onSaved: (guide: GuideDocument) => Promise<void>
  onAsk: (guide: GuideDraft | GuideDocument, question: string, draftOverride?: GuideDraft) => Promise<string>
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const scope = `${organizationId}:${companyId ?? ""}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const generation = useRef(0)
  const [state, setState] = useState<{ scope: string; document: GuideDraft | GuideDocument } | null>(null)
  const [history, setHistory] = useState<GuideDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const document = state?.scope === scope ? state.document : null

  useEffect(() => {
    const epoch = ++generation.current
    const controller = new AbortController()
    setState(null)
    setHistory([])
    setError(null)
    setBusy(false)
    if (!request || !companyId || !organizationId) return
    if (request.reference) {
      setBusy(true)
      void readAssistantGuide(request.reference, String(companyId), controller.signal).then((guide) => {
        if (epoch === generation.current && currentScope.current === scope) setState({ scope, document: guide })
      }).catch((cause) => {
        if (!controller.signal.aborted && epoch === generation.current) setError(cause instanceof Error ? cause.message : "The guide is unavailable.")
      }).finally(() => { if (epoch === generation.current) setBusy(false) })
    } else if (request.draft?.companyId === String(companyId)) {
      setState({ scope, document: request.draft })
    } else {
      setError(t("aiChat.guide.scopeChanged", { defaultValue: "The company changed. Open the guide again from the current company." }))
    }
    return () => { controller.abort(); ++generation.current }
  }, [request, scope, companyId, organizationId, t])

  useEffect(() => {
    if (!request || !document || !isSavedGuide(document) || !companyId) return
    const reference = { guideId: document.guideId, revision: document.revision }
    const controller = new AbortController()
    const epoch = generation.current
    void assistantGuideHistory(reference, String(companyId), controller.signal).then((guides) => {
      if (epoch === generation.current && currentScope.current === scope) setHistory(guides)
    }).catch(() => { if (epoch === generation.current) setHistory([]) })
    const revalidate = () => {
      void readAssistantGuide(reference, String(companyId), controller.signal).then((guide) => {
        if (epoch === generation.current && currentScope.current === scope) setState({ scope, document: guide })
      }).catch((cause) => {
        if (!controller.signal.aborted && epoch === generation.current) {
          setState(null)
          setHistory([])
          setError(cause instanceof Error ? cause.message : "The guide is unavailable.")
        }
      })
    }
    window.addEventListener("focus", revalidate)
    const interval = window.setInterval(revalidate, 30_000)
    return () => { controller.abort(); window.removeEventListener("focus", revalidate); clearInterval(interval) }
  }, [request, document && isSavedGuide(document) ? `${document.guideId}:${document.revision}` : null, companyId, scope])

  const save = useCallback(async (draft: GuideDraft, expectedRevision?: number) => {
    const epoch = generation.current
    if (draft.companyId !== String(companyId) || !document || currentScope.current !== scope) throw new Error("The company changed. Open the guide again.")
    const reference = isSavedGuide(document) ? { guideId: document.guideId, revision: expectedRevision ?? document.revision } : undefined
    setBusy(true)
    setError(null)
    try {
      const guide = await saveAssistantGuide(draft, guideSaveRequestKey(draft, reference), reference)
      if (epoch !== generation.current || currentScope.current !== scope) throw new Error("The company changed while saving. Reopen the guide to check its saved revision.")
      setState({ scope, document: guide })
      // A failed chat-link append must not turn an acknowledged document save into a failed save.
      try { await onSaved(guide) } catch { setError(t("aiChat.guide.linkSaveFailed", { defaultValue: "The guide was saved. Its conversation link could not be saved; find it in Saved guides." })) }
      return guide
    } finally { if (epoch === generation.current) setBusy(false) }
  }, [companyId, document, onSaved, scope, t])

  const openFullPage = async (reference?: GuideReference) => {
    if (!document) return
    try {
      const guide = reference ?? await save(document)
      if (currentScope.current !== scope) return
      const href = guidePageHref(guide, String(companyId), `${window.location.pathname}${window.location.search}${window.location.hash}`)
      // The shared navigation guard owns any outstanding ERP editor before routing.
      onClose()
      // Let the modal release its focus trap before the shared navigation guard opens a confirmation.
      window.setTimeout(() => router.push(href), 0)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The guide could not be opened.") }
  }

  if (!request) return null
  if (!document) return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent>
      <DialogTitle>{t("aiChat.guide.document", { defaultValue: "ERP guide" })}</DialogTitle>
      <DialogDescription>{busy ? t("aiChat.guide.loading", { defaultValue: "Loading the guide in your current access scope…" }) : error ?? t("aiChat.guide.unavailable", { defaultValue: "This guide is unavailable in the current company." })}</DialogDescription>
    </DialogContent>
  </Dialog>

  return <AssistantGuideModal open onOpenChange={(open) => { if (!open) onClose() }}
    document={document} onSave={save} busy={busy} error={error} history={history}
    moduleOptions={GUIDE_MODULE_OPTIONS}
    onAsk={(question, draftOverride) => onAsk(document, question, draftOverride)}
    onOpenFullPage={(reference) => { void openFullPage(reference) }}
    onRevisionChange={async (revision) => {
      if (!isSavedGuide(document) || !companyId) return
      const epoch = ++generation.current
      setBusy(true)
      setError(null)
      try {
        const guide = await readAssistantGuide({ guideId: document.guideId, revision }, String(companyId))
        if (epoch === generation.current && currentScope.current === scope) setState({ scope, document: guide })
      } catch (cause) {
        if (epoch === generation.current) { setState(null); setError(cause instanceof Error ? cause.message : "The revision could not be loaded.") }
      } finally { if (epoch === generation.current) setBusy(false) }
    }} />
}
