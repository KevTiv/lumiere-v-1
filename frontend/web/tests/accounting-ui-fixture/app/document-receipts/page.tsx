"use client"

import { useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { DocumentUploadReceipts } from "../../../../components/document-upload-receipts"
import { useDocumentUploadReceipts } from "../../../../lib/use-document-upload-receipts"

function Fixture() {
  const [message, setMessage] = useState("")
  const receipts = useDocumentUploadReceipts({
    scope: { organizationId: 7n, companyId: 3n, actorId: "ab".repeat(32) },
    allowed: true,
    assertCurrent: () => undefined,
    create: async (params) => {
      const response = await fetch("/fixture/register-document", { method: "POST", body: JSON.stringify(params, (_, value) => typeof value === "bigint" ? String(value) : value) })
      if (!response.ok) throw new Error("Registration reply lost; check the receipt")
      return response.json()
    },
    index: async (documentId) => {
      const response = await fetch("/api/ai/evidence/ingestion/documents", { method: "POST", body: JSON.stringify({ companyId: 3, documentId }) })
      if (!response.ok) throw new Error("Indexing unavailable")
    },
  })
  return <main className="mx-auto max-w-4xl p-6">
    <p className="mb-4 text-sm">Synthetic transport fixture using the production upload coordinator and receipt panel. No live ERP writes.</p>
    <label>Source file<input type="file" aria-label="Source file" onChange={async (event) => {
      const file = event.currentTarget.files?.[0]
      if (!file) return
      setMessage("")
      try {
        await receipts.submit(file, { name: "Farm source", tagIds: [], isFavorite: false })
        setMessage("Document saved")
      } catch (error) { setMessage(error instanceof Error ? error.message : "Save status unavailable") }
    }} /></label>
    <output className="my-4 block">{message}</output>
    <DocumentUploadReceipts rows={receipts.rows} error={receipts.error} onResume={receipts.resume} />
  </main>
}

export default function Page() {
  return <I18nProvider language="en"><ThemeProvider defaultTheme="light"><Fixture /></ThemeProvider></I18nProvider>
}
