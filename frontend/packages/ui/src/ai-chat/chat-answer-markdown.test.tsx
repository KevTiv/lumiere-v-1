import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ChatAnswerMarkdown } from "./chat-answer-markdown"

afterEach(cleanup)

describe("ChatAnswerMarkdown", () => {
  it("renders GFM tables, code fences and links as readable transcript content", () => {
    render(
      <ChatAnswerMarkdown
        content={[
          "### Journal review",
          "| Account | Amount |\n| --- | ---: |\n| Electricity expense | 200 |",
          "```sql\nSELECT reference\n```",
          "[Open Accounting](/accounting)",
        ].join("\n\n")}
      />,
    )

    expect(screen.getByRole("heading", { name: "Journal review" })).toBeTruthy()
    const table = within(screen.getByRole("table"))
    expect(table.getByRole("columnheader", { name: "Amount" })).toBeTruthy()
    expect(table.getByRole("cell", { name: "200" }).style.textAlign).toBe(
      "right",
    )
    expect(screen.getByText("SELECT reference").closest("pre")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Open Accounting" })
        .getAttribute("href"),
    ).toBe("/accounting")
  })

  it("renders generated HTML as text and omits unsafe links and remote images", () => {
    const { container } = render(
      <ChatAnswerMarkdown
        content={[
          "[Click](javascript:alert(1))",
          "<div onclick='alert(1)'>A tag</div>",
          "![An image](https://example.com/image.jpg)",
        ].join("\n\n")}
      />,
    )
    expect(screen.getByText("Click")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Click" })).toBeNull()
    expect(screen.getByText("<div onclick='alert(1)'>A tag</div>")).toBeTruthy()
    expect(screen.getByText("An image")).toBeTruthy()
    expect(container.querySelector("img, [onclick]")).toBeNull()
  })
})
