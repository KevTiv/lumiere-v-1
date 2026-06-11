"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Search,
  Calendar,
  User,
  Users,
  Tag,
  ListChecks,
  Lightbulb,
  DollarSign,
  Building2,
  Shield,
  TrendingUp,
  ExternalLink,
  Download,
  Printer,
  ChevronRight,
  Circle,
} from "lucide-react"
import type { ForensicReport, TimelineEvent, CorrectiveAction, RootCause } from "@/lib/forensic-report-types"
import { severityConfig, statusConfig, incidentCategories } from "@/lib/forensic-report-types"
import {
  correctiveActionStatusPillClass,
  severityBadgeClass,
  statusBadgeClass,
} from "@/lib/theme-colors"

interface ReportDetailModalProps {
  report: ForensicReport | null
  open: boolean
  onClose: () => void
  onUpdateStatus?: (reportId: string, status: ForensicReport["status"]) => void
}

const severityIcons: Record<string, React.ReactNode> = {
  critical: <AlertTriangle className="h-4 w-4" />,
  high: <AlertCircle className="h-4 w-4" />,
  medium: <Info className="h-4 w-4" />,
  low: <CheckCircle2 className="h-4 w-4" />,
}

const timelineTypeIcons: Record<TimelineEvent["type"], React.ReactNode> = {
  action: <ChevronRight className="h-4 w-4" />,
  observation: <Search className="h-4 w-4" />,
  discovery: <AlertCircle className="h-4 w-4" />,
  resolution: <CheckCircle2 className="h-4 w-4" />,
  escalation: <TrendingUp className="h-4 w-4" />,
}

const rootCauseCategoryIcons: Record<RootCause["category"], React.ReactNode> = {
  human: <User className="h-4 w-4" />,
  process: <ListChecks className="h-4 w-4" />,
  system: <Building2 className="h-4 w-4" />,
  external: <ExternalLink className="h-4 w-4" />,
  unknown: <Info className="h-4 w-4" />,
}

