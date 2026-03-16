"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { 
  Search, 
  Filter,
  Download,
  User,
  Shield,
  Settings,
  FileText,
  AlertTriangle,
  CheckCircle
} from "lucide-react"
import type { AuditLogEntry } from "@/lib/rbac-types"

// Mock audit log data
const mockAuditLogs: AuditLogEntry[] = [
  {
    id: "log-1",
    userId: "user-1",
    userName: "John Doe",
    action: "user.login",
    resource: "auth",
    details: "Successful login from 192.168.1.100",
    timestamp: "2024-03-13T10:30:00Z",
    ip: "192.168.1.100"
  },
  {
    id: "log-2",
    userId: "user-1",
    userName: "John Doe",
    action: "role.update",
    resource: "admin:roles",
    details: "Updated permissions for Sales Representative role",
    timestamp: "2024-03-13T10:25:00Z",
    ip: "192.168.1.100"
  },
  {
    id: "log-3",
    userId: "user-2",
    userName: "Jane Smith",
    action: "order.create",
    resource: "entries:orders",
    details: "Created order #ORD-2024-1847",
    timestamp: "2024-03-13T09:45:00Z",
    ip: "192.168.1.105"
  },
  {
    id: "log-4",
    userId: "user-3",
    userName: "Mike Johnson",
    action: "customer.update",
    resource: "entries:customers",
    details: "Updated customer: Acme Corp",
    timestamp: "2024-03-13T09:30:00Z",
    ip: "192.168.1.110"
  },
  {
    id: "log-5",
    userId: "user-1",
    userName: "John Doe",
    action: "user.create",
    resource: "admin:users",
    details: "Created new user: sarah.wilson@company.com",
    timestamp: "2024-03-12T16:20:00Z",
    ip: "192.168.1.100"
  },
  {
    id: "log-6",
    userId: "user-4",
    userName: "Sarah Wilson",
    action: "product.update",
    resource: "entries:products",
    details: "Updated stock for SKU: PROD-001",
    timestamp: "2024-03-12T14:15:00Z",
    ip: "192.168.1.115"
  },
  {
    id: "log-7",
    userId: "user-2",
    userName: "Jane Smith",
    action: "report.generate",
    resource: "forms:generate-report",
    details: "Generated monthly sales report",
    timestamp: "2024-03-12T11:00:00Z",
    ip: "192.168.1.105"
  },
  {
    id: "log-8",
    userId: "user-1",
    userName: "John Doe",
    action: "permission.deny",
    resource: "admin:permissions",
    details: "Access denied: User viewer@company.com attempted to access admin:users",
    timestamp: "2024-03-12T10:30:00Z",
    ip: "192.168.1.120"
  },
]

const actionIcons: Record<string, React.ReactNode> = {
  "user.login": <User className="h-4 w-4" />,
  "user.create": <User className="h-4 w-4" />,
  "role.update": <Shield className="h-4 w-4" />,
  "order.create": <FileText className="h-4 w-4" />,
  "customer.update": <User className="h-4 w-4" />,
  "product.update": <Settings className="h-4 w-4" />,
  "report.generate": <FileText className="h-4 w-4" />,
  "permission.deny": <AlertTriangle className="h-4 w-4" />,
}

const actionColors: Record<string, string> = {
  "user.login": "bg-green-500/10 text-green-400",
  "user.create": "bg-blue-500/10 text-blue-400",
  "role.update": "bg-purple-500/10 text-purple-400",
  "order.create": "bg-teal-500/10 text-teal-400",
  "customer.update": "bg-blue-500/10 text-blue-400",
  "product.update": "bg-orange-500/10 text-orange-400",
  "report.generate": "bg-teal-500/10 text-teal-400",
  "permission.deny": "bg-red-500/10 text-red-400",
}

export function AuditLog() {
  const [logs] = useState<AuditLogEntry[]>(mockAuditLogs)
  const [searchQuery, setSearchQuery] = useState("")
  const [actionFilter, setActionFilter] = useState<string>("all")

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesAction = actionFilter === "all" || log.action.startsWith(actionFilter)
    
    return matchesSearch && matchesAction
  })

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  }

  const handleExport = () => {
    const csv = [
      ["Timestamp", "User", "Action", "Resource", "Details", "IP"],
      ...filteredLogs.map(log => [
        log.timestamp,
        log.userName,
        log.action,
        log.resource,
        log.details || "",
        log.ip || ""
      ])
    ].map(row => row.join(",")).join("\n")

    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="user">User Actions</SelectItem>
              <SelectItem value="role">Role Changes</SelectItem>
              <SelectItem value="order">Orders</SelectItem>
              <SelectItem value="product">Products</SelectItem>
              <SelectItem value="permission">Access Events</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={handleExport} className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            Activity Log ({filteredLogs.length} entries)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filteredLogs.map((log) => (
              <div 
                key={log.id}
                className="flex items-start justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${actionColors[log.action] || "bg-muted"}`}>
                    {actionIcons[log.action] || <Settings className="h-4 w-4" />}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{log.userName}</span>
                      <Badge variant="outline" className="text-xs">
                        {log.action}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {log.details}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{formatTimestamp(log.timestamp)}</span>
                      {log.ip && (
                        <>
                          <span className="text-border">•</span>
                          <span>IP: {log.ip}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
