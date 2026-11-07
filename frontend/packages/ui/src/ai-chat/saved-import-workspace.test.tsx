import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ChatImportTask } from "../../../../web/lib/chat-import-task"
import type { ImportTaskView } from "../../../../web/lib/import-task-navigation"

const controls = vi.hoisted(() => ({
  task: null as ChatImportTask | null,
  mounts: 0,
  unmounts: 0,
  reload: vi.fn(),
  back: vi.fn(),
  reviewProps: null as {
    allowImport?: boolean
    allowedReviewIds?: string[]
  } | null,
}))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))
vi.mock("@lumiere/ui", () => ({
  ChatDecisionCard: () => <p>Purpose decision</p>,
}))
vi.mock("../../../../web/lib/use-saved-import-task", () => ({
  useSavedImportTask: () => ({
    task: controls.task,
    busy: false,
    error: null,
    pointer: null,
    reload: controls.reload,
    answer: vi.fn(),
    resume: vi.fn(),
    retryDecision: vi.fn(),
  }),
}))
vi.mock("../../../../web/lib/import-preparation-panel", () => ({
  ImportPreparationPanel: () => <p>Preparation rules</p>,
}))
vi.mock("../../../../web/lib/import-review-workspace", () => ({
  ImportReviewWorkspace: (props: {
    allowImport?: boolean
    allowedReviewIds?: string[]
    onChanged?: () => void
  }) => {
    controls.reviewProps = props
    return <button onClick={props.onChanged}>Save source decision</button>
  },
}))
vi.mock("../../../../web/lib/import-task-execution-panel", async () => {
  const { useEffect, useState } = await import("react")
  return {
    ImportTaskExecutionPanel: ({ view }: { view: string }) => {
      const [value, setValue] = useState("")
      useEffect(() => {
        controls.mounts++
        return () => {
          controls.unmounts++
        }
      }, [])
      return (
        <label>
          Execution draft {view}
          <input
            aria-label="Execution draft"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      )
    },
  }
})
vi.mock("../../../../web/lib/guided-import-wizard", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    GuidedImportWizard: forwardRef((_props, ref) => {
      useImperativeHandle(ref, () => ({ continueFromReview: async () => true }))
      return <p>Native draft</p>
    }),
  }
})
import { SavedImportWorkspace } from "../../../../web/lib/saved-import-workspace"

const requestId = "a".repeat(32)
function prepared(): ChatImportTask {
  return {
    requestId,
    companyId: "3",
    conversationKey: "earlier-chat",
    status: "needs_review",
    createdAt: "2026-11-07T12:00:00Z",
    warnings: [],
    error: null,
    files: [
      { ordinal: 0, fileName: "ledger.csv", sha256: "f".repeat(64), size: 100 },
    ],
    reviews: [
      {
        id: "71",
        title: "Ledger",
        targetEntity: "source_observation",
        total: 4,
        pending: 1,
        confirmed: 2,
        excluded: 1,
      },
    ],
    decision: {
      id: requestId + ":purpose",
      revision: 2,
      status: "approved",
      question: "Prepare?",
      options: [{ id: "prepare_import", label: "Prepare import" }],
      allowOther: true,
      selectedOptionId: "prepare_import",
      otherText: null,
      decisionId: "b".repeat(32),
    },
    decisionReceipt: null,
    decisionHistory: [],
  }
}
function Harness({
  client,
  inspectionOnly = false,
}: {
  client: QueryClient
  inspectionOnly?: boolean
}) {
  const [view, setView] = useState<ImportTaskView>("sources")
  return (
    <QueryClientProvider client={client}>
      <SavedImportWorkspace
        scope={{ identity: "actor", organizationId: 7, companyId: 3 }}
        taskId={requestId}
        view={view}
        inspectionOnly={inspectionOnly}
        onNavigate={setView}
        onBack={controls.back}
        onTaskChange={vi.fn()}
      />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  controls.task = prepared()
  controls.mounts = 0
  controls.unmounts = 0
  controls.reload.mockReset()
  controls.back.mockReset()
})
afterEach(() => {
  cleanup()
})

it("one execution owner and its draft survive Sources, Decisions, Preview and Results", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  render(<Harness client={client} />)
  fireEvent.click(screen.getByRole("tab", { name: "ERP preview" }))
  fireEvent.change(screen.getByRole("textbox", { name: "Execution draft" }), {
    target: { value: "retained draft" },
  })
  fireEvent.click(screen.getByRole("tab", { name: "Sources" }))
  fireEvent.click(screen.getByRole("tab", { name: "Decisions" }))
  fireEvent.click(screen.getByRole("button", { name: "Save source decision" }))
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["import-workflow-source"],
  })
  expect(controls.reload).toHaveBeenCalledOnce()
  expect(controls.reviewProps?.allowedReviewIds).toEqual(["71"])
  fireEvent.click(screen.getByRole("tab", { name: "ERP results" }))
  expect(
    (
      screen.getByRole("textbox", {
        name: "Execution draft",
      }) as HTMLInputElement
    ).value,
  ).toBe("retained draft")
  expect(controls.mounts).toBe(1)
  expect(controls.unmounts).toBe(0)
  expect(
    screen.getByText(
      "Confirmed source facts are ready for review. ERP creation and verified results are tracked separately.",
    ),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Back to saved imports" }))
  expect(controls.back).toHaveBeenCalledOnce()
})

it("inspection tasks expose decisions without mounting execution or native import", async () => {
  controls.task = {
    ...prepared(),
    status: "inspection_ready",
    decision: { ...prepared().decision, selectedOptionId: "inspect_only" },
  }
  render(<Harness client={new QueryClient()} inspectionOnly />)
  expect(
    screen
      .getByRole("tab", { name: "ERP preview" })
      .getAttribute("aria-disabled"),
  ).toBe("true")
  fireEvent.click(screen.getByRole("tab", { name: "Decisions" }))
  await waitFor(() => expect(controls.reviewProps?.allowImport).toBe(false))
  expect(controls.mounts).toBe(0)
  expect(screen.queryByText("Native draft")).toBeNull()
})
