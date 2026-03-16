"use client"

import { useState } from "react"
import { useRBAC } from "@/lib/rbac-context"
import { resourceGroups } from "@/lib/rbac-defaults"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Shield,
  Lock,
  Check,
  X
} from "lucide-react"
import type { Role, PolicyRule, Resource, Action } from "@/lib/rbac-types"

const roleColors = [
  { value: "blue", label: "Blue", class: "bg-blue-500" },
  { value: "green", label: "Green", class: "bg-green-500" },
  { value: "orange", label: "Orange", class: "bg-orange-500" },
  { value: "red", label: "Red", class: "bg-red-500" },
  { value: "purple", label: "Purple", class: "bg-purple-500" },
  { value: "teal", label: "Teal", class: "bg-teal-500" },
] as const

export function RoleManagement() {
  const { roles, setRoles, checkPermission } = useRBAC()
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedPermissions, setSelectedPermissions] = useState<Map<string, Set<Action>>>(new Map())
  const [selectedColor, setSelectedColor] = useState<Role["color"]>("blue")

  const canEdit = checkPermission("admin:roles", "update").allowed
  const canDelete = checkPermission("admin:roles", "delete").allowed
  const canCreate = checkPermission("admin:roles", "create").allowed

  const initializePermissions = (role: Role | null) => {
    const permMap = new Map<string, Set<Action>>()
    
    if (role) {
      // Check for wildcard permission
      const hasWildcard = role.permissions.some(p => p.resource === "*" && p.action === "*")
      
      if (hasWildcard) {
        // Set all permissions
        resourceGroups.forEach(group => {
          group.resources.forEach(res => {
            permMap.set(res.resource, new Set(res.actions))
          })
        })
      } else {
        role.permissions.forEach(perm => {
          if (perm.effect === "allow") {
            const existing = permMap.get(perm.resource as string) || new Set()
            if (perm.action === "*") {
              const resourceDef = resourceGroups
                .flatMap(g => g.resources)
                .find(r => r.resource === perm.resource)
              if (resourceDef) {
                resourceDef.actions.forEach(a => existing.add(a))
              }
            } else {
              existing.add(perm.action)
            }
            permMap.set(perm.resource as string, existing)
          }
        })
      }
    }
    
    setSelectedPermissions(permMap)
  }

  const handleEditRole = (role: Role) => {
    setEditingRole(role)
    setSelectedColor(role.color)
    initializePermissions(role)
    setIsDialogOpen(true)
  }

  const handleCreateRole = () => {
    setEditingRole(null)
    setSelectedColor("blue")
    setSelectedPermissions(new Map())
    setIsDialogOpen(true)
  }

  const handleTogglePermission = (resource: Resource, action: Action) => {
    setSelectedPermissions(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(resource) || new Set()
      
      if (existing.has(action)) {
        existing.delete(action)
        if (existing.size === 0) {
          newMap.delete(resource)
        }
      } else {
        existing.add(action)
        newMap.set(resource, existing)
      }
      
      return newMap
    })
  }

  const handleToggleAllActions = (resource: Resource, actions: Action[]) => {
    setSelectedPermissions(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(resource) || new Set()
      const allSelected = actions.every(a => existing.has(a))
      
      if (allSelected) {
        newMap.delete(resource)
      } else {
        newMap.set(resource, new Set(actions))
      }
      
      return newMap
    })
  }

  const handleSaveRole = (formData: FormData) => {
    const name = formData.get("name") as string
    const description = formData.get("description") as string

    // Convert permissions map to policy rules
    const permissions: PolicyRule[] = []
    selectedPermissions.forEach((actions, resource) => {
      actions.forEach(action => {
        permissions.push({
          id: `perm-${Date.now()}-${resource}-${action}`,
          subject: editingRole?.id || `role-${Date.now()}`,
          resource: resource as Resource,
          action,
          effect: "allow"
        })
      })
    })

    if (editingRole) {
      setRoles(prev => prev.map(r => 
        r.id === editingRole.id 
          ? { 
              ...r, 
              name, 
              description, 
              color: selectedColor,
              permissions,
              updatedAt: new Date().toISOString() 
            }
          : r
      ))
    } else {
      const newRole: Role = {
        id: `role-${Date.now()}`,
        name,
        description,
        isSystem: false,
        color: selectedColor,
        permissions,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setRoles(prev => [...prev, newRole])
    }
    setIsDialogOpen(false)
  }

  const handleDeleteRole = (roleId: string) => {
    const role = roles.find(r => r.id === roleId)
    if (role?.isSystem) {
      alert("System roles cannot be deleted")
      return
    }
    if (confirm("Are you sure you want to delete this role?")) {
      setRoles(prev => prev.filter(r => r.id !== roleId))
    }
  }

  const getRoleColorClass = (color: Role["color"]) => {
    const colorMap: Record<string, string> = {
      red: "bg-red-500/10 text-red-400 border-red-500/20",
      purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
      blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
      teal: "bg-teal-500/10 text-teal-400 border-teal-500/20",
      green: "bg-green-500/10 text-green-400 border-green-500/20",
    }
    return colorMap[color] || colorMap.blue
  }

  const countPermissions = (role: Role): number => {
    if (role.permissions.some(p => p.resource === "*" && p.action === "*")) {
      return resourceGroups.reduce((acc, group) => 
        acc + group.resources.reduce((a, r) => a + r.actions.length, 0), 0
      )
    }
    return role.permissions.filter(p => p.effect === "allow").length
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Roles</h3>
          <p className="text-sm text-muted-foreground">
            Configure roles and their associated permissions using Casbin-style policies
          </p>
        </div>
        {canCreate && (
          <Button onClick={handleCreateRole} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Role
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.id} className="relative">
            {role.isSystem && (
              <Badge 
                variant="outline" 
                className="absolute top-3 right-3 gap-1 text-xs"
              >
                <Lock className="h-3 w-3" />
                System
              </Badge>
            )}
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${getRoleColorClass(role.color)}`}>
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{role.name}</CardTitle>
                  <CardDescription className="text-sm mt-1">
                    {role.description}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {countPermissions(role)} permissions
                </div>
                <div className="flex gap-2">
                  {canEdit && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleEditRole(role)}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  )}
                  {canDelete && !role.isSystem && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleDeleteRole(role.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? `Edit Role: ${editingRole.name}` : "Create New Role"}
            </DialogTitle>
            <DialogDescription>
              Define the role and configure its access permissions
            </DialogDescription>
          </DialogHeader>
          <form action={handleSaveRole} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Role Name</Label>
                <Input 
                  id="name" 
                  name="name"
                  defaultValue={editingRole?.name}
                  required
                  disabled={editingRole?.isSystem}
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2">
                  {roleColors.map(color => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setSelectedColor(color.value)}
                      className={`w-8 h-8 rounded-full ${color.class} flex items-center justify-center transition-transform ${
                        selectedColor === color.value ? "ring-2 ring-offset-2 ring-offset-background ring-primary scale-110" : ""
                      }`}
                    >
                      {selectedColor === color.value && (
                        <Check className="h-4 w-4 text-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea 
                id="description" 
                name="description"
                defaultValue={editingRole?.description}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <Card>
                <CardContent className="p-0">
                  <Accordion type="multiple" className="w-full">
                    {resourceGroups.map((group) => (
                      <AccordionItem key={group.id} value={group.id}>
                        <AccordionTrigger className="px-4 hover:no-underline">
                          <span className="font-medium">{group.label}</span>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          <div className="space-y-3">
                            {group.resources.map((resource) => {
                              const currentPerms = selectedPermissions.get(resource.resource) || new Set()
                              const allSelected = resource.actions.every(a => currentPerms.has(a))
                              
                              return (
                                <div key={resource.resource} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                                  <div className="flex items-center gap-3">
                                    <Switch
                                      checked={allSelected}
                                      onCheckedChange={() => handleToggleAllActions(resource.resource, resource.actions)}
                                    />
                                    <span className="text-sm">{resource.label}</span>
                                  </div>
                                  <div className="flex gap-1">
                                    {resource.actions.map(action => (
                                      <Badge
                                        key={action}
                                        variant="outline"
                                        className={`cursor-pointer transition-colors ${
                                          currentPerms.has(action)
                                            ? "bg-primary/10 text-primary border-primary"
                                            : "opacity-50"
                                        }`}
                                        onClick={() => handleTogglePermission(resource.resource, action)}
                                      >
                                        {currentPerms.has(action) ? (
                                          <Check className="h-3 w-3 mr-1" />
                                        ) : (
                                          <X className="h-3 w-3 mr-1" />
                                        )}
                                        {action}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingRole ? "Save Changes" : "Create Role"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
