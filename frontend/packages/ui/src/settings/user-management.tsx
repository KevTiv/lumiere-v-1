"use client"

import { useState } from "react"
import { useRBAC } from "@/lib/rbac-context"
import { defaultUsers } from "@/lib/rbac-defaults"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { 
  Search, 
  Plus, 
  MoreHorizontal, 
  Pencil, 
  Trash2, 
  UserCheck,
  UserX,
  Mail
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { User, Role } from "@/lib/rbac-types"
import { useTranslation } from "@lumiere/i18n"
import { rolePillClassForColor, userStatusPillClass } from "@/lib/theme-colors"

export function UserManagement() {
  const { t } = useTranslation()
  const { roles, checkPermission } = useRBAC()
  const [users, setUsers] = useState<User[]>(defaultUsers)
  const [searchQuery, setSearchQuery] = useState("")
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])

  const canEdit = checkPermission("admin:users", "update").allowed
  const canDelete = checkPermission("admin:users", "delete").allowed
  const canCreate = checkPermission("admin:users", "create").allowed

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.department?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleEditUser = (user: User) => {
    setEditingUser(user)
    setSelectedRoles(user.roles)
    setIsDialogOpen(true)
  }

  const handleCreateUser = () => {
    setEditingUser(null)
    setSelectedRoles([])
    setIsDialogOpen(true)
  }

  const handleSaveUser = (formData: FormData) => {
    const userData = {
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      department: formData.get("department") as string,
      status: formData.get("status") as "active" | "inactive" | "pending",
      roles: selectedRoles,
    }

    if (editingUser) {
      setUsers(prev => prev.map(u => 
        u.id === editingUser.id 
          ? { ...u, ...userData, updatedAt: new Date().toISOString() }
          : u
      ))
    } else {
      const newUser: User = {
        id: `user-${Date.now()}`,
        ...userData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setUsers(prev => [...prev, newUser])
    }
    setIsDialogOpen(false)
  }

  const handleDeleteUser = (userId: string) => {
    if (confirm(t("settings.users.deleteConfirm"))) {
      setUsers(prev => prev.filter(u => u.id !== userId))
    }
  }

  const handleToggleStatus = (userId: string) => {
    setUsers(prev => prev.map(u => 
      u.id === userId 
        ? { ...u, status: u.status === "active" ? "inactive" : "active" }
        : u
    ))
  }

  const getRoleName = (roleId: string): string => {
    return roles.find(r => r.id === roleId)?.name || roleId
  }

  const getRoleColor = (roleId: string): string => {
    const role = roles.find(r => r.id === roleId)
    return rolePillClassForColor(role?.color)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("settings.users.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {canCreate && (
          <Button onClick={handleCreateUser} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("settings.users.addUser")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.users.usersCount", { count: filteredUsers.length })}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filteredUsers.map((user) => (
              <div 
                key={user.id}
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                    {user.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{user.name}</span>
                      <Badge variant="outline" className={userStatusPillClass[user.status]}>
                        {user.status}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Mail className="h-3 w-3" />
                      {user.email}
                      {user.department && (
                        <>
                          <span className="text-border">•</span>
                          {user.department}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {user.roles.map(roleId => (
                      <Badge 
                        key={roleId} 
                        variant="outline"
                        className={getRoleColor(roleId)}
                      >
                        {getRoleName(roleId)}
                      </Badge>
                    ))}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && (
                        <DropdownMenuItem onClick={() => handleEditUser(user)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          {t("settings.users.actions.edit")}
                        </DropdownMenuItem>
                      )}
                      {canEdit && (
                        <DropdownMenuItem onClick={() => handleToggleStatus(user.id)}>
                          {user.status === "active" ? (
                            <>
                              <UserX className="h-4 w-4 mr-2" />
                              {t("settings.users.actions.deactivate")}
                            </>
                          ) : (
                            <>
                              <UserCheck className="h-4 w-4 mr-2" />
                              {t("settings.users.actions.activate")}
                            </>
                          )}
                        </DropdownMenuItem>
                      )}
                      {canDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => handleDeleteUser(user.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t("settings.users.actions.delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingUser ? t("settings.users.editUser") : t("settings.users.createUser")}
            </DialogTitle>
            <DialogDescription>
              {editingUser
                ? t("settings.users.editDescription")
                : t("settings.users.createDescription")
              }
            </DialogDescription>
          </DialogHeader>
          <form action={handleSaveUser} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{t("settings.users.fullName")}</Label>
                <Input 
                  id="name" 
                  name="name"
                  defaultValue={editingUser?.name}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("settings.users.email")}</Label>
                <Input 
                  id="email" 
                  name="email"
                  type="email"
                  defaultValue={editingUser?.email}
                  required
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="department">{t("settings.users.department")}</Label>
                <Input 
                  id="department" 
                  name="department"
                  defaultValue={editingUser?.department}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">{t("settings.users.status")}</Label>
                <Select name="status" defaultValue={editingUser?.status || "pending"}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("settings.users.statuses.active")}</SelectItem>
                    <SelectItem value="inactive">{t("settings.users.statuses.inactive")}</SelectItem>
                    <SelectItem value="pending">{t("settings.users.statuses.pending")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.users.roles")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((role) => (
                  <div key={role.id} className="flex items-center gap-2">
                    <Checkbox
                      id={role.id}
                      checked={selectedRoles.includes(role.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedRoles(prev => [...prev, role.id])
                        } else {
                          setSelectedRoles(prev => prev.filter(r => r !== role.id))
                        }
                      }}
                    />
                    <Label htmlFor={role.id} className="text-sm font-normal">
                      {role.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit">
                {editingUser ? t("settings.users.saveChanges") : t("settings.users.createUser")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
