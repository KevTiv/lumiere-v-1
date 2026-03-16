"use client"

import { useMemo } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { python } from "@codemirror/lang-python"
import { oneDark } from "@codemirror/theme-one-dark"
import { keymap } from "@codemirror/view"
import { defaultKeymap, historyKeymap, history } from "@codemirror/commands"

interface CodeMirrorEditorProps {
  value: string
  onChange: (value: string) => void
  onRunCell?: () => void
  onEscape?: () => void
  readOnly?: boolean
}

export function CodeMirrorEditor({
  value,
  onChange,
  onRunCell,
  onEscape,
  readOnly,
}: CodeMirrorEditorProps) {
  const extensions = useMemo(
    () => [
      python(),
      history(),
      keymap.of([
        {
          key: "Shift-Enter",
          run: () => {
            onRunCell?.()
            return true
          },
        },
        {
          key: "Escape",
          run: () => {
            onEscape?.()
            return false
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
    ],
    [onRunCell, onEscape],
  )

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={oneDark}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: false,
        highlightActiveLine: true,
        highlightSelectionMatches: false,
      }}
      style={{ fontSize: "12px" }}
    />
  )
}
