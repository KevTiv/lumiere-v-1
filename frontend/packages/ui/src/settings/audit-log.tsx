"use client"

import { useState } from "react"
import { useRBAC } from "@/lib/rbac-context"
import { useErpSession } from "@lumiere/erp-session"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import {
  useCreateUserSession,
  useLogAuditEvent,
} from "@lumiere/query-hooks/hooks/auth"
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
import { useTranslation } from "@lumiere/i18n"
import type { AuditLogEntry } from "@/lib/rbac-types"
import { cn } from "@/lib/utils"
import { auditActionPillClass } from "@/lib/theme-colors"
import { FormModal } from "../forms/form-modal"
import { createUserSessionForm, logAuditEventForm } from "../lib/settings-platform-form-configs"

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

function actionPillClass(action: string): string {
  return auditActionPillClass[action] ?? "bg-muted text-muted-foreground"
}

export function AuditLog() {
  const { t } = useTranslation()
  const { organizationId } = useErpSession()
  const orgReady = hasValidOrganizationId(organizationId)
  const orgBigInt = orgReady ? BigInt(organizationId) : 0n
  const logAuditEvent = useLogAuditEvent(orgBigInt)
  const createUserSession = useCreateUserSession(orgBigInt)
  const { checkPermission } = useRBAC()
  const canManageAudit = checkPermission("admin:audit-log", "manage").allowed

  const [logs] = useState<AuditLogEntry[]>(mockAuditLogs)
  const [searchQuery, setSearchQuery] = useState("")
  const [actionFilter, setActionFilter] = useState<string>("all")
  const [adminModal, setAdminModal] = useState<"log" | "session" | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)

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
              placeholder={t("settings.auditLog.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder={t("settings.auditLog.filter")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("settings.auditLog.allActions")}</SelectItem>
              <SelectItem value="user">{t("settings.auditLog.userActions")}</SelectItem>
              <SelectItem value="role">{t("settings.auditLog.roleChanges")}</SelectItem>
              <SelectItem value="order">{t("settings.auditLog.orders")}</SelectItem>
              <SelectItem value="product">{t("settings.auditLog.products")}</SelectItem>
              <SelectItem value="permission">{t("settings.auditLog.accessEvents")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageAudit && orgReady ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdminError(null)
                  setAdminModal("log")
                }}
              >
                {t("settings.adminOps.audit.logEventButton")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdminError(null)
                  setAdminModal("session")
                }}
              >
                {t("settings.adminOps.sessions.createButton")}
              </Button>
            </>
          ) : null}
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            {t("settings.auditLog.exportCsv")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            {t("settings.auditLog.activityLog", { count: filteredLogs.length })}
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
                  <div className={cn("p-2 rounded-lg", actionPillClass(log.action))}>
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

      {adminModal ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setAdminModal(null)
              setAdminError(null)
            }
          }}
          config={adminModal === "log" ? logAuditEventForm(t) : createUserSessionForm(t)}
          isPending={logAuditEvent.isPending || createUserSession.isPending}
          closeOnSubmit={false}
          submitError={adminError}
          onSubmit={async (data) => {
            setAdminError(null)
            try {
              if (adminModal === "log") {
                const changedRaw = String(data.changedFields ?? "")
                const companyRaw = data.companyId
                const companyId =
                  companyRaw != null && String(companyRaw).trim() !== ""
                    ? (typeof companyRaw === "object" ? null : companyRaw)
                    : null
                await logAuditEvent.mutateAsync({
                  companyId: companyId as string | number | bigint | null,
                  tableName: String(data.tableName ?? ""),
                  recordId: data.recordId as string | number,
                  action: String(data.action ?? ""),
                  oldValues: data.oldValues ? String(data.oldValues) : null,
                  newValues: data.newValues ? String(data.newValues) : null,
                  changedFields: changedRaw
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  sessionId: null,
                  ipAddress: null,
                  userAgent: null,
                  metadata: null,
                })
              } else {
                const expiresRaw = String(data.expiresAt ?? "").trim()
                const millis = Date.parse(expiresRaw)
                if (!Number.isFinite(millis)) throw new Error("expiresAt must be a valid date/time")
                await createUserSession.mutateAsync({
                  sessionToken: String(data.sessionToken ?? ""),
                  ipAddress: data.ipAddress ? String(data.ipAddress) : null,
                  userAgent: data.userAgent ? String(data.userAgent) : null,
                  deviceInfo: null,
                  expiresAtMicros: BigInt(millis) * 1000n,
                  metadata: null,
                })
              }
              setAdminModal(null)
            } catch (error) {
              setAdminError(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
    </div>
  )
}
