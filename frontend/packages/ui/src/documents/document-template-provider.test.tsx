import * as React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  DocumentTemplateRow,
  DocumentTemplatesScope
} from "@lumiere/query-hooks/hooks/templates"

import { DocumentTemplateProvider } from "../../../../web/app/document-template-provider"
import { useRichTextTemplates } from "../components/rich-text-template-provider"
import {
  createDocumentDesignerSnapshot,
  mergeDocumentDesignerMetadata,
  type DocumentDesignerKind
} from "../lib/document-template-designer"

type SessionState = {
  identity: string | null
  organizationId: number | undefined
  activeCompanyId: number | null | undefined
  activeCompanyReady: boolean
  companyIds: number[]
}

type QueryState = {
  data?: DocumentTemplateRow[]
  isError: boolean
  isFetching: boolean
}

const mocks = vi.hoisted(() => ({
  session: {} as SessionState,
  currentUser: null as { id: string } | null,
  permissionsReady: true,
  allowed: true,
  checkPermission: vi.fn(),
  query: vi.fn(),
  refetch: vi.fn(),
  mounted: vi.fn(),
  cache: new Map<string, QueryState>()
}))

vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => mocks.session
}))

vi.mock("@lumiere/ui/lib/rbac-context", () => ({
  useRBAC: () => ({
    currentUser: mocks.currentUser,
    permissionsReady: mocks.permissionsReady,
    checkPermission: mocks.checkPermission
  })
}))

vi.mock("@lumiere/query-hooks/hooks/templates", () => ({
  useDocumentTemplates: (...args: unknown[]) => mocks.query(...args)
}))

// Model React Query's separate identity/company cache entries. Disabling a
// query retains its cached data; changing its key never returns another scope.
function cacheKey(organizationId: number, scope: DocumentTemplatesScope) {
  return JSON.stringify([scope.identity, organizationId, scope.companyId])
}

function activeScope() {
  return {
    identity: mocks.session.identity,
    companyId: mocks.session.activeCompanyId
  }
}

function cacheResult(data: DocumentTemplateRow[], error = false) {
  mocks.cache.set(cacheKey(mocks.session.organizationId ?? 0, activeScope()), {
    data,
    isError: error,
    isFetching: false
  })
}

function metadata(
  kind: DocumentDesignerKind = "rich-text",
  content = "Canonical text"
) {
  const snapshot = createDocumentDesignerSnapshot(kind, {
    assets: [],
    styles: [],
    pages: [
      {
        frames: [
          {
            component: {
              type: "wrapper",
              components: [{ type: "text", tagName: "p", content }]
            }
          }
        ]
      }
    ]
  })
  return mergeDocumentDesignerMetadata(null, snapshot.designer)
}

function template(
  overrides: Partial<DocumentTemplateRow> = {}
): DocumentTemplateRow {
  return {
    id: "1",
    organizationId: 7,
    companyId: 11,
    name: "Greeting",
    isActive: true,
    bodyHtml: "<p>Stale exported HTML</p>",
    metadata: metadata(),
    ...overrides
  }
}

function Consumer() {
  const source = useRichTextTemplates()
  const [draft, setDraft] = React.useState("Existing draft")
  React.useEffect(() => {
    mocks.mounted()
  }, [])
  return (
    <>
      <input
        aria-label="Unrelated draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <output aria-label="Template status">
        {source?.status ?? "disabled"}
      </output>
      <output aria-label="Template scope">{source?.scopeKey}</output>
      {source ? (
        <button type="button" onClick={source.onRequest}>
          Request templates
        </button>
      ) : null}
      {source?.error ? <p role="alert">{source.error}</p> : null}
      <ul aria-label="Template choices">
        {source?.templates.map((choice) => (
          <li key={choice.id}>
            <span data-testid="template-choice">{choice.name}</span>
            <code aria-label={`${choice.name} HTML`}>{choice.html}</code>
          </li>
        ))}
      </ul>
    </>
  )
}

function App() {
  return (
    <DocumentTemplateProvider>
      <Consumer />
    </DocumentTemplateProvider>
  )
}

function names() {
  return screen
    .queryAllByTestId("template-choice")
    .map((choice) => choice.textContent)
}

