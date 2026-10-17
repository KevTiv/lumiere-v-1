import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModuleDataState } from "../lib/module-data-state"
import { ImportAssistantWizard } from "./import-assistant-wizard"
import { SALE_ORDER_IMPORT_BUNDLE } from "@lumiere/erp-shared/csv-import-bundles"

const hooks = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false, reset: vi.fn() })
  return {
    analyze: mutation(), preview: mutation(), save: mutation(), remove: mutation(), finalize: mutation(), rollback: mutation(),
    templates: { data: [], isLoading: false, refetch: vi.fn() },
    jobs: { data: [{ id: 41, status: "success" }], isLoading: false, refetch: vi.fn() },
    errors: { data: [], isLoading: false, refetch: vi.fn() },
  }
})

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-import-mapping", () => ({
  useAnalyzeImportMapping: () => hooks.analyze,
  usePreviewImportMapping: () => hooks.preview,
}))
vi.mock("@lumiere/query-hooks/hooks/import-mapping-templates", () => ({
  templatesForEntity: () => [],
  useImportMappingTemplates: () => hooks.templates,
  useSaveImportMappingTemplate: () => hooks.save,
  useDeleteImportMappingTemplate: () => hooks.remove,
  useFinalizeImportAssistantJob: () => hooks.finalize,
}))
vi.mock("@lumiere/query-hooks/hooks/import-jobs", () => ({
  errorsForJob: () => [], jobsForEntity: (rows: unknown[]) => rows, findLatestImportJob: (rows: unknown[]) => rows[0],
  useImportJobs: () => hooks.jobs,
  useImportJobErrors: () => hooks.errors,
  useRollbackImportJob: () => hooks.rollback,
}))
vi.mock("./import-mapping-table", () => ({
  headersForMapping: (headers: string[]) => headers,
  lineAnalysisFromBundle: () => null,
  mappingRecordFromAnalysis: () => ({ name: "name" }),
  mappingRecordFromLineBundle: () => ({}),
  ImportMappingTable: () => <div>Draft mapping</div>,
}))
vi.mock("./import-template-controls", () => ({
  selectedTemplateRow: () => null, priorMappingsFromTemplate: () => undefined,
  ImportTemplateControls: () => null,
}))
vi.mock("./import-preview-grid", () => ({ ImportPreviewGrid: () => <div>Unsubmitted CSV preview</div> }))
vi.mock("./import-job-history-panel", () => ({ ImportJobHistoryPanel: () => null }))
vi.mock("./import-job-status-panel", () => ({
  ImportJobStatusPanel: ({ job }: { job?: { id: number } }) => <div>Submitted job {job?.id}</div>,
}))

const retry = { fileName: "contacts.csv", headers: ["name"], rows: [["Ada"]], mapping: { name: "name" } }
const ready = { status: "ready" } as const
const denied = { status: "denied" } as const

function wizard(sourceState: ModuleDataState, onImport = vi.fn().mockResolvedValue(undefined), extra = {}) {
  return <ImportAssistantWizard open onOpenChange={vi.fn()} organizationId={1} targetEntity="contact"
    title="Import contacts" onImport={onImport} initialRetry={retry} sourceState={sourceState} {...extra} />
}

async function preview() {
  fireEvent.click(await screen.findByRole("button", { name: "common.importAssistant.preview" }))
  await screen.findByText("Unsubmitted CSV preview")
}

beforeEach(() => {
  vi.clearAllMocks()
  hooks.preview.mutateAsync.mockResolvedValue({ validation_errors: [] })
})
afterEach(cleanup)

