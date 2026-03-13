"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  FileText,
  AlertTriangle,
  Calendar,
  User,
  Building2,
  Tag,
  Plus,
  X,
  Lightbulb,
} from "lucide-react"
import type { ForensicReport, IncidentCategory, IncidentSeverity } from "@/lib/forensic-report-types"
import { incidentCategories, severityConfig, reportTemplates } from "@/lib/forensic-report-types"

interface CreateReportModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Partial<ForensicReport>) => void
}

export function CreateReportModal({ open, onClose, onSubmit }: CreateReportModalProps) {
  const [step, setStep] = useState<"template" | "details">("template")
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  
  const [formData, setFormData] = useState<Partial<ForensicReport>>({
    title: "",
    summary: "",
    description: "",
    category: "other",
    severity: "medium",
    incidentDate: new Date().toISOString().split("T")[0],
    reportedBy: "",
    assignedTo: "",
    department: "",
    tags: [],
    immediateActions: [],
  })

  const [newTag, setNewTag] = useState("")
  const [newAction, setNewAction] = useState("")

  const handleTemplateSelect = (templateId: string) => {
    const template = reportTemplates.find(t => t.id === templateId)
    if (template) {
      setSelectedTemplate(templateId)
      setFormData(prev => ({
        ...prev,
        category: template.category,
        severity: template.defaultSeverity,
      }))
    }
    setStep("details")
  }

  const handleSkipTemplate = () => {
    setSelectedTemplate(null)
    setStep("details")
  }

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags?.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), newTag.trim()],
      }))
      setNewTag("")
    }
  }

  const handleRemoveTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags?.filter(t => t !== tag) || [],
    }))
  }

  const handleAddAction = () => {
    if (newAction.trim()) {
      setFormData(prev => ({
        ...prev,
        immediateActions: [...(prev.immediateActions || []), newAction.trim()],
      }))
      setNewAction("")
    }
  }

  const handleRemoveAction = (action: string) => {
    setFormData(prev => ({
      ...prev,
      immediateActions: prev.immediateActions?.filter(a => a !== action) || [],
    }))
  }

  const handleSubmit = () => {
    onSubmit(formData)
    // Reset form
    setStep("template")
    setSelectedTemplate(null)
    setFormData({
      title: "",
      summary: "",
      description: "",
      category: "other",
      severity: "medium",
      incidentDate: new Date().toISOString().split("T")[0],
      reportedBy: "",
      assignedTo: "",
      department: "",
      tags: [],
      immediateActions: [],
    })
  }

  const template = selectedTemplate ? reportTemplates.find(t => t.id === selectedTemplate) : null

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {step === "template" ? "Create Incident Report" : "Report Details"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          {step === "template" ? (
            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-1">Start from a Template</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Choose a template to pre-fill common fields, or start from scratch
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {reportTemplates.map((template) => {
                    const categoryConfig = incidentCategories[template.category]
                    return (
                      <button
                        key={template.id}
                        onClick={() => handleTemplateSelect(template.id)}
                        className={cn(
                          "p-4 rounded-lg border border-border text-left hover:border-primary/50 transition-colors",
                          "hover:bg-accent/50"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{template.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {template.description}
                            </p>
                            <Badge variant="secondary" className="mt-2 text-xs">
                              {categoryConfig.label}
                            </Badge>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={handleSkipTemplate}>
                Start from Scratch
              </Button>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {template && (
                <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    <span className="font-medium">Using template: {template.name}</span>
                  </div>
                </div>
              )}

              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    placeholder="Brief description of the incident"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="summary">Summary *</Label>
                  <Textarea
                    id="summary"
                    placeholder="One-line summary of what happened"
                    value={formData.summary}
                    onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
                    className="mt-1.5"
                    rows={2}
                  />
                </div>

                <div>
                  <Label htmlFor="description">Full Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Detailed description of the incident, including context and circumstances"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    className="mt-1.5"
                    rows={4}
                  />
                </div>
              </div>

              {/* Classification */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value: IncidentCategory) => setFormData(prev => ({ ...prev, category: value }))}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(incidentCategories).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Severity</Label>
                  <Select
                    value={formData.severity}
                    onValueChange={(value: IncidentSeverity) => setFormData(prev => ({ ...prev, severity: value }))}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(severityConfig).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="incidentDate">Incident Date</Label>
                  <Input
                    id="incidentDate"
                    type="date"
                    value={formData.incidentDate?.split("T")[0]}
                    onChange={(e) => setFormData(prev => ({ ...prev, incidentDate: e.target.value }))}
                    className="mt-1.5"
                  />
                </div>
              </div>

              {/* Assignment */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="reportedBy">Reported By</Label>
                  <Input
                    id="reportedBy"
                    placeholder="Your name"
                    value={formData.reportedBy}
                    onChange={(e) => setFormData(prev => ({ ...prev, reportedBy: e.target.value }))}
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="assignedTo">Assign To</Label>
                  <Input
                    id="assignedTo"
                    placeholder="Lead investigator"
                    value={formData.assignedTo}
                    onChange={(e) => setFormData(prev => ({ ...prev, assignedTo: e.target.value }))}
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="department">Department</Label>
                  <Input
                    id="department"
                    placeholder="e.g., Operations"
                    value={formData.department}
                    onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                    className="mt-1.5"
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <Label>Tags</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Input
                    placeholder="Add a tag"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                    className="flex-1"
                  />
                  <Button type="button" variant="secondary" size="icon" onClick={handleAddTag}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {formData.tags && formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        {tag}
                        <button onClick={() => handleRemoveTag(tag)} className="ml-1 hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {template && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Suggested tags for this template: {template.suggestedActions.slice(0, 3).join(", ")}
                  </p>
                )}
              </div>

              {/* Immediate Actions */}
              <div>
                <Label>Immediate Actions Taken</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Input
                    placeholder="Describe action taken"
                    value={newAction}
                    onChange={(e) => setNewAction(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddAction())}
                    className="flex-1"
                  />
                  <Button type="button" variant="secondary" size="icon" onClick={handleAddAction}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {formData.immediateActions && formData.immediateActions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {formData.immediateActions.map((action, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm bg-muted px-3 py-2 rounded-lg">
                        <span className="flex-1">{action}</span>
                        <button onClick={() => handleRemoveAction(action)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {template && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">Suggested actions:</p>
                    <div className="flex flex-wrap gap-1">
                      {template.suggestedActions.map((action, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (!formData.immediateActions?.includes(action)) {
                              setFormData(prev => ({
                                ...prev,
                                immediateActions: [...(prev.immediateActions || []), action],
                              }))
                            }
                          }}
                          className="text-xs px-2 py-1 bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
                        >
                          + {action}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="p-4 border-t border-border">
          {step === "details" && (
            <Button variant="ghost" onClick={() => setStep("template")}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {step === "details" && (
            <Button
              onClick={handleSubmit}
              disabled={!formData.title || !formData.summary}
            >
              Create Report
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