function requestTemplates() {
  fireEvent.click(screen.getByRole("button", { name: "Request templates" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cache.clear()
  mocks.session = {
    identity: "actor-one",
    organizationId: 7,
    activeCompanyId: 11,
    activeCompanyReady: true,
    companyIds: [11, 22]
  }
  mocks.currentUser = { id: "actor-one" }
  mocks.permissionsReady = true
  mocks.allowed = true
  mocks.checkPermission.mockImplementation(() => ({ allowed: mocks.allowed }))
  mocks.refetch.mockResolvedValue(undefined)
  mocks.query.mockImplementation(
    (
      organizationId: number,
      enabled: boolean,
      scope: DocumentTemplatesScope
    ) => ({
      ...(mocks.cache.get(cacheKey(organizationId, scope)) ?? {
        data: undefined,
        isError: false,
        isFetching: enabled
      }),
      refetch: mocks.refetch
    })
  )
})

afterEach(cleanup)

describe("DocumentTemplateProvider application integration", () => {
  it("requests the exact signed-in company scope lazily and models loading and refetch", () => {
    const view = render(<App />)
    expect(mocks.query).toHaveBeenLastCalledWith(7, false, {
      identity: "actor-one",
      companyId: 11
    })
    expect(mocks.checkPermission).toHaveBeenCalledWith(
      "document_template",
      "read"
    )
    expect(screen.getByLabelText("Template status").textContent).toBe("idle")
    expect(names()).toEqual([])

    requestTemplates()
    expect(mocks.query).toHaveBeenLastCalledWith(7, true, {
      identity: "actor-one",
      companyId: 11
    })
    expect(screen.getByLabelText("Template status").textContent).toBe("loading")
    expect(names()).toEqual([])
    expect(mocks.refetch).not.toHaveBeenCalled()
    cacheResult([template()])
    view.rerender(<App />)
    expect(screen.getByLabelText("Template status").textContent).toBe("ready")
    expect(names()).toEqual(["Greeting"])
    requestTemplates()
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it("does not expose cached choices until the current scope is requested", () => {
    cacheResult([template()])
    render(<App />)
    expect(names()).toEqual([])
    expect(screen.getByLabelText("Template status").textContent).toBe("idle")
    requestTemplates()
    expect(names()).toEqual(["Greeting"])
  })

  it("offers only active supported prose and recompiles metadata instead of trusting stale HTML", () => {
    cacheResult([
      template(),
      template({
        id: 2,
        name: "Snake case",
        isActive: undefined,
        is_active: true,
        bodyHtml: undefined,
        body_html: "<p>Stale snake HTML</p>",
        metadata: metadata("rich-text", "Canonical snake text")
      }),
      template({ id: 3, name: "Inactive", isActive: false }),
      template({
        id: 4,
        name: "Layout",
        metadata: metadata("document", "Page layout")
      }),
      template({
        id: 5,
        name: "Invoice profile",
        reportType: "lumiere-invoice-profile-v1"
      }),
      template({
        id: 6,
        name: "Snake invoice profile",
        report_type: "lumiere-invoice-profile-v1"
      }),
      template({ id: 7, name: "Legacy", metadata: null }),
      template({ id: 8, name: "Legacy namespace", metadata: '{"other":true}' }),
      template({ id: 9, name: "Malformed", metadata: "{" }),
      template({
        id: 10,
        name: "Future",
        metadata: '{"documentDesigner":{"schemaVersion":2}}'
      }),
      template({
        id: 11,
        name: "Unsupported project",
        metadata: JSON.stringify({
          documentDesigner: {
            schemaVersion: 1,
            engine: "grapesjs",
            kind: "rich-text",
            project: { assets: [{ src: "https://example.com/image.png" }] }
          }
        })
      }),
      template({ id: "invalid", name: "Invalid ID" })
    ])
    render(<App />)
    requestTemplates()
    expect(names()).toEqual(["Greeting", "Snake case"])
    expect(screen.getByLabelText("Greeting HTML").textContent).toBe(
      "<p>Canonical text</p>"
    )
    expect(screen.getByLabelText("Snake case HTML").textContent).toBe(
      "<p>Canonical snake text</p>"
    )
    expect(
      screen.queryByText(/Stale exported HTML|Stale snake HTML/)
    ).toBeNull()
  })

  it.each(["company", "identity"] as const)(
    "clears choices immediately on a %s switch without remounting children",
    (change) => {
      const view = render(<App />)
      requestTemplates()
      cacheResult([template({ name: "Previous scope" })])
      view.rerender(<App />)
      const draft = screen.getByRole("textbox", {
        name: "Unrelated draft"
      }) as HTMLInputElement
      fireEvent.change(draft, { target: { value: "Unsaved work" } })
      expect(names()).toEqual(["Previous scope"])
      const previousScope = screen.getByLabelText("Template scope").textContent

      if (change === "company") mocks.session.activeCompanyId = 22
      else {
        mocks.session.identity = "actor-two"
        mocks.currentUser = { id: "actor-two" }
      }
      view.rerender(<App />)
      expect(mocks.query).toHaveBeenLastCalledWith(7, false, activeScope())
      expect(screen.getByLabelText("Template scope").textContent).not.toBe(
        previousScope
      )
      expect(screen.getByLabelText("Template status").textContent).toBe("idle")
      expect(names()).toEqual([])
      expect(screen.getByRole("textbox", { name: "Unrelated draft" })).toBe(
        draft
      )
      expect(draft.value).toBe("Unsaved work")
      expect(mocks.mounted).toHaveBeenCalledTimes(1)

      requestTemplates()
      expect(mocks.query).toHaveBeenLastCalledWith(7, true, activeScope())
      expect(screen.getByLabelText("Template status").textContent).toBe(
        "loading"
      )
      expect(names()).toEqual([])
      cacheResult([
        template({
          id: 2,
          companyId: mocks.session.activeCompanyId,
          name: "Current scope"
        })
      ])
      view.rerender(<App />)
      expect(names()).toEqual(["Current scope"])
      expect(mocks.mounted).toHaveBeenCalledTimes(1)
    }
  )

  it.each(["permission", "permission readiness"] as const)(
    "removes cached choices when %s is lost without remounting draft fields",
    (change) => {
      cacheResult([template()])
      const view = render(<App />)
      requestTemplates()
      expect(names()).toEqual(["Greeting"])
      const draft = screen.getByRole("textbox", {
        name: "Unrelated draft"
      }) as HTMLInputElement
      fireEvent.change(draft, { target: { value: "Keep this draft" } })

      if (change === "permission") mocks.allowed = false
      else mocks.permissionsReady = false
      view.rerender(<App />)
      // The mock retains same-key cached data, as a disabled React Query does.
      expect(mocks.query).toHaveBeenLastCalledWith(7, false, activeScope())
      expect(screen.getByLabelText("Template status").textContent).toBe(
        "disabled"
      )
      expect(
        screen.queryByRole("button", { name: "Request templates" })
      ).toBeNull()
      expect(names()).toEqual([])
      expect(screen.getByRole("textbox", { name: "Unrelated draft" })).toBe(
        draft
      )
      expect(draft.value).toBe("Keep this draft")
      expect(mocks.mounted).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    [
      "stale actor permissions",
      () => {
        mocks.currentUser = { id: "different-actor" }
      }
    ],
    [
      "unready company",
      () => {
        mocks.session.activeCompanyReady = false
      }
    ],
    [
      "missing active company",
      () => {
        mocks.session.activeCompanyId = undefined
      }
    ],
    [
      "company outside membership",
      () => {
        mocks.session.activeCompanyId = 33
      }
    ],
    [
      "unknown organization",
      () => {
        mocks.session.organizationId = undefined
      }
    ]
  ] as const)(
    "does not permit requesting choices for %s",
    (_name, invalidate) => {
      invalidate()
      render(<App />)
      expect(mocks.query.mock.lastCall?.[1]).toBe(false)
      expect(screen.getByLabelText("Template status").textContent).toBe(
        "disabled"
      )
      expect(
        screen.queryByRole("button", { name: "Request templates" })
      ).toBeNull()
      expect(names()).toEqual([])
    }
  )

  it("requests explicit organization defaults without an active company", () => {
    mocks.session.activeCompanyId = null
    render(<App />)
    requestTemplates()
    expect(mocks.query).toHaveBeenLastCalledWith(7, true, {
      identity: "actor-one",
      companyId: null
    })
  })

  it("hides cached choices when a scoped refetch errors and exposes retry", () => {
    cacheResult([template()])
    const view = render(<App />)
    requestTemplates()
    expect(names()).toEqual(["Greeting"])
    cacheResult([template()], true)
    view.rerender(<App />)
    expect(screen.getByLabelText("Template status").textContent).toBe("error")
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be loaded"
    )
    expect(names()).toEqual([])
    requestTemplates()
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })
})
