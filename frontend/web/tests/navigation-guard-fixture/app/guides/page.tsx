"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AssistantGuideCard, AssistantGuideModal } from "../../../../../packages/ui/src/ai-chat/assistant-guide-viewer"
import { isSavedGuide } from "../../../../../packages/ui/src/lib/assistant-guide-types"
import { useUnsavedChangesGuard } from "../../../../../packages/ui/src/forms/use-unsaved-changes-guard"
import { useGuideFixture } from "./layout"

export default function Page() {
  const fixture = useGuideFixture()
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const router = useRouter()
  useUnsavedChangesGuard(draft !== "")
  const saved = isSavedGuide(fixture.document)

  return <main className="grid min-h-[90dvh] gap-4 p-4 md:grid-cols-[minmax(0,1fr)_22rem]">
    <span className="sr-only" data-testid="guide-fixture-ready">{ready ? "Ready" : "Loading"}</span>
    <section aria-label="ERP record" className="rounded-lg border p-4">
      <h1 className="mb-4 text-xl">Vendor bill VB-1042</h1>
      <label className="block">ERP draft description<input className="mt-2 block w-full rounded border p-2" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="mt-3 rounded border p-2" onClick={() => setDraft("")}>Clear ERP draft</button>
      <label className="mt-4 block"><input type="checkbox" checked={fixture.failSave} onChange={(event) => fixture.setFailSave(event.target.checked)} /> Simulate guide save failure</label>
    </section>
    <aside aria-label="Contextual side chat" className="rounded-lg border p-4">
      <h2 className="font-medium">Accounting / Vendor bill VB-1042</h2>
      <p className="mt-4">Check the bill details and accounting period before posting.</p>
      <AssistantGuideCard title={fixture.document.title} module={fixture.document.module} revision={isSavedGuide(fixture.document) ? fixture.document.revision : undefined} onOpen={() => setOpen(true)} />
    </aside>
    <AssistantGuideModal
      open={open}
      onOpenChange={setOpen}
      document={fixture.document}
      onSave={fixture.save}
      onAsk={fixture.ask}
      onOpenFullPage={() => {
        void (async () => {
          if (!saved) await fixture.save(fixture.document)
          setOpen(false)
          setTimeout(() => router.push("/guides/full"), 0)
        })()
      }}
    />
  </main>
}