export function ReportDetailModal({ report, open, onClose, onUpdateStatus }: ReportDetailModalProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState("overview")

  if (!report) return null

  const severity = severityConfig[report.severity]
  const status = statusConfig[report.status]
  const category = incidentCategories[report.category]

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatShortDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  }

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase()
  }

  const completedActions = report.correctiveActions.filter(a => a.status === "completed").length
  const actionProgress = (completedActions / report.correctiveActions.length) * 100

  const getActionStatusColor = (actionStatus: CorrectiveAction["status"]) =>
    correctiveActionStatusPillClass[actionStatus] ?? "text-muted-foreground bg-muted"

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-mono text-muted-foreground">{report.reportNumber}</span>
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
                  {status.label}
                </Badge>
              </div>
              <DialogTitle className="text-xl font-semibold">{report.title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{report.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" title={t("forensics.detailModal.printReport")}>
                <Printer className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" title={t("forensics.detailModal.downloadPdf")}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{t("forensics.detailModal.incidentDate")}</p>
                <p className="text-sm font-medium">{formatShortDate(report.incidentDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{t("forensics.detailModal.assignedTo")}</p>
                <p className="text-sm font-medium">{report.assignedTo}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{t("forensics.detailModal.department")}</p>
                <p className="text-sm font-medium">{report.department}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{t("forensics.detailModal.category")}</p>
                <p className="text-sm font-medium">{category.label}</p>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <div className="border-b border-border px-6">
            <TabsList className="h-12 bg-transparent p-0 w-full justify-start gap-6">
              <TabsTrigger value="overview" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                {t("forensics.detailModal.tabOverview")}
              </TabsTrigger>
              <TabsTrigger value="timeline" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                {t("forensics.detailModal.tabTimeline")}
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                {t("forensics.detailModal.tabRootCause")}
              </TabsTrigger>
              <TabsTrigger value="actions" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                {t("forensics.detailModal.tabActions")}
              </TabsTrigger>
              <TabsTrigger value="impact" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                {t("forensics.detailModal.tabImpact")}
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="h-[400px]">
            <div className="p-6">
              {/* Overview Tab */}
              <TabsContent value="overview" className="mt-0 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold mb-2">{t("forensics.detailModal.description")}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{report.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-semibold mb-3">{t("forensics.detailModal.teamMembers")}</h4>
                    <div className="space-y-2">
                      {report.teamMembers.map((member, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-xs bg-muted">{getInitials(member)}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{member}</span>
                          {member === report.assignedTo && (
                            <Badge variant="secondary" className="text-xs">{t("forensics.detailModal.lead")}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-3">{t("forensics.detailModal.tags")}</h4>
                    <div className="flex flex-wrap gap-2">
                      {report.tags.map((tag, idx) => (
                        <Badge key={idx} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {report.immediateActions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">{t("forensics.detailModal.immediateActions")}</h4>
                    <ul className="space-y-1.5">
                      {report.immediateActions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              {/* Timeline Tab */}
              <TabsContent value="timeline" className="mt-0">
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                  <div className="space-y-6">
                    {report.timeline.map((event) => (
                      <div key={event.id} className="relative pl-10">
                        <div className={cn(
                          "absolute left-2 w-5 h-5 rounded-full flex items-center justify-center -translate-x-1/2",
                          event.type === "resolution" ? "bg-success/20 text-success" :
                          event.type === "discovery" ? "bg-destructive/20 text-destructive" :
                          event.type === "escalation" ? "bg-warning/20 text-warning" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {timelineTypeIcons[event.type]}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">{formatDate(event.timestamp)}</span>
                            {event.actor && (
                              <span className="text-xs font-medium">{t("forensics.detailModal.byActor", { actor: event.actor })}</span>
                            )}
                          </div>
                          <p className="text-sm">{event.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              {/* Root Cause Tab */}
              <TabsContent value="analysis" className="mt-0 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold mb-3">{t("forensics.detailModal.rootCausesIdentified")}</h4>
                  <div className="space-y-3">
                    {report.rootCauses.map((cause) => (
                      <Card key={cause.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                              cause.contributing ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                            )}>
                              {rootCauseCategoryIcons[cause.category]}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="capitalize">{cause.category}</Badge>
                                {cause.contributing && (
                                  <Badge variant="destructive" className="text-xs">{t("forensics.detailModal.primary")}</Badge>
                                )}
                              </div>
                              <p className="text-sm">{cause.description}</p>
                              {cause.evidence && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  {t("forensics.detailModal.evidence", { evidence: cause.evidence })}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {report.lessonsLearned.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-warning" />
                      {t("forensics.detailModal.lessonsLearned")}
                    </h4>
                    <ul className="space-y-2">
                      {report.lessonsLearned.map((lesson, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Circle className="h-1.5 w-1.5 mt-2 shrink-0 fill-current" />
                          {lesson}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              {/* Actions Tab */}
              <TabsContent value="actions" className="mt-0 space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">{t("forensics.detailModal.correctiveActionsProgress")}</h4>
                    <span className="text-sm text-muted-foreground">
                      {t("forensics.detailModal.actionsCompleted", { completed: completedActions, total: report.correctiveActions.length })}
                    </span>
                  </div>
                  <Progress value={actionProgress} className="h-2 mb-4" />
                  
                  <div className="space-y-3">
                    {report.correctiveActions.map((action) => (
                      <Card key={action.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="text-sm font-medium">{action.description}</p>
                              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {action.assignee}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {t("forensics.detailModal.due", { date: formatShortDate(action.dueDate) })}
                                </span>
                              </div>
                            </div>
                            <Badge className={cn("capitalize", getActionStatusColor(action.status))}>
                              {action.status}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {report.preventiveActions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3">{t("forensics.detailModal.preventiveActions")}</h4>
                    <ul className="space-y-2">
                      {report.preventiveActions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Shield className="h-4 w-4 text-info mt-0.5 shrink-0" />
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              {/* Impact Tab */}
              <TabsContent value="impact" className="mt-0">
                <div className="grid grid-cols-2 gap-4">
                  {report.impact.financial && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-success" />
                          {t("forensics.detailModal.financialImpact")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">{t("forensics.detailModal.estimated")}</span>
                            <span className="text-sm font-medium">
                              {report.impact.financial.currency} {report.impact.financial.estimated.toLocaleString()}
                            </span>
                          </div>
                          {report.impact.financial.actual !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">{t("forensics.detailModal.actual")}</span>
                              <span className="text-sm font-medium">
                                {report.impact.financial.currency} {report.impact.financial.actual.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {report.impact.operational && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-info" />
                          {t("forensics.detailModal.operationalImpact")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {report.impact.operational.downtime && (
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">{t("forensics.detailModal.downtime")}</span>
                              <span className="text-sm font-medium">{report.impact.operational.downtime}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">{t("forensics.detailModal.usersAffected")}</span>
                            <span className="text-sm font-medium">{report.impact.operational.affectedUsers}</span>
                          </div>
                          <div>
                            <span className="text-sm text-muted-foreground">{t("forensics.detailModal.processes")}</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {report.impact.operational.affectedProcesses.map((proc, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">{proc}</Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {report.impact.reputational && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Users className="h-4 w-4 text-warning" />
                          {t("forensics.detailModal.reputationalImpact")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">{t("forensics.detailModal.customerAffected")}</span>
                            <span className="text-sm font-medium">{report.impact.reputational.customerAffected ? t("forensics.detailModal.yes") : t("forensics.detailModal.no")}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">{t("forensics.detailModal.publicExposure")}</span>
                            <span className="text-sm font-medium">{report.impact.reputational.publicExposure ? t("forensics.detailModal.yes") : t("forensics.detailModal.no")}</span>
                          </div>
                          {report.impact.reputational.description && (
                            <p className="text-sm text-muted-foreground">{report.impact.reputational.description}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {report.impact.compliance && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Shield className="h-4 w-4 text-category-3" />
                          {t("forensics.detailModal.complianceImpact")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">{t("forensics.detailModal.regulatoryImpact")}</span>
                            <span className="text-sm font-medium">{report.impact.compliance.regulatoryImpact ? t("forensics.detailModal.yes") : t("forensics.detailModal.no")}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">{t("forensics.detailModal.reportingRequired")}</span>
                            <span className="text-sm font-medium">{report.impact.compliance.reportingRequired ? t("forensics.detailModal.yes") : t("forensics.detailModal.no")}</span>
                          </div>
                          {report.impact.compliance.regulations && report.impact.compliance.regulations.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {report.impact.compliance.regulations.map((reg, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">{reg}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>

        {/* Footer */}
        <div className="border-t border-border p-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t("forensics.detailModal.lastUpdated", { date: formatDate(report.updatedAt) })}
          </div>
          <div className="flex items-center gap-2">
            {onUpdateStatus && report.status !== "closed" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const nextStatus = report.status === "open" ? "investigating" :
                    report.status === "investigating" ? "resolved" : "closed"
                  onUpdateStatus(report.id, nextStatus)
                }}
              >
                {t("forensics.detailModal.moveTo", { status: report.status === "open" ? t("forensics.view.filterStatusInvestigating") : report.status === "investigating" ? t("forensics.view.filterStatusResolved") : t("forensics.view.filterStatusClosed") })}
              </Button>
            )}
            <Button variant="default" size="sm" onClick={onClose}>
              {t("forensics.detailModal.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
