const SAFE_LINK_PROTOCOL = /^(https?:|mailto:|tel:|\/)/i

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function renderInlineMarkdown(value: string) {
  let html = escapeHtml(value)

  html = html.replace(/`\s*([^`\n]+?)\s*`/g, "<code>$1</code>")
  html = html.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (_match, label: string, href: string) => {
      if (!SAFE_LINK_PROTOCOL.test(href)) return label
      return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
    }
  )
  html = html.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, "<strong>$1</strong>")
  html = html.replace(/~~\s*([^~\n]+?)\s*~~/g, "<s>$1</s>")
  html = html.replace(/_\s*([^_\n]+?)\s*_/g, "<em>$1</em>")
  html = html.replace(
    /(^|[\s(])\*\s*([^*\n]+?)\s*\*(?=$|[\s.,!?;:)])/g,
    "$1<em>$2</em>"
  )

  return html
}

/** Convert the Markdown string stored by forms into safe rich-editor HTML. */
export function markdownToRichTextHtml(markdown: string) {
  if (!markdown) return ""

  const output: string[] = []
  const lines = markdown.replaceAll("\r\n", "\n").split("\n")
  let activeList: "ul" | "ol" | null = null

  const closeList = () => {
    if (!activeList) return
    output.push(`</${activeList}>`)
    activeList = null
  }

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/)

    if (bullet || numbered) {
      const listType = bullet ? "ul" : "ol"
      if (activeList !== listType) {
        closeList()
        activeList = listType
        output.push(`<${listType}>`)
      }
      output.push(`<li>${renderInlineMarkdown((bullet ?? numbered)?.[1] ?? "")}</li>`)
      continue
    }

    closeList()

    const heading = line.match(/^##\s+(.+)$/)
    const quote = line.match(/^>\s?(.*)$/)
    if (heading) {
      output.push(`<h2>${renderInlineMarkdown(heading[1])}</h2>`)
    } else if (quote) {
      output.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`)
    } else if (line.length === 0) {
      output.push("<p><br></p>")
    } else {
      output.push(`<p>${renderInlineMarkdown(line)}</p>`)
    }
  }

  closeList()
  return output.join("")
}

function serializeChildren(node: Node): string {
  return Array.from(node.childNodes, serializeNode).join("")
}

function serializeListItem(node: Node) {
  return serializeChildren(node).replace(/\n+/g, " ").trim()
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ""
  }

  if (!(node instanceof HTMLElement)) return ""

  const children = serializeChildren(node)
  switch (node.tagName) {
    case "BR":
      return "\n"
    case "STRONG":
    case "B":
      return `**${children.trim()}**`
    case "EM":
    case "I":
      return `_${children.trim()}_`
    case "S":
    case "STRIKE":
    case "DEL":
      return `~~${children.trim()}~~`
    case "CODE":
      return `\`${children.trim()}\``
    case "A": {
      const href = node.getAttribute("href") ?? ""
      return href && SAFE_LINK_PROTOCOL.test(href)
        ? `[${children}](${href})`
        : children
    }
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return `## ${children.trim()}\n`
    case "BLOCKQUOTE":
      return `${children
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`
    case "UL":
      return `${Array.from(node.children)
        .map((item) => `- ${serializeListItem(item)}`)
        .join("\n")}\n`
    case "OL":
      return `${Array.from(node.children)
        .map((item, index) => `${index + 1}. ${serializeListItem(item)}`)
        .join("\n")}\n`
    case "LI":
      return children
    case "DIV":
    case "P":
    case "PRE":
      return `${children}\n`
    default:
      return children
  }
}

/** Convert browser-produced editor HTML back to the Markdown form contract. */
export function richTextElementToMarkdown(element: HTMLElement) {
  return serializeChildren(element)
    .replaceAll("\u00a0", " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
}
