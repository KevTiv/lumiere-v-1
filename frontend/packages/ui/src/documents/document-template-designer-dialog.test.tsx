import { chooseSelectValue } from "../components/select-test-utils"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CreateDocumentTemplateParams } from "@lumiere/stdb/types"
import type { DocumentTemplateDesignerProps } from "../components/document-template-designer"
import { createDocumentDesignerSnapshot } from "../lib/document-template-designer"
import {
  DocumentTemplateDesignerDialog,
  customizableDocumentTemplate,
} from "../../../../web/app/(modules)/documents/document-template-designer-dialog"

const harness = vi.hoisted(() => ({
  create:
    vi.fn<(params: Partial<CreateDocumentTemplateParams>) => Promise<void>>(),
  createScope: vi.fn(),
  update: vi.fn<(...args: unknown[]) => Promise<void>>(),
  updateScope: vi.fn(),
  upload: vi.fn(),
  validateLogo: vi.fn(),
  writeAllowed: true,
  allowed: true,
  userId: "alice",
  session: {
    identity: "alice",
    organizationId: 7,
    activeCompanyId: 2,
    activeCompanyReady: true,
    companyIds: [2, 3],
  },
}))

vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => harness.session,
}))
vi.mock("@lumiere/ui/lib/rbac-context", () => ({
  useRBAC: () => ({
    permissionsReady: true,
    currentUser: { id: harness.userId },
    checkPermission: (_resource: string, action: string) => ({
      allowed: harness.allowed && (action !== "write" || harness.writeAllowed),
    }),
  }),
}))
vi.mock("@lumiere/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()),
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; name?: string }) =>
      (
        options?.defaultValue ??
        (key === "documents.documents.columns.name" ? "Name" : key)
      ).replace("{{name}}", options?.name ?? ""),
  }),
}))
vi.mock("@lumiere/ui/lib/workflow-toast", () => ({
  showWorkflowToast: vi.fn(),
}))
vi.mock("@lumiere/query-hooks/hooks/templates", async () => {
  const actual = await vi.importActual<
    typeof import("@lumiere/query-hooks/hooks/templates")
  >("@lumiere/query-hooks/hooks/templates")
  return {
    ...actual,
    useUpdateDocumentTemplate: (...args: unknown[]) => {
      harness.updateScope(...args)
      return { mutateAsync: harness.update, isPending: false }
    },
    useCreateDocumentTemplate: (...args: unknown[]) => {
      harness.createScope(...args)
      return { mutateAsync: harness.create, isPending: false }
    },
  }
})

vi.mock("../../../../web/lib/document-blob-upload", () => ({
  uploadDocumentBlob: (...args: unknown[]) => harness.upload(...args),
}))
vi.mock("@lumiere/ui/settings/invoice-personalization-settings", () => ({
  validateInvoiceLogoFile: (...args: unknown[]) =>
    harness.validateLogo(...args),
}))

// GrapesJS itself has real model/parser tests. This stub isolates dialog lifecycle and persistence.
vi.mock("@lumiere/ui/components/document-template-designer", async () => {
  const { createDocumentDesignerSnapshot: snapshot } =
    await import("../lib/document-template-designer")
  const React = await import("react")
  const project = (text: string) => ({
    assets: [],
    styles: [],
    pages: [
      {
        id: "template-page",
        frames: [
          {
            component: {
              type: "wrapper",
              components: [{ type: "text", tagName: "p", content: text }],
            },
          },
        ],
      },
    ],
  })
  const actual = await vi.importActual<
    typeof import("../components/document-template-designer")
  >("../components/document-template-designer")
  return {
    ...actual,
    DocumentTemplateDesigner: ({
      kind,
      initialDesigner,
      onChange,
      onError,
      disabled,
    }: DocumentTemplateDesignerProps) => {
      const changed = React.useRef(onChange)
      changed.current = onChange
      React.useEffect(() => {
        changed.current(snapshot(kind, initialDesigner?.project ?? project("")))
      }, [kind, initialDesigner])
      return (
        <>
          <button
            disabled={disabled}
            onClick={() =>
              onChange({
                ...snapshot(kind, project("Edited content")),
                bodyHtml: "STALE GENERATED HTML",
              })
            }
          >
            Change design
          </button>
          <button
            disabled={disabled}
            onClick={() => onError?.("Invalid design")}
          >
            Break design
          </button>
        </>
      )
    },
  }
})

