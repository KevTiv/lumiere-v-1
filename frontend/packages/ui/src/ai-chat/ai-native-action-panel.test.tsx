import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { forwardRef, type ReactNode } from "react"
import type { AssistantAction } from "@lumiere/query-hooks/assistant-actions"
import type { ChatMessage } from "../lib/ai-chat-types"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: forwardRef<
    HTMLDivElement,
    { children: ReactNode; className?: string }
  >(function ScrollArea({ children, className }, ref) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    )
  }),
}))

import { AIChatPanel } from "./ai-chat-panel"

afterEach(cleanup)

const nativeAction: AssistantAction = {
  version: 1,
  kind: "open_record",
  capabilityKey: "sales.order.open",
  scope: { actorId: "actor-one", organizationId: "11", companyId: "22" },
  recordId: "9007199254740993",
}
const messages: ChatMessage[] = [
  {
    id: "answer-one",
    role: "assistant",
    content: "Open the requested sales order.",
    timestamp: new Date(0),
    actions: [
      {
        id: "native-one",
        type: "native",
        label: "Open requested order",
        nativeAction,
      },
    ],
  },
]

describe("native actions in the production chat panel", () => {
  it("renders the action from the answer and preserves an unsent question while opening it", async () => {
    const onNativeAction = vi.fn(async () => {})
    const onSendMessage = vi.fn()
    render(
      <AIChatPanel
        open
        onClose={vi.fn()}
        initialMessages={messages}
        config={{ onNativeAction }}
        onSendMessage={onSendMessage}
      />,
    )
    const button = await screen.findByRole("button", {
      name: "Open requested order",
    })
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), {
      target: { value: "My next unsent question" },
    })
    expect(onNativeAction).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() =>
      expect(onNativeAction).toHaveBeenCalledExactlyOnceWith(nativeAction, messages[0]!.id),
    )
    expect(
      (screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value,
    ).toBe("My next unsent question")
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it("cannot execute a restored action when the host has not supplied the current action handler", async () => {
    render(<AIChatPanel open onClose={vi.fn()} initialMessages={messages} />)
    expect(
      (
        (await screen.findByRole("button", {
          name: "Open requested order",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})
