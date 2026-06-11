"use client"

import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Search,
  Calendar,
  User,
  Tag,
  Paperclip,
} from "lucide-react"
import type { ForensicReport } from "@/lib/forensic-report-types"
import { severityConfig, statusConfig, incidentCategories } from "@/lib/forensic-report-types"
import {
  severityBadgeClass,
  severitySolidBarClass,
  statusBadgeClass,
} from "@/lib/theme-colors"

interface ReportCardProps {
  report: ForensicReport
  onClick?: () => void
  compact?: boolean
}

const severityIcons: Record<string, React.ReactNode> = {
  critical: <AlertTriangle className="h-4 w-4" />,
  high: <AlertCircle className="h-4 w-4" />,
  medium: <Info className="h-4 w-4" />,
  low: <CheckCircle2 className="h-4 w-4" />,
}

const statusIcons: Record<string, React.ReactNode> = {
  open: <AlertCircle className="h-3.5 w-3.5" />,
  investigating: <Search className="h-3.5 w-3.5" />,
  resolved: <CheckCircle2 className="h-3.5 w-3.5" />,
  closed: <CheckCircle2 className="h-3.5 w-3.5" />,
}

export function ReportCard({ report, onClick, compact = false }: ReportCardProps) {
  const { t } = useTranslation()
  const severity = severityConfig[report.severity]
  const status = statusConfig[report.status]
  const category = incidentCategories[report.category]

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase()
  }

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={cn(
          "flex items-center gap-4 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
        )}
      >
        <div
          className={cn(
            "w-2 h-10 rounded-full shrink-0",
            severity.color in severitySolidBarClass
              ? severitySolidBarClass[severity.color as keyof typeof severitySolidBarClass]
              : "bg-muted",
          )}
        />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{report.reportNumber}</span>
            <Badge variant="outline" className="text-xs">
              {status.label}
            </Badge>
          </div>
          <p className="text-sm font-medium truncate mt-0.5">{report.title}</p>
        </div>
        
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(report.incidentDate)}
        </div>
      </div>
    )
  }

  return (
    <Card
      onClick={onClick}
      className={cn(
        "cursor-pointer hover:shadow-md transition-all duration-200 hover:border-primary/30",
        "group"
      )}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                severity.color in severityBadgeClass
                  ? severityBadgeClass[severity.color as keyof typeof severityBadgeClass]
                  : undefined,
              )}
            >
              {severityIcons[report.severity]}
              {severity.label}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                status.color in statusBadgeClass
                  ? statusBadgeClass[status.color as keyof typeof statusBadgeClass]
                  : undefined,
              )}
            >
              {statusIcons[report.status]}
              {status.label}
            </Badge>
          </div>
          <span className="text-xs font-mono text-muted-foreground">{report.reportNumber}</span>
        </div>

        {/* Title & Summary */}
        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
          {report.title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {report.summary}
        </p>

        {/* Category Badge */}
        <div className="mt-3">
          <Badge variant="secondary" className="text-xs">
            {category.label}
          </Badge>
        </div>

        {/* Meta Info */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(report.incidentDate)}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5" />
            {report.assignedTo}
          </div>
          {report.tags.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="h-3.5 w-3.5" />
              {report.tags.length}
            </div>
          )}
          {report.attachments.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              {report.attachments.length}
            </div>
          )}
        </div>

        {/* Team Avatars */}
        {report.teamMembers.length > 0 && (
          <div className="flex items-center justify-between mt-3">
            <div className="flex -space-x-2">
              {report.teamMembers.slice(0, 4).map((member, idx) => (
                <Avatar key={idx} className="h-7 w-7 border-2 border-background">
                  <AvatarFallback className="text-xs bg-muted">
                    {getInitials(member)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {report.teamMembers.length > 4 && (
                <div className="h-7 w-7 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">+{report.teamMembers.length - 4}</span>
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.correctiveActions.length !== 1
                ? t("forensics.reportCard.actionsCountPlural", { count: report.correctiveActions.length })
                : t("forensics.reportCard.actionsCount", { count: report.correctiveActions.length })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
