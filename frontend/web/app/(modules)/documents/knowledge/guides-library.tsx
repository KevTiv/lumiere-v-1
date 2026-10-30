"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import type { GuideDocument } from "@lumiere/ui/lib/assistant-guide-types"
import { guidePageHref, guideReturnHref, listAssistantGuides } from "@/lib/assistant-guides"

export function AssistantGuidesLibrary() {
  const { organizationId } = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const params = useSearchParams()
  const { t } = useTranslation()
  const module = params.get("module") ?? ""
  const companyParam = params.get("companyId")
  const [query, setQuery] = useState("")
  const scope = `${organizationId}:${companyId}:${module}:${query}`
  const [result, setResult] = useState<{ scope: string; guides: GuideDocument[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inCompany = Boolean(companyId && (!companyParam || companyParam === String(companyId)))
  const rows = result?.scope === scope ? result.guides : null

  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    setError(null)
    if (!companyId || !inCompany) return
    const timer = window.setTimeout(() => {
      void listAssistantGuides(String(companyId), module || undefined, query, controller.signal).then((guides) => {
        if (!controller.signal.aborted) setResult({ scope, guides })
      }).catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Guides could not be loaded.")
      })
    }, 200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [companyId, inCompany, module, query, scope])

  return <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
    <header className="border-l-2 border-primary pl-4">
      <Link href="/documents?tab=knowledge-base" className="text-sm text-muted-foreground underline underline-offset-4">{t("aiChat.guide.backToDocuments", { defaultValue: "Documents and knowledge" })}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{t("aiChat.guide.savedGuides", { defaultValue: "Saved guides" })}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{module ? t("aiChat.guide.moduleLibrary", { defaultValue: "Guidance filed under {{module}} for the current company.", module }) : t("aiChat.guide.libraryDescription", { defaultValue: "Saved ERP explanations and procedures for the current company." })}</p>
    </header>
    <label className="block max-w-xl space-y-2 text-sm"><span>{t("aiChat.guide.search", { defaultValue: "Search guides" })}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} className="w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
    {!inCompany ? <p role="alert">{t("aiChat.guide.chooseCompany", { defaultValue: "Select the company this guide belongs to before opening it." })}</p>
      : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : rows === null ? <p role="status">{t("aiChat.guide.loadingLibrary", { defaultValue: "Loading saved guides…" })}</p>
      : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("aiChat.guide.emptyLibrary", { defaultValue: "No saved guides match this view. Open a substantial assistant answer and save it as a guide to find it here." })}</p>
      : <><p className="text-xs text-muted-foreground">{t("aiChat.guide.libraryBound", { defaultValue: "Showing up to 20 matching guides. Search to narrow the results." })}</p><ul className="divide-y divide-border rounded-xl border border-border">{rows.map((guide) => <li key={guide.guideId} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0"><Link className="break-words font-medium text-primary underline underline-offset-4" href={guidePageHref(guide, String(companyId), guideReturnHref(`/documents/knowledge?${params}`))}>{guide.title}</Link><p className="mt-1 text-xs text-muted-foreground">{guide.module}{guide.workflow ? ` / ${guide.workflow}` : ""} · {t("aiChat.guide.revision", { defaultValue: "Revision {{revision}}", revision: guide.revision })}</p></div>
        <span className="text-xs text-muted-foreground">{t(`aiChat.guide.${guide.reviewState === "draft" ? "reviewDraft" : guide.reviewState === "needs_review" ? "needsReview" : guide.reviewState}`, { defaultValue: guide.reviewState })}{guide.updatedAt ? ` · ${guide.updatedAt}` : ""}</span>
      </li>)}</ul></>}
  </section>
}
