"use client"

import { useRouter } from "next/navigation"
import { AssistantGuideViewer } from "../../../../../../packages/ui/src/ai-chat/assistant-guide-viewer"
import { useGuideFixture } from "../layout"

export default function Page() {
  const fixture = useGuideFixture()
  const router = useRouter()
  return <main className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col">
    <button className="m-2 w-fit rounded border p-2" onClick={() => router.push("/guides")}>Back to ERP task</button>
    <AssistantGuideViewer document={fixture.document} onSave={fixture.save} onAsk={fixture.ask} />
  </main>
}
