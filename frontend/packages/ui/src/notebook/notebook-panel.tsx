"use client"

import { useState, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Play,
  Plus,
  Save,
  Download,
  Upload,
  RotateCcw,
  Code,
  FileText,
  Sparkles,
  X,
  ChevronRight,
  FolderOpen,
  File,
  Clock,
  Cpu,
  Database,
  BarChart3,
  BookOpen,
  PanelRightClose,
  Maximize2,
  Minimize2,
  Terminal,
  Settings,
  Layers,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NotebookCellComponent } from "./notebook-cell"
import type { Notebook, NotebookCell, CellOutput, KernelState } from "@/lib/notebook-types"
import { mlSnippets, reportTemplates } from "@/lib/notebook-types"

interface NotebookPanelProps {
  open: boolean
  onClose: () => void
  onAIChat?: (message: string) => void
  dataContext?: {
    sales?: unknown[]
    inventory?: unknown[]
    customers?: unknown[]
  }
}

// Generate unique IDs
const generateId = () => Math.random().toString(36).slice(2, 11)

// Create a new empty cell
const createCell = (type: "code" | "markdown"): NotebookCell => ({
  id: generateId(),
  type,
  content: "",
  outputs: [],
  status: "idle",
  createdAt: new Date(),
  updatedAt: new Date(),
})

