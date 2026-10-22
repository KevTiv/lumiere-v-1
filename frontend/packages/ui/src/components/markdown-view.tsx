"use client"

import * as React from "react"
import { EditorContent, useEditor } from "@tiptap/react"

import { cn } from "@lumiere/ui/lib/utils"
import {
  createRichTextExtensions,
  richTextContentClassName,
  serializeRichTextMarkdown,
} from "@lumiere/ui/lib/rich-text-extensions"

type MarkdownViewProps = {
  /** Markdown written by the rich text editor (plain text renders as-is). */
  value: string | null | undefined
  className?: string
}

/**
 * Read-only rendering of Markdown stored by `Textarea`/`RichTextEditor`. It
 * reuses the editor's extension set so formatting renders exactly as written.
 */
function MarkdownView({ value, className }: MarkdownViewProps) {
  const markdown = value ?? ""
  const extensions = React.useMemo(() => createRichTextExtensions(), [])
  const editor = useEditor(
    {
      extensions,
      content: markdown,
      contentType: "markdown",
      editable: false,
      immediatelyRender: false,
      editorProps: {
        attributes: { class: cn("outline-none", richTextContentClassName) },
      },
    },
    [extensions]
  )

  React.useEffect(() => {
    if (!editor || serializeRichTextMarkdown(editor) === markdown.trimEnd()) return
    editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false })
  }, [editor, markdown])

  return (
    <div data-slot="markdown-view" className={cn("min-w-0", className)}>
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className={cn("whitespace-pre-wrap", richTextContentClassName)}>{markdown}</div>
      )}
    </div>
  )
}

export { MarkdownView }
export type { MarkdownViewProps }
