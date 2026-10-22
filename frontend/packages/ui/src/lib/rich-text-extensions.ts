import type { Editor, Extensions } from "@tiptap/react"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import { CharacterCount, Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import StarterKit from "@tiptap/starter-kit"

type RichTextExtensionOptions = {
  placeholder?: string
  maxLength?: number
}

/**
 * The single extension set shared by the editor and the read-only Markdown
 * view, so anything one can write the other can render.
 */
export function createRichTextExtensions({
  placeholder,
  maxLength,
}: RichTextExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder: placeholder ?? "" }),
    CharacterCount.configure({ limit: maxLength ?? null }),
    Markdown,
  ]
}

/** Typography for editor and viewer content (no Tailwind typography plugin here). */
export const richTextContentClassName = [
  "text-sm leading-6 break-words",
  "[&_p]:my-1.5 first:[&_p]:mt-0",
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-xl [&_h1]:font-semibold",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li>p]:my-0.5",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0.5",
  "[&_ul[data-type=taskList]>li]:flex [&_ul[data-type=taskList]>li]:items-start [&_ul[data-type=taskList]>li]:gap-2",
  "[&_ul[data-type=taskList]>li>label]:relative [&_ul[data-type=taskList]>li>label]:mt-1 [&_ul[data-type=taskList]>li>div]:flex-1 [&_ul[data-type=taskList]>li>div>p]:my-0",
  "[&_li[data-checked=true]>div]:text-muted-foreground [&_li[data-checked=true]>div]:line-through",
  "[&_input[type=checkbox]]:size-3.5 [&_input[type=checkbox]]:accent-primary",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-3 [&_hr]:border-border",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  "[&_.selectedCell]:bg-primary/10",
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
].join(" ")

const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/
const HTML_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, "&"],
]

/**
 * Markdown from the editor, cleaned so the stored string stays readable where
 * it is shown raw (PDFs, exports, emails): HTML entities are decoded and
 * intra-word underscores are left unescaped. Code spans and blocks are kept
 * verbatim. The editor parses both forms back to the same document.
 */
export function serializeRichTextMarkdown(editor: Editor): string {
  if (editor.isEmpty) return ""
  return editor
    .getMarkdown()
    .split(CODE_SEGMENT)
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      let text = segment.replace(/(\w)\\_(?=\w)/g, "$1_")
      for (const [pattern, replacement] of HTML_ENTITIES) {
        text = text.replace(pattern, replacement)
      }
      return text
    })
    .join("")
    .replace(/^\n+/, "")
    .trimEnd()
}
