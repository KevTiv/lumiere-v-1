"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Play,
  Square,
  Trash2,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
  MoreHorizontal,
  Code,
  FileText,
  Sparkles,
  GripVertical,
  Eye,
  EyeOff,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { NotebookCell, CellOutput } from "@/lib/notebook-types"

interface NotebookCellProps {
  cell: NotebookCell
  index: number
  isSelected: boolean
  onSelect: () => void
  onUpdate: (cell: NotebookCell) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRun: () => void
  onAIAssist: (content: string) => void
  canMoveUp: boolean
  canMoveDown: boolean
}

export function NotebookCellComponent({
  cell,
  index,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onRun,
  onAIAssist,
  canMoveUp,
  canMoveDown,
}: NotebookCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showOutput, setShowOutput] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px"
    }
  }, [isEditing, cell.content])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cell.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleContentChange = (value: string) => {
    onUpdate({ ...cell, content: value, updatedAt: new Date() })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault()
      onRun()
      setIsEditing(false)
    }
    if (e.key === "Escape") {
      setIsEditing(false)
    }
  }

  const getStatusColor = () => {
    switch (cell.status) {
      case "running": return "bg-blue-500"
      case "success": return "bg-green-500"
      case "error": return "bg-red-500"
      default: return "bg-muted-foreground/30"
    }
  }

  const renderOutput = (output: CellOutput) => {
    switch (output.type) {
      case "text":
        return (
          <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono">
            {output.content}
          </pre>
        )
      case "error":
        return (
          <pre className="text-xs text-red-400 whitespace-pre-wrap font-mono bg-red-500/10 p-2 rounded">
            {output.content}
          </pre>
        )
      case "table":
        return (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <tbody>
                {(output.data as string[][])?.map((row, i) => (
                  <tr key={i} className={i === 0 ? "font-semibold bg-muted" : ""}>
                    {row.map((cell, j) => (
                      <td key={j} className="border border-border px-2 py-1">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case "chart":
        return (
          <div className="bg-muted/30 rounded-lg p-4 flex items-center justify-center min-h-[200px]">
            <div className="text-center text-muted-foreground">
              <div className="text-4xl mb-2">📊</div>
              <p className="text-xs">Chart visualization</p>
              <p className="text-[10px] text-muted-foreground/60">{output.content}</p>
            </div>
          </div>
        )
      default:
        return <pre className="text-xs whitespace-pre-wrap">{output.content}</pre>
    }
  }

  return (
    <div
      className={cn(
        "group relative border rounded-lg transition-all",
        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
      )}
      onClick={onSelect}
    >
      {/* Cell toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-1">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab" />
          <div className={cn("w-2 h-2 rounded-full", getStatusColor())} />
          {cell.executionCount !== undefined && (
            <span className="text-[10px] text-muted-foreground font-mono">
              [{cell.executionCount}]
            </span>
          )}
        </div>

        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
          {cell.type === "code" ? <Code className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
          {cell.type}
        </Badge>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {cell.type === "code" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); onRun() }}
              disabled={cell.status === "running"}
              title="Run cell (Shift+Enter)"
            >
              {cell.status === "running" ? (
                <Square className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onAIAssist(cell.content) }}
            title="AI Assist"
          >
            <Sparkles className="h-3 w-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); handleCopy() }}
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onMoveUp} disabled={!canMoveUp}>
                <ChevronUp className="h-3.5 w-3.5 mr-2" />
                Move Up
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onMoveDown} disabled={!canMoveDown}>
                <ChevronDown className="h-3.5 w-3.5 mr-2" />
                Move Down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowOutput(!showOutput)}>
                {showOutput ? <EyeOff className="h-3.5 w-3.5 mr-2" /> : <Eye className="h-3.5 w-3.5 mr-2" />}
                {showOutput ? "Hide Output" : "Show Output"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Cell content */}
      <div className="p-3">
        {isEditing || isSelected ? (
          <textarea
            ref={textareaRef}
            value={cell.content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setIsEditing(false)}
            onFocus={() => setIsEditing(true)}
            className={cn(
              "w-full bg-transparent border-none outline-none resize-none font-mono text-xs",
              "placeholder:text-muted-foreground/50",
              cell.type === "markdown" && "font-sans"
            )}
            placeholder={cell.type === "code" ? "# Enter Python code..." : "Enter markdown..."}
            rows={Math.max(3, cell.content.split("\n").length)}
          />
        ) : (
          <div
            className={cn(
              "text-xs cursor-text min-h-[60px]",
              cell.type === "code" ? "font-mono" : "font-sans prose prose-sm dark:prose-invert max-w-none"
            )}
            onClick={() => setIsEditing(true)}
          >
            {cell.type === "code" ? (
              <pre className="whitespace-pre-wrap text-foreground/90">
                {cell.content || <span className="text-muted-foreground/50"># Enter Python code...</span>}
              </pre>
            ) : (
              <div className="whitespace-pre-wrap">
                {cell.content || <span className="text-muted-foreground/50">Enter markdown...</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Output section */}
      {cell.outputs.length > 0 && showOutput && (
        <div className="border-t border-border bg-muted/20 p-3 space-y-2">
          {cell.outputs.map((output) => (
            <div key={output.id}>
              {renderOutput(output)}
              {output.executionTime && (
                <p className="text-[9px] text-muted-foreground mt-1">
                  Executed in {output.executionTime}ms
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
