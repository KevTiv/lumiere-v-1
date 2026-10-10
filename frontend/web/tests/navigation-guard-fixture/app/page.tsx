"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useUnsavedChangesGuard } from "../../../../packages/ui/src/forms/use-unsaved-changes-guard"
import { EditableNumber } from "../../../../packages/ui/src/components/editable-number"

export default function Page() {
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [quantity, setQuantity] = useState(2)
  useUnsavedChangesGuard(draft !== "", pending)
  const router = useRouter()
  return <>
    <h1>Editor</h1>
    <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button onClick={() => router.push("/other")}>Push</button>
    <button onClick={() => router.replace("/other")}>Replace</button>
    <button onClick={() => router.back()}>Back</button>
    <button onClick={() => setPending(!pending)}>Toggle save</button>
    <button onClick={() => { history.pushState(history.state, "", "/?step=1"); history.pushState(history.state, "", "/?step=2") }}>Seed history</button>
    <Link href="/other">Next Link</Link>
    <EditableNumber aria-label="Quantity" value={quantity} onCommit={async (next) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      setQuantity(next)
    }} />
  </>
}
