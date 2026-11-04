"use client"

import { useEffect, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { Button } from "../../../../../packages/ui/src/components/button"
import { RunLifecyclePanel } from "../../../../app/(modules)/ai-harness/run-lifecycle-panel"
import { EvidenceReviewerPanel } from "../../../../app/(modules)/ai-harness/evidence-reviewer-panel"

const companies = [{ id: 7, name: "Synthetic review company", currencyId: 1 }]

function HarnessInspectorFixture() {
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<"runs" | "evidence">("runs")
  useEffect(() => setReady(true), [])
  return <main className="mx-auto flex min-w-0 max-w-5xl flex-col gap-4 p-3 sm:p-6 [overflow-wrap:anywhere]">
    <p data-testid="harness-inspector-fixture" data-ready={ready} className="text-xs text-muted-foreground">Synthetic AI inspection UI. Browser fixtures supply authorized read responses; no live ERP data or saved effects.</p>
    <div className="flex flex-wrap gap-3"><Button onClick={() => setView("runs")}>Review runs</Button><Button onClick={() => setView("evidence")}>Review evidence</Button></div>
    {view === "runs" ? <RunLifecyclePanel companies={companies} /> : <EvidenceReviewerPanel companies={companies} />}
  </main>
}

export default function Page() {
  return <I18nProvider language="en"><ThemeProvider defaultTheme="light"><HarnessInspectorFixture /></ThemeProvider></I18nProvider>
}
