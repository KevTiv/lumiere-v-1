import { Fragment, memo, type ReactNode } from "react"
import { marked, type MarkedToken, type Token } from "marked"
import { safeGuideHref } from "../lib/assistant-guide-types"

function renderTokens(tokens: readonly Token[]): ReactNode {
  return tokens.map((token, index) => (
    <Fragment key={index}>{renderToken(token as MarkedToken)}</Fragment>
  ))
}

function renderToken(token: MarkedToken): ReactNode {
  switch (token.type) {
    case "blockquote":
      return (
        <blockquote className="border-s border-border ps-3 text-muted-foreground">
          {renderTokens(token.tokens)}
        </blockquote>
      )
    case "br":
      return <br />
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={token.checked}
          disabled
          aria-hidden="true"
          className="me-2 accent-primary"
        />
      )
    case "code":
      return (
        <pre
          tabIndex={0}
          className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-5 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <code>{token.text}</code>
        </pre>
      )
    case "codespan":
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {token.text}
        </code>
      )
    case "del":
      return <del>{renderTokens(token.tokens)}</del>
    case "em":
      return <em>{renderTokens(token.tokens)}</em>
    case "escape":
    case "html":
    case "image":
      return token.text
    case "heading": {
      const Heading = token.depth <= 2 ? "h3" : token.depth <= 4 ? "h4" : "h5"
      return (
        <Heading className="mt-4 text-base leading-6 font-semibold">
          {renderTokens(token.tokens)}
        </Heading>
      )
    }
    case "hr":
      return <hr className="border-border" />
    case "link": {
      const href = safeGuideHref(token.href)
      const content = renderTokens(token.tokens)
      return href ? (
        <a href={href} className="text-primary underline underline-offset-2">
          {content}
        </a>
      ) : (
        content
      )
    }
    case "list": {
      const items = token.items.map((item, index) => (
        <li key={index}>{renderTokens(item.tokens)}</li>
      ))
      return token.ordered ? (
        <ol start={token.start || 1} className="list-decimal space-y-1 ps-5">
          {items}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 ps-5">{items}</ul>
      )
    }
    case "paragraph":
      return <p className="whitespace-pre-wrap">{renderTokens(token.tokens)}</p>
    case "strong":
      return (
        <strong className="font-semibold">{renderTokens(token.tokens)}</strong>
      )
    case "table":
      return (
        <div
          tabIndex={0}
          className="max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring"
        >
          <table className="w-full min-w-max text-start text-xs">
            <thead className="bg-muted/60">
              <tr>
                {token.header.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    style={{ textAlign: cell.align ?? undefined }}
                    className="px-3 py-2 text-start font-medium"
                  >
                    {renderTokens(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {row.map((cell, col) => (
                    <td
                      key={col}
                      style={{ textAlign: cell.align ?? undefined }}
                      className="max-w-[24ch] px-3 py-2 text-start"
                    >
                      {renderTokens(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "text":
      return token.tokens ? renderTokens(token.tokens) : token.text
    case "def":
    case "space":
    case "list_item":
      return null
    default:
      return null
  }
}

/** Format admitted reply text without mounting an editor or treating generated HTML as markup. */
export const ChatAnswerMarkdown = memo(function ChatAnswerMarkdown({
  content,
}: {
  content: string
}) {
  let formatted: ReactNode
  try {
    formatted = renderTokens(marked.lexer(content, { gfm: true }))
  } catch {
    formatted = <p className="whitespace-pre-wrap">{content}</p>
  }
  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere] [&>:first-child]:mt-0">
      {formatted}
    </div>
  )
})
