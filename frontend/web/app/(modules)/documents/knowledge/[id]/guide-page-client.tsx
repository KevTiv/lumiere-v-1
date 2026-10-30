"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { AssistantGuideViewer } from "@lumiere/ui"
import { useUnsavedChangesGuard } from "@lumiere/ui/forms/use-unsaved-changes-guard"
import type { GuideDocument } from "@lumiere/ui/lib/assistant-guide-types"
import { useAssistantGuideConversation } from "@/lib/assistant-guide-context"
import { assistantGuideHistory, guideAccessRevoked, guideId as parseGuideId, guideLibraryHref, guideReturnHref, guideRevision, guideSaveRequestKey, readAssistantGuide, saveAssistantGuide } from "@/lib/assistant-guides"

export function AssistantGuidePageClient({ guideId }: { guideId: string }) {
  const { organizationId, identity } = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const { t } = useTranslation()
  const params = useSearchParams()
  const router = useRouter()
  const conversation = useAssistantGuideConversation()
  const revisionRaw = params.get("revision")
  const revision = revisionRaw === null ? undefined : guideRevision(revisionRaw)
  const companyParam = params.get("companyId")
  const scope = `${identity ?? ""}:${organizationId}:${companyId}:${guideId}:${revision ?? "head"}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const sequence = useRef(0)
  const [state, setState] = useState<{ scope: string; document: GuideDocument } | null>(null)
  const [history, setHistory] = useState<GuideDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [verificationUnavailable, setVerificationUnavailable] = useState(false)
  const retryVerification = useRef<(() => void) | null>(null)
  const verificationRead = useRef(0)
  const navigationGuard = useUnsavedChangesGuard(dirty, saving)
  const guide = state?.scope === scope ? state.document : null
  const latestDocument = useRef(guide)
  latestDocument.current = guide
  const inCompany = Boolean(companyId && (!companyParam || companyParam === String(companyId)))

  useEffect(() => {
    const epoch = ++sequence.current
    const controller = new AbortController()
    setState(null)
    setHistory([])
    setError(null)
    setBusy(false)
    setVerificationUnavailable(false)
    if (!inCompany || !companyId || !parseGuideId(guideId) || revision === null) return
    // Discover an unpinned link once; focus checks must retain its exact revision.
    let loadedRevision = revision
    const load = async () => {
      const attempt = ++verificationRead.current
      const pinnedRevision = latestDocument.current?.revision ?? loadedRevision
      const reference = { guideId, ...(pinnedRevision === undefined ? {} : { revision: pinnedRevision }) }
      try {
        const document = await readAssistantGuide(reference, String(companyId), controller.signal)
        if (!controller.signal.aborted && attempt === verificationRead.current && epoch === sequence.current && currentScope.current === scope) {
          loadedRevision = document.revision
          setState({ scope, document }); setVerificationUnavailable(false); setError(null)
        }
      } catch (cause) {
        if (attempt === verificationRead.current && !controller.signal.aborted) throw cause
      }
    }
    setBusy(true)
    void load().catch((cause) => {
      if (!controller.signal.aborted && epoch === sequence.current) setError(cause instanceof Error ? cause.message : "The guide is unavailable.")
    }).finally(() => { if (epoch === sequence.current) setBusy(false) })
    void assistantGuideHistory({ guideId, revision: revision ?? 1 }, String(companyId), controller.signal).then((documents) => {
      if (epoch === sequence.current && currentScope.current === scope) setHistory(documents)
    }).catch(() => { if (epoch === sequence.current) setHistory([]) })
    const revalidate = () => {
      void load().catch((cause) => {
        if (!controller.signal.aborted && epoch === sequence.current && currentScope.current === scope) {
          if (guideAccessRevoked(cause)) { setState(null); setHistory([]) }
          else setVerificationUnavailable(true)
          setError(guideAccessRevoked(cause) ? "This guide is no longer available in your current access scope." : "The guide's current access could not be checked. Your edits are retained. Retry before saving or asking a question.")
        }
      })
    }
    retryVerification.current = revalidate
    window.addEventListener("focus", revalidate)
    const interval = window.setInterval(revalidate, 30_000)
    return () => { retryVerification.current = null; controller.abort(); ++sequence.current; clearInterval(interval); window.removeEventListener("focus", revalidate) }
  }, [companyId, guideId, inCompany, revision, scope])

  const backHref = guideReturnHref(params.get("returnTo"))
  const changeRevision = (nextRevision: number) => {
    const query = new URLSearchParams(params.toString())
    query.set("revision", String(nextRevision))
    router.replace(`/documents/knowledge/${guideId}?${query}`)
  }

  return <div className="flex min-h-[calc(100dvh-5rem)] min-w-0 flex-col p-4 sm:p-6">
    {navigationGuard}
    <nav className="mb-4 flex flex-wrap items-center gap-4 text-sm">
      <Link href={backHref} className="text-primary underline underline-offset-4">{t("aiChat.guide.backToTask", { defaultValue: "Back to task" })}</Link>
      <Link href={companyId ? guideLibraryHref(String(companyId), guide?.module) : "/documents"} className="text-muted-foreground underline underline-offset-4">{t("aiChat.guide.savedGuides", { defaultValue: "Saved guides" })}</Link>
    </nav>
    {!inCompany ? <p role="alert">{t("aiChat.guide.chooseCompany", { defaultValue: "Select the company this guide belongs to before opening it." })}</p>
      : !parseGuideId(guideId) || revision === null ? <p role="alert">{t("aiChat.guide.invalidReference", { defaultValue: "This guide link is invalid." })}</p>
      : guide ? <div className="flex h-[calc(100dvh-10rem)] min-h-96 flex-col overflow-hidden rounded-xl border border-border bg-background">
        <AssistantGuideViewer document={guide} history={history} busy={busy} error={error} onDirtyChange={setDirty}
          verificationUnavailable={verificationUnavailable} onRetryVerification={() => retryVerification.current?.()}
          onRevisionChange={changeRevision}
          onAsk={conversation.ready ? async (question, draftOverride) => {
            const epoch = sequence.current
            if (verificationUnavailable) throw new Error("Retry the guide access check before asking.")
            await readAssistantGuide(guide, guide.companyId)
            if (epoch !== sequence.current || currentScope.current !== scope) throw new Error("The company changed. Reopen the guide before asking.")
            const answer = await conversation.ask(guide, question, draftOverride)
            if (epoch !== sequence.current || currentScope.current !== scope) throw new Error("The conversation scope changed.")
            return answer
          } : undefined}
          onSave={async (draft, expectedRevision) => {
            const epoch = sequence.current
            if (verificationUnavailable) throw new Error("Retry the guide access check before saving.")
            if (currentScope.current !== scope || draft.companyId !== String(companyId)) throw new Error("The company changed. Reopen the guide before saving.")
            const reference = { guideId, revision: expectedRevision ?? guide.revision }
            setSaving(true)
            try {
              const document = await saveAssistantGuide(draft, guideSaveRequestKey(draft, reference), reference)
              if (epoch !== sequence.current || currentScope.current !== scope) throw new Error("The company changed while saving. Reopen the guide to check its revision.")
              ++verificationRead.current
              latestDocument.current = document
              setState({ scope, document })
              setDirty(false)
              setSaving(false)
              // Let registered navigation-guard state observe the acknowledged save first.
              window.setTimeout(() => {
                if (currentScope.current === scope) changeRevision(document.revision)
              }, 0)
              return document
            } finally { setSaving(false) }
          }} />
      </div>
      : error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p><button type="button" className="text-sm text-primary underline" onClick={() => retryVerification.current?.()}>{t("aiChat.guide.retryAccess", { defaultValue: "Retry access check" })}</button></div>
      : <p role="status" className="text-sm text-muted-foreground">{t("aiChat.guide.loading", { defaultValue: "Loading the guide in your current access scope…" })}</p>}
  </div>
}