function savedTemplate(companyId: number | null = null) {
  const snapshot = createDocumentDesignerSnapshot("rich-text", {
    assets: [],
    styles: [],
    pages: [
      {
        id: "saved",
        frames: [
          {
            component: {
              type: "wrapper",
              components: [
                { type: "text", tagName: "p", content: "Saved content" },
              ],
            },
          },
        ],
      },
    ],
  })
  return {
    id: "31",
    organizationId: 7,
    companyId,
    name: "Saved template",
    model: "document",
    reportType: "lumiere-rich-text-template-v1",
    isActive: true,
    metadata: JSON.stringify({
      audit: { owner: "sales" },
      documentDesigner: snapshot.designer,
    }),
  }
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent)
  harness.create.mockReset().mockResolvedValue(undefined)
  harness.createScope.mockReset()
  harness.update.mockReset().mockResolvedValue(undefined)
  harness.updateScope.mockReset()
  harness.writeAllowed = true
  harness.validateLogo.mockReset().mockResolvedValue(undefined)
  harness.upload
    .mockReset()
    .mockResolvedValue({
      url: "/api/documents/blobs/object/7/br/" + "a".repeat(32),
      checksum: "b".repeat(64),
    })
  harness.allowed = true
  harness.userId = "alice"
  harness.session = {
    identity: "alice",
    organizationId: 7,
    activeCompanyId: 2,
    activeCompanyReady: true,
    companyIds: [2, 3],
  }
})
afterEach(cleanup)

