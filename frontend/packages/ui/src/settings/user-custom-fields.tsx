"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useRBAC } from "@/lib/rbac-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Plus,
  Pencil,
  Trash2,
  BookMarked,
  Sparkles,
  Target,
  TrendingUp,
  Clock,
  Hash,
  Star,
} from "lucide-react"
import type { UserCustomField, ConfigurableField, FieldType } from "@/lib/form-config-types"
import { sampleUserCustomFields } from "@/lib/form-config-types"

const simpleFieldTypes: { value: FieldType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "text", label: "Text", icon: Sparkles },
  { value: "number", label: "Number", icon: Hash },
  { value: "rating", label: "Rating (1-5)", icon: Star },
  { value: "slider", label: "Scale (1-10)", icon: TrendingUp },
  { value: "checkbox", label: "Yes/No", icon: Target },
  { value: "time", label: "Time", icon: Clock },
]

interface UserCustomFieldsProps {
  className?: string
}

export function UserCustomFields({ className }: UserCustomFieldsProps) {
  const { currentUser } = useRBAC()
  const [customFields, setCustomFields] = useState<UserCustomField[]>(
    sampleUserCustomFields.filter(f => f.userId === currentUser?.id)
  )
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<UserCustomField | null>(null)
  const [newField, setNewField] = useState<Partial<ConfigurableField>>({
    type: "text",
    isEnabled: true,
  })

  const handleAddField = () => {
    setEditingField(null)
    setNewField({
      type: "text",
      isEnabled: true,
    })
    setIsDialogOpen(true)
  }

  const handleEditField = (field: UserCustomField) => {
    setEditingField(field)
    setNewField(field.field)
    setIsDialogOpen(true)
  }

  const handleSaveField = () => {
    if (!newField.label || !newField.type) return

    const field: ConfigurableField = {
      id: editingField?.field.id || `custom-${Date.now()}`,
      name: newField.label?.toLowerCase().replace(/\s+/g, "_") || "",
      label: newField.label || "",
      type: newField.type as FieldType,
      description: newField.description,
      placeholder: newField.placeholder,
      isSystem: false,
      isEnabled: newField.isEnabled ?? true,
      order: 100 + customFields.length,
      validation: newField.validation,
    }

    if (editingField) {
      setCustomFields(prev => 
        prev.map(f => f.id === editingField.id ? { ...f, field } : f)
      )
    } else {
      const userCustomField: UserCustomField = {
        id: `ucf-${Date.now()}`,
        userId: currentUser?.id || "",
        formType: "journal",
        field,
        createdAt: new Date().toISOString(),
      }
      setCustomFields(prev => [...prev, userCustomField])
    }

    setIsDialogOpen(false)
    setEditingField(null)
    setNewField({ type: "text", isEnabled: true })
  }

  const handleDeleteField = (fieldId: string) => {
    setCustomFields(prev => prev.filter(f => f.id !== fieldId))
  }

  const handleToggleField = (fieldId: string, enabled: boolean) => {
    setCustomFields(prev => 
      prev.map(f => f.id === fieldId 
        ? { ...f, field: { ...f.field, isEnabled: enabled } } 
        : f
      )
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <BookMarked className="h-5 w-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">My Custom Journal Fields</CardTitle>
              <CardDescription>
                Add personal tracking fields to extend your daily journal
              </CardDescription>
            </div>
            <Button size="sm" onClick={handleAddField} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Field
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {customFields.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No custom fields yet</p>
              <p className="text-xs mt-1">Add fields to track metrics specific to your role</p>
            </div>
          ) : (
            <div className="space-y-3">
              {customFields.map((customField) => {
                const FieldIcon = simpleFieldTypes.find(t => t.value === customField.field.type)?.icon || Sparkles
                return (
                  <div
                    key={customField.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                      customField.field.isEnabled 
                        ? "bg-card border-border" 
                        : "bg-muted/50 border-transparent opacity-60"
                    )}
                  >
                    <div className="p-2 rounded-lg bg-muted">
                      <FieldIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{customField.field.label}</span>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {customField.field.type}
                        </Badge>
                      </div>
                      {customField.field.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {customField.field.description}
                        </p>
                      )}
                    </div>

                    <Switch
                      checked={customField.field.isEnabled}
                      onCheckedChange={(checked) => handleToggleField(customField.id, checked)}
                    />

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEditField(customField)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-600"
                      onClick={() => handleDeleteField(customField.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Suggestions */}
          <div className="mt-6 pt-6 border-t">
            <p className="text-sm font-medium mb-3">Suggested fields for your role</p>
            <div className="flex flex-wrap gap-2">
              {currentUser?.roles.includes("role-sales") && (
                <>
                  <SuggestedFieldChip
                    label="Calls Made"
                    type="number"
                    onClick={() => {
                      setNewField({ label: "Calls Made", type: "number", description: "Number of sales calls today" })
                      setIsDialogOpen(true)
                    }}
                  />
                  <SuggestedFieldChip
                    label="Pipeline Value"
                    type="number"
                    onClick={() => {
                      setNewField({ label: "Pipeline Value", type: "number", description: "Value added to pipeline ($)" })
                      setIsDialogOpen(true)
                    }}
                  />
                  <SuggestedFieldChip
                    label="Demos Given"
                    type="number"
                    onClick={() => {
                      setNewField({ label: "Demos Given", type: "number", description: "Product demos conducted" })
                      setIsDialogOpen(true)
                    }}
                  />
                </>
              )}
              {currentUser?.roles.includes("role-warehouse") && (
                <>
                  <SuggestedFieldChip
                    label="Orders Processed"
                    type="number"
                    onClick={() => {
                      setNewField({ label: "Orders Processed", type: "number", description: "Orders handled today" })
                      setIsDialogOpen(true)
                    }}
                  />
                  <SuggestedFieldChip
                    label="Safety Check"
                    type="checkbox"
                    onClick={() => {
                      setNewField({ label: "Safety Check Completed", type: "checkbox", description: "Daily safety inspection done" })
                      setIsDialogOpen(true)
                    }}
                  />
                </>
              )}
              {currentUser?.roles.includes("role-manager") && (
                <>
                  <SuggestedFieldChip
                    label="Team Meetings"
                    type="number"
                    onClick={() => {
                      setNewField({ label: "Team Meetings", type: "number", description: "Meetings attended today" })
                      setIsDialogOpen(true)
                    }}
                  />
                  <SuggestedFieldChip
                    label="1:1s Conducted"
                    type="number"
                    onClick={() => {
                      setNewField({ label: "1:1s Conducted", type: "number", description: "One-on-one meetings held" })
                      setIsDialogOpen(true)
                    }}
                  />
                </>
              )}
              <SuggestedFieldChip
                label="Focus Time"
                type="slider"
                onClick={() => {
                  setNewField({ 
                    label: "Focus Time", 
                    type: "slider", 
                    description: "Hours of uninterrupted work",
                    validation: { min: 0, max: 10 }
                  })
                  setIsDialogOpen(true)
                }}
              />
              <SuggestedFieldChip
                label="Work-Life Balance"
                type="rating"
                onClick={() => {
                  setNewField({ 
                    label: "Work-Life Balance", 
                    type: "rating", 
                    description: "Rate your balance today",
                    validation: { min: 1, max: 5 }
                  })
                  setIsDialogOpen(true)
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Field Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingField ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle>
            <DialogDescription>
              Create a personal tracking field for your daily journal
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="field-label">Field Label</Label>
              <Input
                id="field-label"
                value={newField.label || ""}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                placeholder="e.g., Calls Made, Focus Hours"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="field-type">Field Type</Label>
              <Select
                value={newField.type}
                onValueChange={(value) => setNewField({ ...newField, type: value as FieldType })}
              >
                <SelectTrigger id="field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {simpleFieldTypes.map((type) => {
                    const Icon = type.icon
                    return (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {type.label}
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="field-description">Description (optional)</Label>
              <Input
                id="field-description"
                value={newField.description || ""}
                onChange={(e) => setNewField({ ...newField, description: e.target.value })}
                placeholder="Help text for this field"
              />
            </div>

            {(newField.type === "slider" || newField.type === "number") && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-value">Min Value</Label>
                  <Input
                    id="min-value"
                    type="number"
                    value={newField.validation?.min || 0}
                    onChange={(e) => setNewField({ 
                      ...newField, 
                      validation: { ...newField.validation, min: parseInt(e.target.value) } 
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-value">Max Value</Label>
                  <Input
                    id="max-value"
                    type="number"
                    value={newField.validation?.max || 10}
                    onChange={(e) => setNewField({ 
                      ...newField, 
                      validation: { ...newField.validation, max: parseInt(e.target.value) } 
                    })}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveField} disabled={!newField.label}>
              {editingField ? "Save Changes" : "Add Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SuggestedFieldChip({ 
  label, 
  type, 
  onClick 
}: { 
  label: string
  type: FieldType
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors text-sm"
    >
      <Plus className="h-3 w-3" />
      {label}
      <Badge variant="outline" className="text-[10px] ml-1">
        {type}
      </Badge>
    </button>
  )
}
