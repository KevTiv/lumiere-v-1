"use client"

import { useEffect, useState } from "react"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { DocumentViewerDialog } from "../../../../components/document-viewer-dialog"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import {
  FileBrowser,
  type FileBrowserState,
} from "../../../../../packages/ui/src/documents/file-browser"
import { RecordAttachmentsPanel } from "../../../../../packages/ui/src/documents/record-attachments-panel"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"

const api = createLumiereApiClient({ baseUrl: "" })
const files = [
  {
    id: "1",
    name: "Farm records",
    fileName: "records.csv",
    mimetype: "text/csv",
    size: 64,
    folderId: null,
    updatedAt: 1794096000000,
    modifiedBy: "Synthetic viewer",
  },
  {
    id: "2",
    name: "Supplier PDF",
    fileName: "supplier.pdf",
    mimetype: "application/pdf",
    size: 100,
    folderId: null,
    updatedAt: 1794096000000,
    modifiedBy: "Synthetic viewer",
  },
  {
    id: "3",
    name: "Field photo",
    fileName: "field.png",
    mimetype: "image/png",
    size: 100,
    folderId: null,
    updatedAt: 1794096000000,
    modifiedBy: "Synthetic viewer",
  },
  {
    id: "4",
    name: "Visit notes",
    fileName: "notes.md",
    mimetype: "text/markdown",
    size: 100,
    folderId: null,
    updatedAt: 1794096000000,
    modifiedBy: "Synthetic viewer",
  },
  {
    id: "5",
    name: "Season workbook",
    fileName: "season.xlsx",
    mimetype:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 100,
    folderId: null,
    updatedAt: 1794096000000,
    modifiedBy: "Synthetic viewer",
  },
  {
    id: "6",
    name: "Delimited records",
    fileName: "delimited.csv",
    mimetype: "text/csv",
    size: 100,
    folderId: null,
    updatedAt: 1794096000000,
    modifiedBy: "Synthetic viewer",
  },
  {
    id: "7",
    name: "Malformed records",
    fileName: "malformed.csv",
    mimetype: "text/csv",
    size: 100,
    folderId: null,
    updatedAt: 1794096000000,
    modifiedBy: "Synthetic viewer",
  },
]
const actor = {
  id: "document-viewer-fixture",
  name: "Synthetic viewer",
  email: "viewer@example.test",
  roles: [],
  status: "active" as const,
  createdAt: "2026-11-08",
  updatedAt: "2026-11-08",
  isSuperuser: true,
}

function ViewerFixture() {
  const [hydrated, setHydrated] = useState(false)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [browser, setBrowser] = useState<FileBrowserState>({
    folderId: null,
    search: "",
    layout: "list",
    selectedFileId: null,
  })
  useEffect(() => setHydrated(true), [])
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4">
      <p data-testid="document-viewer-disclosure" data-hydrated={hydrated}>
        Synthetic file viewer fixture. Production components with mocked HTTP
        responses; no authentication or ERP operations.
      </p>
      <section aria-label="Documents entry point" className="space-y-3">
        <h1 className="text-xl font-semibold">Documents</h1>
        <FileBrowser
          folders={[]}
          files={files}
          state={browser}
          onStateChange={setBrowser}
          onOpenFile={setDocumentId}
        />
      </section>
      <section aria-label="ERP attachment entry point">
        <RecordAttachmentsPanel
          title="Invoice attachments"
          resModel="account_move"
          resId={41}
          documents={files.map((file) => ({
            ...file,
            resModel: "account_move",
            resId: 41,
          }))}
          onOpen={setDocumentId}
          onUpload={async () => {
            throw new Error("Uploads are disabled in this fixture")
          }}
          disabled
        />
      </section>
      <DocumentViewerDialog
        organizationId={7n}
        documentId={documentId}
        onOpenChange={(open) => {
          if (!open) setDocumentId(null)
        }}
      />
    </main>
  )
}

export default function Page() {
  return (
    <I18nProvider language="en">
      <ThemeProvider
        defaultTheme="light"
        storageKey="lumiere-document-viewer-fixture"
      >
        <LumiereApiProvider client={api}>
          <ErpSessionProvider
            value={{
              identity: actor.id,
              organizationId: 7,
              companyIds: [3],
              connected: true,
            }}
          >
            <RBACProvider initialUser={actor}>
              <ViewerFixture />
            </RBACProvider>
          </ErpSessionProvider>
        </LumiereApiProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
