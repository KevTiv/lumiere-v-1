"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import type { GuideDocument, GuideDraft } from "../../../../../packages/ui/src/lib/assistant-guide-types"

export const fixtureGuide: GuideDraft = {
  draftKey: "ui-fixture-bill-guide",
  title: "Resolve a bill posting error",
  markdown: "# Check the vendor bill\n\n1. Review the bill details.\n2. Check the selected accounting period.\n\nThe bill remains a draft until you review and post it.",
  html: '<h1>Static bill guide</h1><p>Review before posting.</p><script>parent.__guideProbe = true; fetch("https://guide-probe.invalid/script")</script><img src="https://guide-probe.invalid/image"><form action="https://guide-probe.invalid/form"><button>Submit</button></form><a href="javascript:parent.__guideProbe=true">Unsafe action</a><div style="background-image:url(https://guide-probe.invalid/style)">Static content</div>',
  module: "accounting",
  workflow: "vendor-bills",
  companyId: "7",
  sources: [{ kind: "live", trust: "authoritative", entity_type: "account_move", entity_id: "1042", label: "Vendor bill VB-1042", href: "/accounting/invoices/1042", snapshot_at: "2026-10-28T12:00:00Z" }],
}

interface FixtureState {
  document: GuideDraft | GuideDocument
  save: (draft: GuideDraft, expectedRevision?: number) => Promise<GuideDocument>
  ask: (question: string) => Promise<string>
  questions: string[]
  failSave: boolean
  setFailSave: (fail: boolean) => void
}

const FixtureContext = createContext<FixtureState | null>(null)

export function useGuideFixture() {
  const fixture = useContext(FixtureContext)
  if (!fixture) throw new Error("Missing guide UI fixture provider")
  return fixture
}

export default function Layout({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState<GuideDraft | GuideDocument>(fixtureGuide)
  const [questions, setQuestions] = useState<string[]>([])
  const [failSave, setFailSave] = useState(false)

  async function save(draft: GuideDraft, expectedRevision?: number): Promise<GuideDocument> {
    if (failSave) throw new Error("Fixture storage unavailable. Your edits are retained.")
    const saved: GuideDocument = {
      ...draft,
      guideId: "42",
      revision: (expectedRevision ?? 0) + 1,
      reviewState: "draft",
      canWrite: true,
      updatedAt: "2026-10-28T12:01:00Z",
    }
    setDocument(saved)
    return saved
  }

  async function ask(question: string): Promise<string> {
    setQuestions((current) => [...current, question])
    return `Same fixture conversation: ${question}`
  }

  return <FixtureContext.Provider value={{ document, save, ask, questions, failSave, setFailSave }}>
    <p className="p-2 text-xs">UI fixture only: guide saves use in-memory callbacks.</p>
    <p className="px-2 text-xs" data-testid="guide-fixture-session">Fixture conversation: {questions.length} questions</p>
    {children}
  </FixtureContext.Provider>
}