describe("ImportAssistantWizard source readiness", () => {
  it("hides an unsubmitted stale preview and prevents another dispatch after access is denied", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined)
    const view = render(wizard(ready, onImport))
    await preview()
    view.rerender(wizard(denied, onImport))
    expect(screen.getByText("You do not have access to these records.")).toBeTruthy()
    expect(screen.queryByText("Unsubmitted CSV preview")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "common.importAssistant.preview" }))
    expect(hooks.preview.mutateAsync).toHaveBeenCalledTimes(1)
    expect(onImport).not.toHaveBeenCalled()
    view.rerender(wizard(ready, onImport))
    expect(screen.queryByRole("button", { name: "common.importAssistant.confirmImport" })).toBeNull()
    expect(onImport).not.toHaveBeenCalled()
  })

  it("keeps the submitted import mounted until its outcome arrives after source access is denied", async () => {
    let resolveImport!: () => void
    const onImport = vi.fn(() => new Promise<void>((resolve) => { resolveImport = resolve }))
    const onSuccess = vi.fn()
    const view = render(wizard(ready, onImport, { onSuccess }))
    await preview()
    fireEvent.click(screen.getByRole("button", { name: "common.importAssistant.confirmImport" }))
    expect(onImport).toHaveBeenCalledTimes(1)
    view.rerender(wizard(denied, onImport, { onSuccess }))
    expect(screen.getByText("Unsubmitted CSV preview")).toBeTruthy()
    expect(screen.getByText("You do not have access to these records.")).toBeTruthy()
    await act(async () => resolveImport())
    expect(await screen.findByText("Submitted job 41")).toBeTruthy()
    expect(onSuccess).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(hooks.finalize.mutateAsync).toHaveBeenCalledTimes(1))
    view.rerender(wizard({ status: "loading" }, onImport, { onSuccess }))
    view.rerender(wizard({ status: "error" }, onImport, { onSuccess }))
    view.rerender(wizard(ready, onImport, { onSuccess }))
    expect(screen.getByText("Submitted job 41")).toBeTruthy()
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(hooks.finalize.mutateAsync).toHaveBeenCalledTimes(1)
  })

  it("retains recovery after a submitted response fails instead of enabling a new import", async () => {
    let rejectImport!: (error: Error) => void
    const onImport = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectImport = reject }))
    const view = render(wizard(ready, onImport))
    await preview()
    fireEvent.click(screen.getByRole("button", { name: "common.importAssistant.confirmImport" }))
    view.rerender(wizard(denied, onImport))
    await act(async () => rejectImport(new Error("Import response lost")))
    expect(await screen.findByText("Submitted job 41")).toBeTruthy()
    expect(screen.getByText("Import response lost")).toBeTruthy()
    view.rerender(wizard(ready, onImport))
    expect(screen.queryByRole("button", { name: "common.importAssistant.confirmImport" })).toBeNull()
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(hooks.finalize.mutateAsync).not.toHaveBeenCalled()
  })

  it("does not dispatch a bundle continuation after the parent settles with unavailable source data", async () => {
    let resolveImport!: () => void
    const onImport = vi.fn(() => new Promise<void>((resolve) => { resolveImport = resolve }))
    const onImportLines = vi.fn().mockResolvedValue(undefined)
    const resolveOrderIds = vi.fn().mockResolvedValue(new Map([["SO001", "7"]]))
    const onSuccess = vi.fn()
    const extra = {
      importBundle: SALE_ORDER_IMPORT_BUNDLE, onImportLines, resolveOrderIds, onSuccess,
      initialRetry: {
        fileName: "orders.csv", headers: ["reference", "product"], rows: [["SO001", "Widget"]],
        mapping: { reference: "client_order_ref" }, lineMapping: { product: "name" },
      },
    }
    const view = render(wizard(ready, onImport, extra))
    await preview()
    fireEvent.click(screen.getByRole("button", { name: "common.importAssistant.confirmImport" }))
    expect(onImport).toHaveBeenCalledTimes(1)
    view.rerender(wizard(denied, onImport, extra))
    await act(async () => resolveImport())
    expect(await screen.findByText("Submitted job 41")).toBeTruthy()
    expect(resolveOrderIds).not.toHaveBeenCalled()
    expect(onImportLines).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(hooks.finalize.mutateAsync).not.toHaveBeenCalled()
    view.rerender(wizard(ready, onImport, extra))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onImportLines).not.toHaveBeenCalled()
  })

  it("ignores a file read that settles after source readiness is lost", async () => {
    let resolveFile!: (text: string) => void
    const file = new File(["name\nAda"], "contacts.csv", { type: "text/csv" })
    Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { resolveFile = resolve }) })
    const view = render(wizard(ready, undefined, { initialRetry: null }))
    fireEvent.change(screen.getByLabelText("common.csvImport.fileLabel"), { target: { files: [file] } })
    view.rerender(wizard(denied, undefined, { initialRetry: null }))
    await act(async () => resolveFile("name\nAda"))
    view.rerender(wizard(ready, undefined, { initialRetry: null }))
    expect(screen.queryByText("contacts.csv")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "common.importAssistant.analyze" }))
    expect(hooks.analyze.mutateAsync).not.toHaveBeenCalled()
  })
})