describe("document template designer dialog", () => {
  it("saves a new text template to the active company with canonical HTML and project in one mutation", async () => {
    const onClose = vi.fn()
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: " Welcome " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change design" }))
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(harness.create).toHaveBeenCalledOnce()
    expect(harness.createScope).toHaveBeenLastCalledWith(7, 2, {
      identity: "alice",
      companyId: 2,
    })
    const params = harness.create.mock.calls[0]![0]
    expect(params).toMatchObject({
      name: "Welcome",
      model: "document",
      reportType: "lumiere-rich-text-template-v1",
      bodyHtml: "<p>Edited content</p>",
      isActive: true,
      isDefault: false,
    })
    expect(JSON.parse(params.metadata!).documentDesigner.kind).toBe("rich-text")
  })

  it("keeps edits after a failed copy save and creates in the active company while preserving the source", async () => {
    harness.create.mockRejectedValueOnce(new Error("Could not save template"))
    const row = savedTemplate()
    const original = JSON.stringify(row)
    const template = customizableDocumentTemplate(row, 7, 2)!
    const onClose = vi.fn()
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        template={template}
        onClose={onClose}
      />,
    )
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Saved template (copy)",
    )
    expect(screen.queryByLabelText("Model")).toBeNull()
    expect(
      (screen.getByLabelText("Template type") as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Edited name" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change design" }))
    fireEvent.click(screen.getByRole("button", { name: "Save template copy" }))
    await screen.findByRole("alert")
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not save template",
    )
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Edited name",
    )
    expect(onClose).not.toHaveBeenCalled()
    const params = harness.create.mock.calls[0]![0]
    expect(params).toMatchObject({
      name: "Edited name",
      model: "document",
      bodyHtml: "<p>Edited content</p>",
      isActive: true,
      isDefault: false,
    })
    expect(JSON.parse(params.metadata!).audit).toEqual({ owner: "sales" })
    expect(
      JSON.parse(params.metadata!).documentDesigner.project.pages[0].frames[0]
        .component.components[0].content,
    ).toBe("Edited content")
    expect(harness.createScope).toHaveBeenLastCalledWith(7, 2, {
      identity: "alice",
      companyId: 2,
    })
    expect(JSON.stringify(row)).toBe(original)
    fireEvent.click(screen.getByRole("button", { name: "Save template copy" }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(harness.create).toHaveBeenCalledTimes(2)
    expect(harness.create.mock.calls[1]![0]).toEqual(params)
  })

  it("asks before discarding dirty edits and lets the user keep editing", async () => {
    const onClose = vi.fn()
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Draft" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }))
    await screen.findByRole("alertdialog")
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Draft",
    )
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard", exact: true }),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(harness.create).not.toHaveBeenCalled()
  })

  it("blocks a stale dialog after the selected company or signed-in identity changes", () => {
    const props = {
      organizationId: 7,
      companyId: 2,
      identity: "alice",
      onClose: vi.fn(),
    }
    const view = render(<DocumentTemplateDesignerDialog {...props} />)
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Old scope draft" },
    })
    harness.session.activeCompanyId = 3
    view.rerender(<DocumentTemplateDesignerDialog {...props} />)
    expect(
      (
        screen.getByRole("button", {
          name: "Save template",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    harness.session.activeCompanyId = 2
    harness.session.identity = "bob"
    view.rerender(<DocumentTemplateDesignerDialog {...props} />)
    expect(
      (
        screen.getByRole("button", {
          name: "Change design",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(harness.create).not.toHaveBeenCalled()
  })

  it("blocks saving after an invalid design instead of reusing the previous valid HTML", () => {
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Draft" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Break design" }))
    expect(screen.getByRole("alert").textContent).toBe("Invalid design")
    expect(
      (
        screen.getByRole("button", {
          name: "Save template",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(harness.create).not.toHaveBeenCalled()
  })

  it("requires current company membership and permissions for the signed-in identity", () => {
    const props = {
      organizationId: 7,
      companyId: 2,
      identity: "alice",
      onClose: vi.fn(),
    }
    const view = render(<DocumentTemplateDesignerDialog {...props} />)
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Scoped draft" },
    })
    harness.session.companyIds = [3]
    view.rerender(<DocumentTemplateDesignerDialog {...props} />)
    expect(
      (
        screen.getByRole("button", {
          name: "Save template",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    harness.session.companyIds = [2, 3]
    harness.userId = "bob"
    view.rerender(<DocumentTemplateDesignerDialog {...props} />)
    expect(
      (
        screen.getByRole("button", {
          name: "Save template",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    expect(harness.create).not.toHaveBeenCalled()
  })

  it("prevents a second submit or close before the mutation's pending render arrives", async () => {
    let finish!: () => void
    harness.create.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const onClose = vi.fn()
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "One template" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change design" }))
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }))
    expect(harness.create).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    await act(async () => {
      finish()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("offers customization only for supported designer projects in the active scope", () => {
    const row = savedTemplate(2)
    expect(customizableDocumentTemplate(row, 7, 2)).not.toBeNull()
    expect(
      customizableDocumentTemplate({ ...row, isActive: false }, 7, 2),
    ).not.toBeNull()
    expect(
      customizableDocumentTemplate({ ...row, metadata: null }, 7, 2),
    ).toBeNull()
    expect(
      customizableDocumentTemplate({ ...row, metadata: "broken" }, 7, 2),
    ).toBeNull()
    expect(
      customizableDocumentTemplate(
        { ...row, reportType: "lumiere-invoice-profile-v1" },
        7,
        2,
      ),
    ).toBeNull()
    expect(
      customizableDocumentTemplate(
        {
          ...row,
          metadata:
            '{"documentDesigner":{"schemaVersion":2,"engine":"grapesjs"}}',
        },
        7,
        2,
      ),
    ).toBeNull()
    expect(customizableDocumentTemplate(row, 8, 2)).toBeNull()
    expect(customizableDocumentTemplate(row, 7, 3)).toBeNull()
  })
  it("keeps a blank draft unsavable and offers usable localized starters", async () => {
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Introduction" },
    })
    expect(
      (
        screen.getByRole("button", {
          name: "Save template",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    chooseSelectValue(screen.getByLabelText("Start with"), "proposal")
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Save template",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    await waitFor(() => expect(harness.create).toHaveBeenCalledOnce())
    expect(harness.create.mock.calls[0]![0].bodyHtml).toContain("Our proposal")
    expect(harness.create.mock.calls[0]![0].bodyHtml).not.toContain(
      "Write your content here",
    )
  })

  it("edits and renames the existing row with write permission, preserving unrelated metadata and defaults", async () => {
    const row = { ...savedTemplate(), isDefault: true }
    const template = customizableDocumentTemplate(row, 7, 2)!
    const onClose = vi.fn()
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        mode="edit"
        template={template}
        onClose={onClose}
      />,
    )
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Saved template",
    )
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Revised template" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change design" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Active" }))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.updateScope).toHaveBeenLastCalledWith(7, {
      identity: "alice",
      companyId: 2,
    })
    const request = harness.update.mock.calls[0]![0] as {
      templateId: string
      companyId: null
      params: {
        name: string
        bodyHtml: string
        isActive: boolean
        metadata: string
        isDefault?: boolean
      }
    }
    expect(request).toMatchObject({
      templateId: "31",
      companyId: null,
      params: {
        name: "Revised template",
        bodyHtml: "<p>Edited content</p>",
        isActive: false,
      },
    })
    expect(request.params.isDefault).toBeUndefined()
    expect(JSON.parse(request.params.metadata).audit).toEqual({
      owner: "sales",
    })
  })

  it("does not substitute create permission for write permission when editing", () => {
    harness.writeAllowed = false
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        mode="edit"
        template={customizableDocumentTemplate(savedTemplate(2), 7, 2)!}
        onClose={vi.fn()}
      />,
    )
    expect(
      (
        screen.getByRole("button", {
          name: "Save changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(harness.update).not.toHaveBeenCalled()
    expect(harness.create).not.toHaveBeenCalled()
  })

  it("saves a quotation starter with a verified managed logo and retains the draft on upload failure", async () => {
    render(
      <DocumentTemplateDesignerDialog
        organizationId={7}
        companyId={2}
        identity="alice"
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Quotation" },
    })
    chooseSelectValue(screen.getByLabelText("Template type"), "document")
    chooseSelectValue(screen.getByLabelText("Start with"), "quotation")
    harness.upload.mockRejectedValueOnce(new Error("Upload unavailable"))
    const file = new File(["raster"], "brand.png", { type: "image/png" })
    fireEvent.change(
      screen.getByLabelText("Upload brand logo", { selector: "input" }),
      { target: { files: [file] } },
    )
    await screen.findByText("Upload unavailable")
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Quotation",
    )
    fireEvent.change(
      screen.getByLabelText("Upload brand logo", { selector: "input" }),
      { target: { files: [file] } },
    )
    await screen.findByText("Brand logo attached")
    expect(harness.upload).toHaveBeenLastCalledWith({ file, companyId: 2n, purpose: "branding" })
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    await waitFor(() => expect(harness.create).toHaveBeenCalledOnce())
    const params = harness.create.mock.calls[0]![0]
    expect(params.bodyHtml).toContain("{{quotation.line_items}}")
    expect(params.bodyHtml).toContain("{{company.logo}}")
    expect(JSON.parse(params.metadata!).documentBranding).toEqual({
      schemaVersion: 1,
      logoUrl:
        "/api/documents/blobs/object/7/br/" +
        "a".repeat(32) +
        "?sha256=" +
        "b".repeat(64),
    })
  })
})
