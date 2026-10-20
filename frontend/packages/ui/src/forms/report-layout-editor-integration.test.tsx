import React, { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TFunction } from "i18next"
import type { CustomField } from "../lib/form-types"
import { ModularForm } from "./modular-form"
import { chooseSelectValue } from "../components/select-test-utils"
import { templateEditorForm } from "../../../../web/app/(modules)/reports/template-editor-config"
import {
  TemplateLayoutEditor,
  TemplateLayoutPreview,
} from "../../../../web/app/(modules)/reports/template-layout-editor"
import {
  parseTemplateBlocks,
  serializeTemplateBlocks,
  type TemplateBlock,
} from "../../../../web/app/(modules)/reports/template-layout"

const translation = vi.hoisted(() => ({
  t: (key: string, options?: { defaultValue?: string; number?: number }) => {
    if (key === "common.cancel") return "Cancel"
    return (options?.defaultValue ?? key).replace(/\{\{number\}\}/g, String(options?.number ?? ""))
  },
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => translation }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

afterEach(cleanup)

function EditorDraft({
  initialValue,
  disabled = false,
  onChange,
}: {
  initialValue: string
  disabled?: boolean
  onChange?: (value: unknown) => void
}) {
  const [value, setValue] = useState(initialValue)
  const field: CustomField = {
    id: "templateContent",
    name: "templateContent",
    label: "Template layout",
    type: "custom",
    component: TemplateLayoutEditor,
    disabled,
  }
  return (
    <>
      <TemplateLayoutEditor
        field={field}
        value={value}
        onChange={(next) => {
          onChange?.(next)
          setValue(String(next))
        }}
      />
      <output data-testid="draft-layout">{value}</output>
    </>
  )
}

function draftBlocks(): TemplateBlock[] {
  const blocks = parseTemplateBlocks(screen.getByTestId("draft-layout").textContent ?? "")
  expect(blocks).not.toBeNull()
  return blocks!
}

function iframeDocument(): Document {
  const iframe = screen.getByTitle("Report template layout preview") as HTMLIFrameElement
  return new DOMParser().parseFromString(iframe.getAttribute("srcdoc") ?? "", "text/html")
}

describe("report template layout editor integration", () => {
  it("prevents legacy replacement when disabled, including an already open confirmation", () => {
    const legacy = "<article><h1>Saved legacy layout</h1></article>"
    const change = vi.fn()
    const { rerender } = render(<EditorDraft initialValue={legacy} disabled onChange={change} />)
    const build = screen.getByRole("button", { name: "Build with sections" })
    expect(build.hasAttribute("disabled")).toBe(true)
    expect((screen.getByTestId("template-markup") as HTMLTextAreaElement).disabled).toBe(true)
    fireEvent.click(build)
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(change).not.toHaveBeenCalled()

    rerender(<EditorDraft initialValue={legacy} onChange={change} />)
    fireEvent.click(screen.getByRole("button", { name: "Build with sections" }))
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    rerender(<EditorDraft initialValue={legacy} disabled onChange={change} />)
    const replace = screen.getByRole("button", { name: "Start section layout" })
    expect(replace.hasAttribute("disabled")).toBe(true)
    fireEvent.click(replace)
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByTestId("draft-layout").textContent).toBe(legacy)
  })

  it("retains legacy markup through opening and canceling until replacement is explicitly confirmed", () => {
    const legacy = '<main class="existing"><h1>Legacy title</h1><p>{{custom_binding}}</p></main>'
    const change = vi.fn()
    render(<EditorDraft initialValue={legacy} onChange={change} />)
    fireEvent.click(screen.getByRole("button", { name: "Build with sections" }))
    expect(screen.getByTestId("draft-layout").textContent).toBe(legacy)
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel", exact: true }),
    )
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect((screen.getByTestId("template-markup") as HTMLTextAreaElement).value).toBe(legacy)
    expect(change).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Build with sections" }))
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start section layout" }),
    )
    expect(change).toHaveBeenCalledTimes(1)
    expect(draftBlocks()).toEqual([])
    expect(screen.queryByTestId("template-markup")).toBeNull()
    expect(screen.getByRole("button", { name: "Add heading" })).toBeTruthy()
  })

  it("allows the 100th section, prevents a 101st, and restores add controls after removal", () => {
    const initial: TemplateBlock[] = Array.from({ length: 99 }, (_, index) => ({
      id: `heading-${index}`,
      kind: "heading",
      text: `Heading ${index}`,
    }))
    const change = vi.fn()
    render(<EditorDraft initialValue={serializeTemplateBlocks(initial)} onChange={change} />)
    expect(screen.queryByTestId("template-section-99")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Add heading" }))
    expect(screen.getByTestId("template-section-99")).toBeTruthy()
    expect(draftBlocks()).toHaveLength(100)
    for (const name of ["Add heading", "Add text", "Add document table"]) {
      const add = screen.getByRole("button", { name, exact: true })
      expect(add.hasAttribute("disabled")).toBe(true)
      fireEvent.click(add)
    }
    expect(change).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("template-section-100")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Remove section 100", exact: true }))
    expect(draftBlocks()).toHaveLength(99)
    const addTable = screen.getByRole("button", { name: "Add document table", exact: true })
    expect(addTable.hasAttribute("disabled")).toBe(false)
    fireEvent.click(addTable)
    expect(draftBlocks()).toHaveLength(100)
    expect(draftBlocks()[99]?.kind).toBe("table")
    expect(change).toHaveBeenCalledTimes(3)
  })

  it("reorders and removes exact sections while retaining their identities and contents", () => {
    const initial: TemplateBlock[] = [
      { id: "revenue", kind: "heading", text: "Revenue" },
      { id: "policy", kind: "paragraph", text: "Recognition policy" },
      { id: "documents", kind: "table", columns: ["number", "total"] },
    ]
    render(<EditorDraft initialValue={serializeTemplateBlocks(initial)} />)
    expect(
      screen
        .getByRole("button", { name: "Move section 1 up", exact: true })
        .hasAttribute("disabled"),
    ).toBe(true)
    expect(
      screen
        .getByRole("button", { name: "Move section 3 down", exact: true })
        .hasAttribute("disabled"),
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Move section 2 up", exact: true }))
    expect(draftBlocks()).toEqual([initial[1], initial[0], initial[2]])
    expect((screen.getByTestId("template-section-text-0") as HTMLInputElement).value).toBe(
      "Recognition policy",
    )
    fireEvent.click(screen.getByRole("button", { name: "Move section 2 down", exact: true }))
    expect(draftBlocks()).toEqual([initial[1], initial[2], initial[0]])
    fireEvent.click(screen.getByRole("button", { name: "Remove section 1", exact: true }))
    expect(draftBlocks()).toEqual([initial[2], initial[0]])
    expect((screen.getByTestId("template-section-text-1") as HTMLInputElement).value).toBe(
      "Revenue",
    )
  })

  it.each([
    { orientation: "Landscape", paperFormat: "A3", previewWidth: "1000px" },
    { orientation: "Portrait", paperFormat: "Letter", previewWidth: "700px" },
  ])(
    "preserves $orientation and $paperFormat defaults through section edits and submission",
    async ({ orientation, paperFormat, previewWidth }) => {
      const submit = vi.fn()
      const config = templateEditorForm(translation.t as unknown as TFunction, {
        orientation,
        paperFormat,
        templateContent: serializeTemplateBlocks([
          { id: "heading", kind: "heading", text: "Saved heading" },
        ]),
      })
      render(
        <ModularForm
          config={config}
          onSubmit={submit}
          renderPreview={(values) => <TemplateLayoutPreview values={values} />}
        />,
      )
      expect((screen.getByTestId("form-field-paperFormat") as HTMLInputElement).value).toBe(
        paperFormat,
      )
      expect(iframeDocument().querySelector("style")?.textContent).toContain(
        `max-width:${previewWidth}`,
      )
      fireEvent.click(screen.getByRole("button", { name: "Add text", exact: true }))
      fireEvent.change(screen.getByTestId("template-section-text-1"), {
        target: { value: "Unsaved policy text" },
      })
      expect(iframeDocument().body.textContent).toContain("Unsaved policy text")
      fireEvent.click(screen.getByRole("button", { name: "Save template layout", exact: true }))
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
      const values = submit.mock.calls[0]![0]!
      expect(values.orientation).toBe(orientation)
      expect(values.paperFormat).toBe(paperFormat)
      expect(parseTemplateBlocks(String(values.templateContent))).toEqual([
        { id: "heading", kind: "heading", text: "Saved heading" },
        expect.objectContaining({ kind: "paragraph", text: "Unsaved policy text" }),
      ])
    },
  )

  it("updates the safe preview from actual form orientation and section text changes", () => {
    const config = templateEditorForm(translation.t as unknown as TFunction, {
      orientation: "Landscape",
      paperFormat: "A3",
      templateContent: serializeTemplateBlocks([
        { id: "text", kind: "paragraph", text: "Existing text" },
      ]),
    })
    render(
      <ModularForm
        config={config}
        renderPreview={(values) => <TemplateLayoutPreview values={values} />}
      />,
    )
    chooseSelectValue(screen.getByTestId("form-field-orientation"), "Portrait")
    const unsafeText =
      '<img src="https://example.invalid/private" onerror="alert(1)"><script>alert(2)</script>'
    fireEvent.change(screen.getByTestId("template-section-text-0"), {
      target: { value: unsafeText },
    })
    const preview = iframeDocument()
    expect(preview.querySelector("style")?.textContent).toContain("max-width:700px")
    expect(preview.body.textContent).toContain(unsafeText)
    expect(preview.querySelector("img, script")).toBeNull()
  })

  it("contains legacy markup inside an opaque sandbox with restrictive CSP and no referrer", () => {
    const legacy =
      '<h1>Custom legacy layout</h1><script>window.parent.alert(1)</script><img src="https://example.invalid/receipt"><form action="https://example.invalid/submit"></form>'
    render(<TemplateLayoutPreview values={{ templateContent: legacy, orientation: "Portrait" }} />)
    const iframe = screen.getByTitle("Report template layout preview") as HTMLIFrameElement
    expect(iframe.getAttribute("sandbox")).toBe("")
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer")
    const preview = iframeDocument()
    const policy = preview
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content")
    expect(policy).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    )
    expect(preview.querySelector("h1")?.textContent).toBe("Custom legacy layout")
    // Legacy markup is contained rather than rewritten; jsdom does not execute the iframe.
    expect(iframe.getAttribute("srcdoc")).toContain(legacy)
    expect(document.querySelector('img[src="https://example.invalid/receipt"]')).toBeNull()
    expect(document.querySelector('form[action="https://example.invalid/submit"]')).toBeNull()
  })
})
