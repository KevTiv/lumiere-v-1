"use client"

import { useEffect, useId, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Checkbox } from "../components/checkbox"
import { Textarea } from "../components/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"
import type { GuideDocument, GuideReviewInput, GuideVerificationChoice, GuideVerificationInput } from "../lib/assistant-guide-types"

export function GuideVerificationActions({ document, disabled, onLoad, onNominate, onReview, onPendingInput }: {
  document: GuideDocument
  disabled: boolean
  onLoad?: () => Promise<GuideVerificationChoice[]>
  onNominate?: (input: GuideVerificationInput) => Promise<void>
  onReview?: (input: GuideReviewInput) => Promise<void>
  onPendingInput?: (pending: boolean) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [choices, setChoices] = useState<GuideVerificationChoice[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<GuideReviewInput["reviewKind"]>("source_fidelity")
  const [outcome, setOutcome] = useState<GuideReviewInput["outcome"] | "">("")
  const [note, setNote] = useState("")
  const canNominate = document.reviewEvidence?.canNominate && onLoad && onNominate
  const canReview = document.reviewEvidence?.canReview && onReview && document.reviewEvidence.state !== "approved"
  const busy = disabled || pending
  useEffect(() => { onPendingInput?.(selected.length>0 || outcome!=="" || note.trim()!=="") }, [selected, outcome, note, onPendingInput])

  async function perform(action: () => Promise<void>) {
    setPending(true); setError(null)
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("aiChat.guide.reviewFailed", { defaultValue: "The review could not be saved. Check the current guide before retrying." })) }
    finally { setPending(false) }
  }

  return <div className="mt-3 space-y-3">
    {canNominate ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void perform(async () => { const next=await onLoad!();setChoices(next);setSelected((current)=>current.filter((value)=>next.some((choice)=>choice.decisionId===value)));setExpanded(true) })}>{t("aiChat.guide.requestVerification", { defaultValue: "Request verification" })}</Button> : null}
    {expanded && canNominate && choices ? <div className="space-y-3">
      <p>{t("aiChat.guide.selectEvidence", { defaultValue: "Choose reviewed evidence already linked to this revision. The request creates a private review candidate; it does not approve or execute this guide." })}</p>
      {choices.length ? choices.map((choice) => <div key={choice.decisionId} className="space-y-1 rounded-md border border-border p-3">
        <label htmlFor={`${id}-${choice.decisionId}`} className="flex items-start gap-2 font-medium"><Checkbox id={`${id}-${choice.decisionId}`} aria-label={choice.title} checked={selected.includes(choice.decisionId)} disabled={busy} onCheckedChange={(checked) => setSelected((current) => checked ? [...current.filter((value)=>value!==choice.decisionId),choice.decisionId] : current.filter((value)=>value!==choice.decisionId))} />{choice.title}</label>
        <p>{choice.summary}</p><p>{choice.sourceLabels.join(" · ")}</p>
        {BigInt(choice.decisionId)<=BigInt(Number.MAX_SAFE_INTEGER) ? <a className="text-primary underline" target="_blank" rel="noopener noreferrer" href={`/ai-harness?${new URLSearchParams({ tab:"evidence-reviewer",kind:"decision",id:choice.decisionId,companyId:document.companyId })}`}>{t("aiChat.guide.inspectEvidence", { defaultValue: "Inspect this evidence" })}</a> : null}
      </div>) : <p role="status">{t("aiChat.guide.noReviewEvidence", { defaultValue: "No current reviewed evidence is linked to this revision. Review its sources and justifying decision before requesting verification." })}</p>}
      {choices.length ? <Button type="button" size="sm" disabled={busy || !selected.length} onClick={() => void perform(async () => {
        const chosen = choices.filter((choice)=>selected.includes(choice.decisionId))
        await onNominate!({ sourcePassageIds:[...new Set(chosen.flatMap((choice)=>choice.sourcePassageIds))],claimIds:[...new Set(chosen.flatMap((choice)=>choice.claimIds))],decisionIds:chosen.map((choice)=>choice.decisionId) })
        setSelected([]); setExpanded(false)
      })}>{t("aiChat.guide.submitVerification", { defaultValue: "Submit this revision for review" })}</Button> : null}
    </div> : null}
    {canReview ? <>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>setExpanded((current)=>!current)}>{t("aiChat.guide.recordReview", { defaultValue: "Record independent review" })}</Button>
      {expanded ? <div className="space-y-3">
        <Select value={kind} disabled={busy} onValueChange={(value)=>{ if (["source_fidelity","domain_interpretation","implementation"].includes(value)) setKind(value as GuideReviewInput["reviewKind"]) }}><SelectTrigger aria-label={t("aiChat.guide.reviewKind", { defaultValue: "Review kind" })}><SelectValue /></SelectTrigger><SelectContent>{["source_fidelity","domain_interpretation","implementation"].map((value)=><SelectItem key={value} value={value}>{t(`aiChat.guide.reviewKinds.${value}`,{defaultValue:value.replaceAll("_"," ")})}</SelectItem>)}</SelectContent></Select>
        <Select value={outcome} disabled={busy} onValueChange={(value)=>{if(value==="accepted" || value==="rejected")setOutcome(value)}}><SelectTrigger aria-label={t("aiChat.guide.reviewOutcome",{defaultValue:"Review outcome"})}><SelectValue placeholder={t("aiChat.guide.chooseOutcome",{defaultValue:"Choose a verdict"})} /></SelectTrigger><SelectContent><SelectItem value="accepted">{t("aiChat.guide.reviewOutcomes.accepted",{defaultValue:"Accepted"})}</SelectItem><SelectItem value="rejected">{t("aiChat.guide.reviewOutcomes.rejected",{defaultValue:"Rejected"})}</SelectItem></SelectContent></Select>
        <label htmlFor={`${id}-note`} className="block">{t("aiChat.guide.reviewNote",{defaultValue:"Review note"})}<Textarea id={`${id}-note`} value={note} maxLength={2000} disabled={busy} onChange={(event)=>setNote(event.target.value)} /></label>
        <Button type="button" size="sm" disabled={busy || !outcome} onClick={()=>{if(outcome)void perform(async()=>{await onReview!({reviewKind:kind,outcome,note:note.trim() || undefined});setNote("");setOutcome("");setExpanded(false)})}}>{t("aiChat.guide.saveReview",{defaultValue:"Save review"})}</Button>
      </div> : null}
    </> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>
}
