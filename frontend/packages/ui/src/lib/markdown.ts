/**
 * A small Markdown reader for the subset `RichTextarea` writes: headings, bold, italic,
 * strikethrough, inline code, bulleted and numbered lists, quotes and links. It parses to plain
 * data so rendering never goes through raw HTML.
 */

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "em" | "strike"; children: MarkdownInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MarkdownInline[] }

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { kind: "paragraph"; lines: MarkdownInline[][] }
  | { kind: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { kind: "quote"; lines: MarkdownInline[][] }

const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

// Order matters: code first so its content is not formatted, links before emphasis.
const INLINE =
  /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/

/** Only web and mail links are followed; anything else (e.g. `javascript:`) stays text. */
export function safeMarkdownHref(href: string): string | null {
  const trimmed = href.trim()
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null
}

export function parseMarkdownInline(source: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let rest = source
  while (rest) {
    const match = INLINE.exec(rest)
    if (!match) {
      nodes.push({ kind: "text", text: rest })
      break
    }
    if (match.index > 0) nodes.push({ kind: "text", text: rest.slice(0, match.index) })
    const [whole, code, linkText, href, strong, strongAlt, strike, em, emAlt] = match
    if (code !== undefined) {
      nodes.push({ kind: "code", text: code })
    } else if (linkText !== undefined) {
      const safe = safeMarkdownHref(href ?? "")
      if (safe) nodes.push({ kind: "link", href: safe, children: parseMarkdownInline(linkText) })
      else nodes.push(...parseMarkdownInline(linkText))
    } else if (strong !== undefined || strongAlt !== undefined) {
      nodes.push({ kind: "strong", children: parseMarkdownInline(strong ?? strongAlt ?? "") })
    } else if (strike !== undefined) {
      nodes.push({ kind: "strike", children: parseMarkdownInline(strike) })
    } else {
      nodes.push({ kind: "em", children: parseMarkdownInline(em ?? emAlt ?? "") })
    }
    rest = rest.slice(match.index + whole.length)
  }
  return nodes
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  let index = 0

  const collect = (pattern: RegExp): string[] => {
    const collected: string[] = []
    while (index < lines.length) {
      const match = pattern.exec(lines[index])
      if (!match) break
      collected.push(match[1])
      index += 1
    }
    return collected
  }

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseMarkdownInline(heading[2]),
      })
      index += 1
    } else if (BULLET.test(line)) {
      blocks.push({ kind: "list", ordered: false, items: collect(BULLET).map(parseMarkdownInline) })
    } else if (ORDERED.test(line)) {
      blocks.push({ kind: "list", ordered: true, items: collect(ORDERED).map(parseMarkdownInline) })
    } else if (QUOTE.test(line)) {
      blocks.push({ kind: "quote", lines: collect(QUOTE).map(parseMarkdownInline) })
    } else {
      const paragraph: string[] = []
      while (
        index < lines.length &&
        lines[index].trim() &&
        ![HEADING, BULLET, ORDERED, QUOTE].some((pattern) => pattern.test(lines[index]))
      ) {
        paragraph.push(lines[index])
        index += 1
      }
      blocks.push({ kind: "paragraph", lines: paragraph.map(parseMarkdownInline) })
    }
  }

  return blocks
}

function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => ("children" in node ? inlineText(node.children) : node.text))
    .join("")
}

/** The text without Markdown markers, on one line: for table cells, exports and previews. */
export function markdownToPlainText(source: string): string {
  return parseMarkdown(source)
    .flatMap((block) => {
      if (block.kind === "heading") return [inlineText(block.children)]
      if (block.kind === "list") return block.items.map(inlineText)
      return block.lines.map(inlineText)
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}