// Simulated Python execution
const simulateExecution = async (code: string, context?: unknown): Promise<CellOutput> => {
  await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000))

  // Simple pattern matching for demo responses
  if (code.includes("print(") || code.includes("df.head()")) {
    const match = code.match(/print\(["'](.+?)["']\)/)
    if (match) {
      return {
        id: generateId(),
        type: "text",
        content: match[1],
        timestamp: new Date(),
        executionTime: Math.floor(Math.random() * 100) + 50,
      }
    }
    if (code.includes("df.head()")) {
      return {
        id: generateId(),
        type: "table",
        content: "DataFrame output",
        data: [
          ["", "date", "revenue", "orders", "customers"],
          ["0", "2024-01-01", "$12,450", "145", "89"],
          ["1", "2024-01-02", "$15,230", "178", "112"],
          ["2", "2024-01-03", "$11,890", "132", "78"],
          ["3", "2024-01-04", "$18,760", "203", "145"],
          ["4", "2024-01-05", "$14,320", "167", "98"],
        ],
        timestamp: new Date(),
        executionTime: Math.floor(Math.random() * 200) + 100,
      }
    }
  }

  if (code.includes("describe()")) {
    return {
      id: generateId(),
      type: "text",
      content: `       revenue    orders  customers
count     30.00     30.00      30.00
mean   14523.45    156.32      98.45
std     3245.67     34.21      28.12
min     8934.00     89.00      45.00
25%    12100.00    132.00      78.00
50%    14200.00    154.00      96.00
75%    16800.00    178.00     118.00
max    22450.00    234.00     167.00`,
      timestamp: new Date(),
      executionTime: Math.floor(Math.random() * 150) + 80,
    }
  }

  if (code.includes("plt.") || code.includes("plot")) {
    return {
      id: generateId(),
      type: "chart",
      content: "matplotlib figure rendered",
      timestamp: new Date(),
      executionTime: Math.floor(Math.random() * 300) + 200,
    }
  }

  if (code.includes("model.fit") || code.includes("LinearRegression") || code.includes("RandomForest")) {
    return {
      id: generateId(),
      type: "text",
      content: `Model trained successfully.
R² Score: 0.8734
RMSE: 1245.67
Features importance:
  - orders: 0.45
  - customers: 0.32
  - day_of_week: 0.23`,
      timestamp: new Date(),
      executionTime: Math.floor(Math.random() * 500) + 300,
    }
  }

  if (code.includes("import")) {
    return {
      id: generateId(),
      type: "text",
      content: "Modules imported successfully.",
      timestamp: new Date(),
      executionTime: Math.floor(Math.random() * 50) + 20,
    }
  }

  if (code.includes("error") || code.includes("Error")) {
    return {
      id: generateId(),
      type: "error",
      content: `Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
NameError: name 'undefined_var' is not defined`,
      timestamp: new Date(),
      executionTime: Math.floor(Math.random() * 30) + 10,
    }
  }

  // Default response
  return {
    id: generateId(),
    type: "text",
    content: code.includes("=") ? "" : `Out: ${code.slice(0, 50)}...`,
    timestamp: new Date(),
    executionTime: Math.floor(Math.random() * 100) + 30,
  }
}

export function NotebookPanel({ open, onClose, onAIChat, dataContext }: NotebookPanelProps) {
  const [notebook, setNotebook] = useState<Notebook>({
    id: generateId(),
    title: "Untitled Notebook",
    cells: [createCell("markdown"), createCell("code")],
    metadata: {
      kernelSpec: { name: "python3", language: "python", displayName: "Python 3" },
      category: "analysis",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  
  const [selectedCellId, setSelectedCellId] = useState<string | null>(notebook.cells[0]?.id || null)
  const [kernel, setKernel] = useState<KernelState>({
    status: "idle",
    executionCount: 0,
    variables: {},
    imports: [],
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeTab, setActiveTab] = useState<"notebook" | "files" | "variables">("notebook")
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const updateCell = useCallback((cellId: string, updates: Partial<NotebookCell>) => {
    setNotebook((prev) => ({
      ...prev,
      cells: prev.cells.map((c) => (c.id === cellId ? { ...c, ...updates, updatedAt: new Date() } : c)),
      updatedAt: new Date(),
    }))
  }, [])

  const addCell = useCallback((type: "code" | "markdown", afterId?: string) => {
    const newCell = createCell(type)
    setNotebook((prev) => {
      const index = afterId ? prev.cells.findIndex((c) => c.id === afterId) + 1 : prev.cells.length
      const newCells = [...prev.cells]
      newCells.splice(index, 0, newCell)
      return { ...prev, cells: newCells, updatedAt: new Date() }
    })
    setSelectedCellId(newCell.id)
  }, [])

  const deleteCell = useCallback((cellId: string) => {
    setNotebook((prev) => {
      if (prev.cells.length <= 1) return prev
      const newCells = prev.cells.filter((c) => c.id !== cellId)
      if (selectedCellId === cellId) {
        setSelectedCellId(newCells[0]?.id || null)
      }
      return { ...prev, cells: newCells, updatedAt: new Date() }
    })
  }, [selectedCellId])

  const moveCell = useCallback((cellId: string, direction: "up" | "down") => {
    setNotebook((prev) => {
      const index = prev.cells.findIndex((c) => c.id === cellId)
      if (index === -1) return prev
      if (direction === "up" && index === 0) return prev
      if (direction === "down" && index === prev.cells.length - 1) return prev
      
      const newCells = [...prev.cells]
      const newIndex = direction === "up" ? index - 1 : index + 1
      ;[newCells[index], newCells[newIndex]] = [newCells[newIndex], newCells[index]]
      return { ...prev, cells: newCells, updatedAt: new Date() }
    })
  }, [])

  const runCell = useCallback(async (cellId: string) => {
    const cell = notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.type !== "code") return

    setKernel((prev) => ({ ...prev, status: "busy" }))
    updateCell(cellId, { status: "running", outputs: [] })

    try {
      const output = await simulateExecution(cell.content, dataContext)
      setKernel((prev) => ({
        ...prev,
        status: "idle",
        executionCount: prev.executionCount + 1,
      }))
      updateCell(cellId, {
        status: "success",
        outputs: [output],
        executionCount: kernel.executionCount + 1,
      })
    } catch {
      setKernel((prev) => ({ ...prev, status: "idle" }))
      updateCell(cellId, {
        status: "error",
        outputs: [{
          id: generateId(),
          type: "error",
          content: "Execution failed",
          timestamp: new Date(),
        }],
      })
    }
  }, [notebook.cells, dataContext, kernel.executionCount, updateCell])

  const runAllCells = useCallback(async () => {
    for (const cell of notebook.cells) {
      if (cell.type === "code") {
        await runCell(cell.id)
      }
    }
  }, [notebook.cells, runCell])

  const clearAllOutputs = useCallback(() => {
    setNotebook((prev) => ({
      ...prev,
      cells: prev.cells.map((c) => ({ ...c, outputs: [], status: "idle" as const })),
    }))
    setKernel((prev) => ({ ...prev, executionCount: 0 }))
  }, [])

  const loadTemplate = useCallback((templateId: string) => {
    const template = reportTemplates.find((t) => t.id === templateId)
    if (!template) return

    const cells: NotebookCell[] = template.cells.map((c) => ({
      ...createCell(c.type as "code" | "markdown"),
      content: c.content || "",
    }))

    setNotebook((prev) => ({
      ...prev,
      title: template.name,
      cells,
      metadata: { ...prev.metadata, category: template.category },
      updatedAt: new Date(),
    }))
    setSelectedCellId(cells[0]?.id || null)
  }, [])

  const insertSnippet = useCallback((snippetKey: keyof typeof mlSnippets) => {
    if (!selectedCellId) return
    const cell = notebook.cells.find((c) => c.id === selectedCellId)
    if (!cell || cell.type !== "code") return
    
    updateCell(selectedCellId, {
      content: cell.content ? `${cell.content}\n\n${mlSnippets[snippetKey]}` : mlSnippets[snippetKey],
    })
  }, [selectedCellId, notebook.cells, updateCell])

  const handleAIAssist = useCallback((content: string) => {
    if (onAIChat) {
      onAIChat(`Help me with this Python code:\n\`\`\`python\n${content}\n\`\`\``)
    }
  }, [onAIChat])

  if (!open) return null

  return (
    <div
      className={cn(
        "flex flex-col bg-background border-l border-border",
        isFullscreen
          ? "fixed inset-0 z-50"
          : "h-screen w-[32vw] min-w-[400px] shrink-0"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <BookOpen className="h-3.5 w-3.5 text-white" />
          </div>
          {isEditingTitle ? (
            <Input
              ref={titleInputRef}
              value={notebook.title}
              onChange={(e) => setNotebook((prev) => ({ ...prev, title: e.target.value }))}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsEditingTitle(false)}
              className="h-7 w-48 text-sm"
              autoFocus
            />
          ) : (
            <span
              className="text-sm font-medium cursor-pointer hover:text-primary"
              onClick={() => setIsEditingTitle(true)}
            >
              {notebook.title}
            </span>
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-[9px] h-4",
              kernel.status === "busy" && "bg-blue-500/20 text-blue-400 border-blue-500/50",
              kernel.status === "idle" && "bg-green-500/20 text-green-400 border-green-500/50"
            )}
          >
            <Cpu className="h-2.5 w-2.5 mr-1" />
            {kernel.status}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={runAllCells} title="Run All">
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearAllOutputs} title="Clear Outputs">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Save">
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Export">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-muted/20">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => addCell("code", selectedCellId || undefined)}
        >
          <Plus className="h-3 w-3" />
          <Code className="h-3 w-3" />
          Code
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => addCell("markdown", selectedCellId || undefined)}
        >
          <Plus className="h-3 w-3" />
          <FileText className="h-3 w-3" />
          Markdown
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <Layers className="h-3 w-3" />
              Templates
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {reportTemplates.map((template) => (
              <DropdownMenuItem key={template.id} onClick={() => loadTemplate(template.id)}>
                <BarChart3 className="h-3.5 w-3.5 mr-2" />
                <div>
                  <p className="text-xs font-medium">{template.name}</p>
                  <p className="text-[10px] text-muted-foreground">{template.description}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <Terminal className="h-3 w-3" />
              Snippets
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => insertSnippet("imports")}>Import Libraries</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("loadData")}>Load Data</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("basicStats")}>Basic Statistics</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => insertSnippet("linearRegression")}>Linear Regression</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("forecast")}>Forecasting</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => insertSnippet("visualization")}>Visualization</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("reportSummary")}>Report Summary</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <Badge variant="outline" className="text-[9px] h-5">
          <Database className="h-2.5 w-2.5 mr-1" />
          ERP Data Connected
        </Badge>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-10 border-r border-border bg-muted/20 flex flex-col items-center py-2 gap-1">
          <Button
            variant={activeTab === "notebook" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTab("notebook")}
            title="Notebook"
          >
            <BookOpen className="h-4 w-4" />
          </Button>
          <Button
            variant={activeTab === "files" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTab("files")}
            title="Files"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button
            variant={activeTab === "variables" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTab("variables")}
            title="Variables"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === "notebook" && (
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3 max-w-4xl mx-auto">
                {notebook.cells.map((cell, index) => (
                  <NotebookCellComponent
                    key={cell.id}
                    cell={cell}
                    index={index}
                    isSelected={selectedCellId === cell.id}
                    onSelect={() => setSelectedCellId(cell.id)}
                    onUpdate={(updated) => updateCell(cell.id, updated)}
                    onDelete={() => deleteCell(cell.id)}
                    onMoveUp={() => moveCell(cell.id, "up")}
                    onMoveDown={() => moveCell(cell.id, "down")}
                    onRun={() => runCell(cell.id)}
                    onAIAssist={handleAIAssist}
                    canMoveUp={index > 0}
                    canMoveDown={index < notebook.cells.length - 1}
                  />
                ))}

                {/* Add cell button at bottom */}
                <div className="flex items-center justify-center gap-2 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => addCell("code")}
                  >
                    <Plus className="h-3 w-3" />
                    <Code className="h-3 w-3" />
                    Code
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => addCell("markdown")}
                  >
                    <Plus className="h-3 w-3" />
                    <FileText className="h-3 w-3" />
                    Markdown
                  </Button>
                </div>
              </div>
            </ScrollArea>
          )}

          {activeTab === "files" && (
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground mb-3">Recent Notebooks</p>
                {["Sales Analysis Q1.ipynb", "Customer Segmentation.ipynb", "Inventory Forecast.ipynb"].map((file) => (
                  <div
                    key={file}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                  >
                    <File className="h-3.5 w-3.5 text-orange-500" />
                    <span className="text-xs">{file}</span>
                  </div>
                ))}
                <div className="border-t border-border my-3" />
                <p className="text-xs font-medium text-muted-foreground mb-3">Data Sources</p>
                {["sales_data.csv", "inventory.csv", "customers.csv"].map((file) => (
                  <div
                    key={file}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                  >
                    <Database className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-xs">{file}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {activeTab === "variables" && (
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground mb-3">Kernel Variables</p>
                <div className="text-xs space-y-1 font-mono">
                  <div className="flex justify-between py-1 border-b border-border">
                    <span className="text-blue-400">df</span>
                    <span className="text-muted-foreground">DataFrame (30 rows)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border">
                    <span className="text-blue-400">model</span>
                    <span className="text-muted-foreground">LinearRegression</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border">
                    <span className="text-green-400">X_train</span>
                    <span className="text-muted-foreground">ndarray (24, 3)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border">
                    <span className="text-green-400">y_train</span>
                    <span className="text-muted-foreground">ndarray (24,)</span>
                  </div>
                </div>
                <div className="border-t border-border my-3" />
                <p className="text-xs font-medium text-muted-foreground mb-3">Execution Stats</p>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Cells executed:</span>
                    <span className="font-mono">{kernel.executionCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Kernel status:</span>
                    <span className="font-mono">{kernel.status}</span>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <div className={cn("w-1.5 h-1.5 rounded-full", kernel.status === "idle" ? "bg-green-500" : "bg-blue-500")} />
            Python 3.11
          </span>
          <span>{notebook.cells.length} cells</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            Last saved: Just now
          </span>
        </div>
      </div>
    </div>
  )
}
