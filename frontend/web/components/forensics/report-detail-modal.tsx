"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Clock,
  Search,
  Calendar,
  User,
  Users,
  Tag,
  FileText,
  ListChecks,
  Lightbulb,
  DollarSign,
  Building2,
  Shield,
  TrendingUp,
  ExternalLink,
  Download,
  Printer,
  X,
  ChevronRight,
  Circle,
} from "lucide-react"
import type { ForensicReport, TimelineEvent, CorrectiveAction, RootCause } from "@/lib/forensic-report-types"
import { severityConfig, statusConfig, incidentCategories } from "@/lib/forensic-report-types"

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

  const getActionStatusColor = (status: CorrectiveAction["status"]) => {
    switch (status) {
      case "completed": return "text-green-600 bg-green-500/10"
      case "in-progress": return "text-blue-600 bg-blue-500/10"
      case "overdue": return "text-red-600 bg-red-500/10"
      default: return "text-muted-foreground bg-muted"
    }
  }

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
                    severity.color === "red" && "border-red-500/50 bg-red-500/10 text-red-600",
                    severity.color === "orange" && "border-orange-500/50 bg-orange-500/10 text-orange-600",
                    severity.color === "yellow" && "border-yellow-500/50 bg-yellow-500/10 text-yellow-600",
                    severity.color === "green" && "border-green-500/50 bg-green-500/10 text-green-600"
                  )}
                >
                  {severityIcons[report.severity]}
                  {severity.label}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1",
                    status.color === "red" && "border-red-500/50 bg-red-500/10 text-red-600",
                    status.color === "yellow" && "border-yellow-500/50 bg-yellow-500/10 text-yellow-600",
                    status.color === "blue" && "border-blue-500/50 bg-blue-500/10 text-blue-600",
                    status.color === "green" && "border-green-500/50 bg-green-500/10 text-green-600"
                  )}
                >
                  {status.label}
                </Badge>
              </div>
              <DialogTitle className="text-xl font-semibold">{report.title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{report.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" title="Print Report">
                <Printer className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" title="Download PDF">
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Incident Date</p>
                <p className="text-sm font-medium">{formatShortDate(report.incidentDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Assigned To</p>
                <p className="text-sm font-medium">{report.assignedTo}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="text-sm font-medium">{report.department}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Category</p>
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
                Overview
              </TabsTrigger>
              <TabsTrigger value="timeline" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                Timeline
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                Root Cause
              </TabsTrigger>
              <TabsTrigger value="actions" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                Actions
              </TabsTrigger>
              <TabsTrigger value="impact" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3">
                Impact
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="h-[400px]">
            <div className="p-6">
              {/* Overview Tab */}
              <TabsContent value="overview" className="mt-0 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold mb-2">Description</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{report.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Team Members</h4>
                    <div className="space-y-2">
                      {report.teamMembers.map((member, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-xs bg-muted">{getInitials(member)}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{member}</span>
                          {member === report.assignedTo && (
                            <Badge variant="secondary" className="text-xs">Lead</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-3">Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {report.tags.map((tag, idx) => (
                        <Badge key={idx} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {report.immediateActions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Immediate Actions Taken</h4>
                    <ul className="space-y-1.5">
                      {report.immediateActions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
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
                    {report.timeline.map((event, idx) => (
                      <div key={event.id} className="relative pl-10">
                        <div className={cn(
                          "absolute left-2 w-5 h-5 rounded-full flex items-center justify-center -translate-x-1/2",
                          event.type === "resolution" ? "bg-green-500/20 text-green-600" :
                          event.type === "discovery" ? "bg-red-500/20 text-red-600" :
                          event.type === "escalation" ? "bg-orange-500/20 text-orange-600" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {timelineTypeIcons[event.type]}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">{formatDate(event.timestamp)}</span>
                            {event.actor && (
                              <span className="text-xs font-medium">by {event.actor}</span>
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
                  <h4 className="text-sm font-semibold mb-3">Root Causes Identified</h4>
                  <div className="space-y-3">
                    {report.rootCauses.map((cause) => (
                      <Card key={cause.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                              cause.contributing ? "bg-red-500/10 text-red-600" : "bg-muted text-muted-foreground"
                            )}>
                              {rootCauseCategoryIcons[cause.category]}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="capitalize">{cause.category}</Badge>
                                {cause.contributing && (
                                  <Badge variant="destructive" className="text-xs">Primary</Badge>
                                )}
                              </div>
                              <p className="text-sm">{cause.description}</p>
                              {cause.evidence && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  Evidence: {cause.evidence}
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
                      <Lightbulb className="h-4 w-4 text-yellow-500" />
                      Lessons Learned
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
                    <h4 className="text-sm font-semibold">Corrective Actions Progress</h4>
                    <span className="text-sm text-muted-foreground">
                      {completedActions} of {report.correctiveActions.length} completed
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
                                  Due: {formatShortDate(action.dueDate)}
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
                    <h4 className="text-sm font-semibold mb-3">Preventive Actions</h4>
                    <ul className="space-y-2">
                      {report.preventiveActions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Shield className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
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
                          <DollarSign className="h-4 w-4 text-green-500" />
                          Financial Impact
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Estimated</span>
                            <span className="text-sm font-medium">
                              {report.impact.financial.currency} {report.impact.financial.estimated.toLocaleString()}
                            </span>
                          </div>
                          {report.impact.financial.actual !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Actual</span>
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
                          <Building2 className="h-4 w-4 text-blue-500" />
                          Operational Impact
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {report.impact.operational.downtime && (
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Downtime</span>
                              <span className="text-sm font-medium">{report.impact.operational.downtime}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Users Affected</span>
                            <span className="text-sm font-medium">{report.impact.operational.affectedUsers}</span>
                          </div>
                          <div>
                            <span className="text-sm text-muted-foreground">Processes:</span>
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
                          <Users className="h-4 w-4 text-orange-500" />
                          Reputational Impact
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Customer Affected</span>
                            <span className="text-sm font-medium">{report.impact.reputational.customerAffected ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Public Exposure</span>
                            <span className="text-sm font-medium">{report.impact.reputational.publicExposure ? "Yes" : "No"}</span>
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
                          <Shield className="h-4 w-4 text-purple-500" />
                          Compliance Impact
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Regulatory Impact</span>
                            <span className="text-sm font-medium">{report.impact.compliance.regulatoryImpact ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Reporting Required</span>
                            <span className="text-sm font-medium">{report.impact.compliance.reportingRequired ? "Yes" : "No"}</span>
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
            Last updated: {formatDate(report.updatedAt)}
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
                Move to {report.status === "open" ? "Investigating" : report.status === "investigating" ? "Resolved" : "Closed"}
              </Button>
            )}
            <Button variant="default" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
