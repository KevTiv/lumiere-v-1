"use client"

import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Search,
  Plus,
  Filter,
  LayoutGrid,
  List,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  TrendingDown,
  FileText,
  BarChart3,
  PieChart,
  Calendar,
  ChevronDown,
  Download,
  Printer,
} from "lucide-react"
import { ReportCard } from "./report-card"
import { ReportDetailModal } from "./report-detail-modal"
import { CreateReportModal } from "./create-report-modal"
import type { ForensicReport, IncidentSeverity, IncidentStatus, IncidentCategory, ForensicAnalytics } from "@/lib/forensic-report-types"
import { sampleForensicReports, severityConfig, statusConfig, incidentCategories } from "@/lib/forensic-report-types"

interface ForensicsViewProps {
  className?: string
}

export function ForensicsView({ className }: ForensicsViewProps) {
  const [reports, setReports] = useState<ForensicReport[]>(sampleForensicReports)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedReport, setSelectedReport] = useState<ForensicReport | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [filterSeverity, setFilterSeverity] = useState<string>("all")
  const [filterCategory, setFilterCategory] = useState<string>("all")
  const [activeTab, setActiveTab] = useState("reports")

  // Computed analytics
  const analytics: ForensicAnalytics = useMemo(() => {
    const bySeverity = reports.reduce((acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1
      return acc
    }, {} as Record<IncidentSeverity, number>)

    const byCategory = reports.reduce((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + 1
      return acc
    }, {} as Record<IncidentCategory, number>)

    const byStatus = reports.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    }, {} as Record<IncidentStatus, number>)

    const byDepartment = reports.reduce((acc, r) => {
      acc[r.department] = (acc[r.department] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    // Calculate average resolution time for resolved/closed reports
    const resolvedReports = reports.filter(r => r.resolvedDate)
    const avgResolutionTime = resolvedReports.length > 0
      ? resolvedReports.reduce((acc, r) => {
          const start = new Date(r.incidentDate).getTime()
          const end = new Date(r.resolvedDate!).getTime()
          return acc + (end - start) / (1000 * 60 * 60)
        }, 0) / resolvedReports.length
      : 0

    // Root cause frequency
    const rootCauseMap = new Map<string, number>()
    reports.forEach(r => {
      r.rootCauses.forEach(rc => {
        const key = rc.category
        rootCauseMap.set(key, (rootCauseMap.get(key) || 0) + 1)
      })
    })
    const topRootCauses = Array.from(rootCauseMap.entries())
      .map(([cause, count]) => ({ cause, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    return {
      totalReports: reports.length,
      openReports: reports.filter(r => r.status === "open" || r.status === "investigating").length,
      avgResolutionTime: Math.round(avgResolutionTime),
      bySeverity,
      byCategory,
      byStatus,
      byDepartment,
      trendsLastMonth: [],
      topRootCauses,
    }
  }, [reports])

  // Filtered reports
  const filteredReports = useMemo(() => {
    return reports.filter(report => {
      const matchesSearch = searchQuery === "" ||
        report.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.reportNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesStatus = filterStatus === "all" || report.status === filterStatus
      const matchesSeverity = filterSeverity === "all" || report.severity === filterSeverity
      const matchesCategory = filterCategory === "all" || report.category === filterCategory

      return matchesSearch && matchesStatus && matchesSeverity && matchesCategory
    })
  }, [reports, searchQuery, filterStatus, filterSeverity, filterCategory])

  const handleOpenReport = (report: ForensicReport) => {
    setSelectedReport(report)
    setIsDetailOpen(true)
  }

  const handleUpdateStatus = (reportId: string, status: ForensicReport["status"]) => {
    setReports(prev => prev.map(r => 
      r.id === reportId 
        ? { ...r, status, updatedAt: new Date().toISOString() }
        : r
    ))
    if (selectedReport?.id === reportId) {
      setSelectedReport(prev => prev ? { ...prev, status } : null)
    }
  }

  const handleCreateReport = (data: Partial<ForensicReport>) => {
    const newReport: ForensicReport = {
      id: `FR-${String(reports.length + 1).padStart(3, "0")}`,
      reportNumber: `INC-2024-${String(reports.length + 43).padStart(4, "0")}`,
      title: data.title || "New Incident Report",
      summary: data.summary || "",
      category: data.category || "other",
      severity: data.severity || "medium",
      status: "open",
      incidentDate: data.incidentDate || new Date().toISOString(),
      reportedDate: new Date().toISOString(),
      reportedBy: data.reportedBy || "Current User",
      assignedTo: data.assignedTo || "Unassigned",
      teamMembers: data.teamMembers || [],
      description: data.description || "",
      timeline: [],
      rootCauses: [],
      impact: {},
      immediateActions: data.immediateActions || [],
      correctiveActions: [],
      preventiveActions: [],
      lessonsLearned: [],
      attachments: [],
      tags: data.tags || [],
      department: data.department || "Operations",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setReports(prev => [newReport, ...prev])
    setIsCreateOpen(false)
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Forensic Reports</h2>
          <p className="text-sm text-muted-foreground">
            Incident analysis and process improvement tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Export as PDF</DropdownMenuItem>
              <DropdownMenuItem>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem>Export as Excel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Report
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Reports</p>
                <p className="text-2xl font-bold">{analytics.totalReports}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Open Issues</p>
                <p className="text-2xl font-bold">{analytics.openReports}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Resolution</p>
                <p className="text-2xl font-bold">{analytics.avgResolutionTime}h</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Critical</p>
                <p className="text-2xl font-bold">{analytics.bySeverity.critical || 0}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-fit mb-4">
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="h-4 w-4" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        {/* Reports Tab */}
        <TabsContent value="reports" className="flex-1 flex flex-col mt-0">
          {/* Toolbar */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search reports..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(incidentCategories).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center border border-border rounded-lg p-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Reports Grid/List */}
          <div className="flex-1 overflow-auto">
            {filteredReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <FileText className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-lg font-medium">No reports found</p>
                <p className="text-sm">Try adjusting your filters or create a new report</p>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-3 gap-4">
                {filteredReports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    onClick={() => handleOpenReport(report)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredReports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    onClick={() => handleOpenReport(report)}
                    compact
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="flex-1 mt-0">
          <div className="grid grid-cols-2 gap-6">
            {/* By Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reports by Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(["open", "investigating", "resolved", "closed"] as IncidentStatus[]).map((status) => {
                    const count = analytics.byStatus[status] || 0
                    const percentage = analytics.totalReports > 0 ? (count / analytics.totalReports) * 100 : 0
                    const config = statusConfig[status]
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <div className="w-24 text-sm capitalize">{config.label}</div>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              config.color === "red" && "bg-red-500",
                              config.color === "yellow" && "bg-yellow-500",
                              config.color === "blue" && "bg-blue-500",
                              config.color === "green" && "bg-green-500"
                            )}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="w-8 text-sm text-muted-foreground text-right">{count}</div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* By Severity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reports by Severity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(["critical", "high", "medium", "low"] as IncidentSeverity[]).map((severity) => {
                    const count = analytics.bySeverity[severity] || 0
                    const percentage = analytics.totalReports > 0 ? (count / analytics.totalReports) * 100 : 0
                    const config = severityConfig[severity]
                    return (
                      <div key={severity} className="flex items-center gap-3">
                        <div className="w-24 text-sm capitalize">{config.label}</div>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              config.color === "red" && "bg-red-500",
                              config.color === "orange" && "bg-orange-500",
                              config.color === "yellow" && "bg-yellow-500",
                              config.color === "green" && "bg-green-500"
                            )}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="w-8 text-sm text-muted-foreground text-right">{count}</div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* By Category */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reports by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(analytics.byCategory)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([category, count]) => {
                      const config = incidentCategories[category as IncidentCategory]
                      return (
                        <div key={category} className="flex items-center justify-between">
                          <span className="text-sm">{config?.label || category}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      )
                    })}
                </div>
              </CardContent>
            </Card>

            {/* Top Root Causes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Root Cause Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analytics.topRootCauses.map(({ cause, count }) => (
                    <div key={cause} className="flex items-center justify-between">
                      <span className="text-sm capitalize">{cause}</span>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))}
                  {analytics.topRootCauses.length === 0 && (
                    <p className="text-sm text-muted-foreground">No root causes identified yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* By Department */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Reports by Department</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(analytics.byDepartment).map(([dept, count]) => (
                    <div key={dept} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                      <span className="text-sm font-medium">{dept}</span>
                      <Badge>{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <ReportDetailModal
        report={selectedReport}
        open={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false)
          setSelectedReport(null)
        }}
        onUpdateStatus={handleUpdateStatus}
      />

      <CreateReportModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateReport}
      />
    </div>
  )
}
