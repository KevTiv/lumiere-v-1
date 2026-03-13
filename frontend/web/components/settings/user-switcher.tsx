"use client"

import { useRBAC } from "@/lib/rbac-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, User, Shield } from "lucide-react"

export function UserSwitcher() {
  const { currentUser, setCurrentUser, allUsers, roles } = useRBAC()

  const getRoleName = (roleId: string): string => {
    return roles.find(r => r.id === roleId)?.name || roleId
  }

  const getRoleColor = (roleId: string): string => {
    const role = roles.find(r => r.id === roleId)
    const colors: Record<string, string> = {
      red: "bg-red-500/10 text-red-400",
      purple: "bg-purple-500/10 text-purple-400",
      blue: "bg-blue-500/10 text-blue-400",
      orange: "bg-orange-500/10 text-orange-400",
      teal: "bg-teal-500/10 text-teal-400",
      green: "bg-green-500/10 text-green-400",
    }
    return colors[role?.color || "blue"] || colors.blue
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <User className="h-4 w-4" />
          <span className="max-w-[150px] truncate">{currentUser?.name || "Select User"}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Switch User (Demo)
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allUsers.map(user => (
          <DropdownMenuItem 
            key={user.id}
            onClick={() => setCurrentUser(user)}
            className="flex flex-col items-start gap-1 py-2"
          >
            <div className="flex items-center gap-2 w-full">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium">
                {user.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              {currentUser?.id === user.id && (
                <Badge variant="outline" className="text-xs">Current</Badge>
              )}
            </div>
            <div className="flex gap-1 ml-10">
              {user.roles.map(roleId => (
                <Badge 
                  key={roleId} 
                  variant="outline"
                  className={`text-xs ${getRoleColor(roleId)}`}
                >
                  {getRoleName(roleId)}
                </Badge>
              ))}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
