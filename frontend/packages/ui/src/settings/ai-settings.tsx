"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useStdbConnection } from "@lumiere/stdb"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Bot, Loader2, Plus, RefreshCw, Sparkles, Trash2, Coins } from "lucide-react"

type Row = Record<string, unknown>

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "bigint") return Number(v)
  if (typeof v === "string" && v !== "") return Number(v)
  return 0
}

function str(v: unknown): string {
  return v == null ? "" : String(v)
}

function bool(v: unknown): boolean {
  return v === true
}

function severityLabel(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>
    if (typeof o.tag === "string") return o.tag
    const keys = Object.keys(o)
    if (keys.length === 1) return keys[0] ?? ""
  }
  return String(v)
}

function insightSeverityJson(tag: string): Record<string, unknown> {
  return { [tag]: [] }
}

async function fetchQuery(resource: string): Promise<Row[]> {
  const r = await fetch(`/api/query/${resource}`)
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error ?? `Query ${resource} failed`)
  }
  const j = (await r.json()) as { data?: Row[] }
  return j.data ?? []
}

async function callReducer(name: string, args: unknown[]): Promise<void> {
  const r = await fetch(`/api/call/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error ?? `${name} failed`)
  }
}

export function AiSettings() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { organizationId } = useStdbConnection()

  const [agents, setAgents] = useState<Row[]>([])
  const [members, setMembers] = useState<Row[]>([])
  const [insights, setInsights] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)

  const [createAgentOpen, setCreateAgentOpen] = useState(false)
  const [editAgent, setEditAgent] = useState<Row | null>(null)
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const [sampleInsightOpen, setSampleInsightOpen] = useState(false)

  const [newAgent, setNewAgent] = useState({
    name: "",
    model: "gpt-4o",
    provider: "OpenAI",
    temperature: 0.7,
    maxTokens: 4096,
    rateLimitPerMinute: 60,
    costPer1KTokens: 0.005,
    contextWindow: 128000,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemPrompt: "",
    monthlyBudget: "",
    description: "",
  })

  const [editFields, setEditFields] = useState({
    temperature: 0.7,
    maxTokens: 4096,
    rateLimitPerMinute: 60,
    contextWindow: "" as string,
    topP: "" as string,
    frequencyPenalty: "" as string,
    presencePenalty: "" as string,
    systemPrompt: "" as string,
    monthlyBudget: "" as string,
  })

  const [newMember, setNewMember] = useState({
    name: "",
    aiAgentId: "" as string,
    role: "Assistant",
    responseStyle: "Friendly",
    responsibilities: "",
    expertiseAreas: "",
  })

  const [sampleSeverity, setSampleSeverity] = useState("Medium")
  const [sampleTitle, setSampleTitle] = useState("")
  const [sampleDescription, setSampleDescription] = useState("")

  const [spendByAgent, setSpendByAgent] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, m, i] = await Promise.all([
        fetchQuery("ai-agents"),
        fetchQuery("ai-team-members"),
        fetchQuery("ai-insights"),
      ])
      setAgents(a)
      setMembers(m)
      setInsights(i)
    } catch (e) {
      toast({
        title: t("settings.ai.loadError"),
        description: e instanceof Error ? e.message : t("settings.ai.loadErrorDescription"),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    if (organizationId == null) return
    void load()
  }, [organizationId, load])

  const orgId = organizationId ?? 0

  const activeInsights = useMemo(
    () => insights.filter((r) => !bool(r.dismissed)),
    [insights],
  )

  const openEdit = (row: Row) => {
    setEditAgent(row)
    setEditFields({
      temperature: Number(row.temperature ?? 0.7),
      maxTokens: num(row.maxTokens),
      rateLimitPerMinute: num(row.rateLimitPerMinute),
      contextWindow: row.contextWindow != null ? String(row.contextWindow) : "",
      topP: row.topP != null ? String(row.topP) : "",
      frequencyPenalty: row.frequencyPenalty != null ? String(row.frequencyPenalty) : "",
      presencePenalty: row.presencePenalty != null ? String(row.presencePenalty) : "",
      systemPrompt: str(row.systemPrompt),
      monthlyBudget:
        row.monthlyBudget != null && row.monthlyBudget !== undefined
          ? String(row.monthlyBudget)
          : "",
    })
  }

  const handleCreateAgent = async () => {
    if (!orgId) return
    setMutating(true)
    try {
      const params = {
        name: newAgent.name.trim() || "Unnamed agent",
        model: newAgent.model.trim(),
        provider: newAgent.provider.trim(),
        temperature: newAgent.temperature,
        maxTokens: Math.round(newAgent.maxTokens),
        rateLimitPerMinute: Math.round(newAgent.rateLimitPerMinute),
        costPer1KTokens: newAgent.costPer1KTokens,
        contextWindow: Math.round(newAgent.contextWindow),
        topP: newAgent.topP,
        frequencyPenalty: newAgent.frequencyPenalty,
        presencePenalty: newAgent.presencePenalty,
        isActive: true,
        isDefault: false,
        allowedModels: [] as string[],
        allowedActions: [] as string[],
        description: newAgent.description.trim() ? newAgent.description.trim() : null,
        apiKeyReference: null,
        systemPrompt: newAgent.systemPrompt.trim() ? newAgent.systemPrompt.trim() : null,
        monthlyBudget:
          newAgent.monthlyBudget.trim() !== ""
            ? Number.parseFloat(newAgent.monthlyBudget)
            : null,
        metadata: null,
      }
      await callReducer("create_ai_agent", [orgId, null, params])
      toast({ title: t("settings.ai.agentCreated") })
      setCreateAgentOpen(false)
      await load()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const handleUpdateAgent = async () => {
    if (!orgId || !editAgent) return
    const id = num(editAgent.id)
    setMutating(true)
    try {
      const params: Record<string, unknown> = {
        temperature: editFields.temperature,
        maxTokens: Math.round(editFields.maxTokens),
        rateLimitPerMinute: Math.round(editFields.rateLimitPerMinute),
        contextWindow:
          editFields.contextWindow.trim() !== ""
            ? Math.round(Number.parseFloat(editFields.contextWindow))
            : null,
        topP: editFields.topP.trim() !== "" ? Number.parseFloat(editFields.topP) : null,
        frequencyPenalty:
          editFields.frequencyPenalty.trim() !== ""
            ? Number.parseFloat(editFields.frequencyPenalty)
            : null,
        presencePenalty:
          editFields.presencePenalty.trim() !== ""
            ? Number.parseFloat(editFields.presencePenalty)
            : null,
        systemPrompt: editFields.systemPrompt.trim() ? editFields.systemPrompt.trim() : null,
        monthlyBudget:
          editFields.monthlyBudget.trim() !== ""
            ? Number.parseFloat(editFields.monthlyBudget)
            : null,
      }
      await callReducer("update_ai_agent", [orgId, id, params])
      toast({ title: t("settings.ai.agentUpdated") })
      setEditAgent(null)
      await load()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const handleSetActive = async (row: Row, isActive: boolean) => {
    if (!orgId) return
    setMutating(true)
    try {
      await callReducer("set_ai_agent_active", [orgId, num(row.id), isActive])
      toast({ title: isActive ? t("settings.ai.agentActivated") : t("settings.ai.agentDeactivated") })
      await load()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const handleCreateMember = async () => {
    if (!orgId) return
    const aid = Number.parseInt(newMember.aiAgentId, 10)
    if (!Number.isFinite(aid)) {
      toast({ title: t("settings.ai.pickAgent"), variant: "destructive" })
      return
    }
    setMutating(true)
    try {
      const params = {
        name: newMember.name.trim() || "Member",
        aiAgentId: aid,
        role: newMember.role.trim(),
        responseStyle: newMember.responseStyle.trim(),
        isActive: true,
        responsibilities: newMember.responsibilities
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        expertiseAreas: newMember.expertiseAreas
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        avatarUrl: null,
        greetingMessage: null,
        personality: null,
        metadata: null,
      }
      await callReducer("create_ai_team_member", [orgId, null, params])
      toast({ title: t("settings.ai.memberCreated") })
      setCreateMemberOpen(false)
      setNewMember({
        name: "",
        aiAgentId: "",
        role: "Assistant",
        responseStyle: "Friendly",
        responsibilities: "",
        expertiseAreas: "",
      })
      await load()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const handleDismissInsight = async (row: Row) => {
    setMutating(true)
    try {
      const cid = row.companyId != null && row.companyId !== undefined ? num(row.companyId) : null
      await callReducer("dismiss_insight", [cid, num(row.id)])
      toast({ title: t("settings.ai.insightDismissed") })
      await load()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const handleCreateSampleInsight = async () => {
    setMutating(true)
    try {
      const params = {
        severity: insightSeverityJson(sampleSeverity),
        title: sampleTitle.trim() || t("settings.ai.sampleInsightDefaultTitle"),
        description: sampleDescription.trim() || t("settings.ai.sampleInsightDefaultDescription"),
        recommendations: [] as string[],
        relatedModel: "settings",
        confidence: 0.85,
        tags: ["ui", "sample"] as string[],
        relatedId: null,
        generatedBy: null,
        impactScore: null,
        priority: null,
        metadata: null,
      }
      await callReducer("create_ai_insight", [null, params])
      toast({ title: t("settings.ai.insightCreated") })
      setSampleInsightOpen(false)
      setSampleTitle("")
      setSampleDescription("")
      await load()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const handleRecordSpend = async (agentId: number) => {
    if (!orgId) return
    const raw = spendByAgent[String(agentId)] ?? "0"
    const tokens = Math.round(Number.parseFloat(raw))
    if (!Number.isFinite(tokens) || tokens <= 0) {
      toast({ title: t("settings.ai.tokensInvalid"), variant: "destructive" })
      return
    }
    setMutating(true)
    try {
      await callReducer("record_ai_spend", [orgId, agentId, tokens])
      toast({ title: t("settings.ai.spendRecorded") })
      setSpendByAgent((prev) => ({ ...prev, [String(agentId)]: "" }))
      await load()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  if (organizationId == null) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {t("settings.formConfig.noOrganization")}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{t("settings.ai.title")}</h2>
            <p className="text-muted-foreground text-sm">{t("settings.ai.description")}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("settings.formConfig.refresh")}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground border-l-2 border-muted pl-3">
        {t("settings.ai.spendNote")}
      </p>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {t("settings.ai.agentsTitle")}
            </CardTitle>
            <CardDescription>{t("settings.ai.agentsDescription")}</CardDescription>
          </div>
          <Button size="sm" className="gap-1" onClick={() => setCreateAgentOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("settings.ai.addAgent")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.ai.noAgents")}</p>
          ) : (
            <ul className="space-y-4">
              {agents.map((a) => {
                const id = num(a.id)
                return (
                  <li
                    key={id}
                    className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{str(a.name)}</span>
                        {bool(a.isDefault) && <Badge variant="secondary">{t("settings.ai.default")}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {str(a.provider)} · {str(a.model)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.ai.monthlySpend")}: {Number(a.monthlySpend ?? 0).toFixed(4)}
                        {a.monthlyBudget != null ? ` / ${t("settings.ai.budget")} ${Number(a.monthlyBudget).toFixed(2)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={bool(a.isActive)}
                          onCheckedChange={(c) => void handleSetActive(a, c)}
                          disabled={mutating}
                        />
                        <span className="text-sm text-muted-foreground">{t("settings.ai.active")}</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
                        {t("settings.ai.edit")}
                      </Button>
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-24 h-8"
                          type="number"
                          min={1}
                          placeholder={t("settings.ai.tokensPlaceholder")}
                          value={spendByAgent[String(id)] ?? ""}
                          onChange={(e) =>
                            setSpendByAgent((prev) => ({ ...prev, [String(id)]: e.target.value }))
                          }
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          className="gap-1 shrink-0"
                          disabled={mutating}
                          onClick={() => void handleRecordSpend(id)}
                        >
                          <Coins className="h-3.5 w-3.5" />
                          {t("settings.ai.recordSpend")}
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{t("settings.ai.teamTitle")}</CardTitle>
            <CardDescription>{t("settings.ai.teamDescription")}</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setCreateMemberOpen(true)}
            disabled={agents.length === 0}
          >
            <Plus className="h-4 w-4" />
            {t("settings.ai.addMember")}
          </Button>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.ai.noMembers")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {members.map((m) => {
                const mid = num(m.id)
                const agentName = str(agents.find((x) => num(x.id) === num(m.aiAgentId))?.name) || `#${num(m.aiAgentId)}`
                return (
                  <li key={mid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{str(m.name)}</span>
                    <span className="text-muted-foreground">
                      {str(m.role)} · {agentName}
                    </span>
                    {bool(m.isActive) ? (
                      <Badge variant="outline" className="text-xs">
                        {t("settings.ai.active")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {t("settings.ai.inactive")}
                      </Badge>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{t("settings.ai.insightsTitle")}</CardTitle>
            <CardDescription>{t("settings.ai.insightsDescription")}</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSampleInsightOpen(true)}>
            {t("settings.ai.addSampleInsight")}
          </Button>
        </CardHeader>
        <CardContent>
          {activeInsights.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.ai.noInsights")}</p>
          ) : (
            <ul className="space-y-3">
              {activeInsights.map((ins) => {
                const iid = num(ins.id)
                return (
                  <li key={iid} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{str(ins.title)}</span>
                          <Badge variant="outline">{severityLabel(ins.severity)}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{str(ins.description)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive gap-1"
                        disabled={mutating}
                        onClick={() => void handleDismissInsight(ins)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("settings.ai.dismiss")}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={createAgentOpen} onOpenChange={setCreateAgentOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("settings.ai.createAgentTitle")}</DialogTitle>
            <DialogDescription>{t("settings.ai.createAgentDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>{t("settings.ai.name")}</Label>
              <Input value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>{t("settings.ai.provider")}</Label>
                <Input
                  value={newAgent.provider}
                  onChange={(e) => setNewAgent({ ...newAgent, provider: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("settings.ai.model")}</Label>
                <Input value={newAgent.model} onChange={(e) => setNewAgent({ ...newAgent, model: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.description")}</Label>
              <Input
                value={newAgent.description}
                onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.systemPrompt")}</Label>
              <Textarea
                rows={3}
                value={newAgent.systemPrompt}
                onChange={(e) => setNewAgent({ ...newAgent, systemPrompt: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>{t("settings.ai.temperature")}</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={newAgent.temperature}
                  onChange={(e) =>
                    setNewAgent({ ...newAgent, temperature: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("settings.ai.maxTokens")}</Label>
                <Input
                  type="number"
                  value={newAgent.maxTokens}
                  onChange={(e) =>
                    setNewAgent({ ...newAgent, maxTokens: Number.parseInt(e.target.value, 10) || 0 })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>{t("settings.ai.monthlyBudget")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder={t("settings.ai.optional")}
                  value={newAgent.monthlyBudget}
                  onChange={(e) => setNewAgent({ ...newAgent, monthlyBudget: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("settings.ai.costPer1K")}</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={newAgent.costPer1KTokens}
                  onChange={(e) =>
                    setNewAgent({ ...newAgent, costPer1KTokens: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAgentOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleCreateAgent()} disabled={mutating}>
              {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.ai.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editAgent} onOpenChange={(o) => !o && setEditAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.ai.editAgentTitle")}</DialogTitle>
            <DialogDescription>{str(editAgent?.name)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>{t("settings.ai.temperature")}</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={editFields.temperature}
                  onChange={(e) =>
                    setEditFields({ ...editFields, temperature: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("settings.ai.maxTokens")}</Label>
                <Input
                  type="number"
                  value={editFields.maxTokens}
                  onChange={(e) =>
                    setEditFields({ ...editFields, maxTokens: Number.parseInt(e.target.value, 10) || 0 })
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.rateLimit")}</Label>
              <Input
                type="number"
                value={editFields.rateLimitPerMinute}
                onChange={(e) =>
                  setEditFields({
                    ...editFields,
                    rateLimitPerMinute: Number.parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.systemPrompt")}</Label>
              <Textarea
                rows={4}
                value={editFields.systemPrompt}
                onChange={(e) => setEditFields({ ...editFields, systemPrompt: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.monthlyBudget")}</Label>
              <Input
                type="number"
                step="0.01"
                placeholder={t("settings.ai.optional")}
                value={editFields.monthlyBudget}
                onChange={(e) => setEditFields({ ...editFields, monthlyBudget: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAgent(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleUpdateAgent()} disabled={mutating}>
              {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.formConfig.saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createMemberOpen} onOpenChange={setCreateMemberOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.ai.createMemberTitle")}</DialogTitle>
            <DialogDescription>{t("settings.ai.createMemberDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>{t("settings.ai.agent")}</Label>
              <Select value={newMember.aiAgentId} onValueChange={(v) => setNewMember({ ...newMember, aiAgentId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t("settings.ai.pickAgent")} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={num(a.id)} value={String(num(a.id))}>
                      {str(a.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.name")}</Label>
              <Input value={newMember.name} onChange={(e) => setNewMember({ ...newMember, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>{t("settings.ai.role")}</Label>
                <Input value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>{t("settings.ai.responseStyle")}</Label>
                <Input
                  value={newMember.responseStyle}
                  onChange={(e) => setNewMember({ ...newMember, responseStyle: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.responsibilities")}</Label>
              <Input
                placeholder={t("settings.ai.csvHint")}
                value={newMember.responsibilities}
                onChange={(e) => setNewMember({ ...newMember, responsibilities: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.expertiseAreas")}</Label>
              <Input
                placeholder={t("settings.ai.csvHint")}
                value={newMember.expertiseAreas}
                onChange={(e) => setNewMember({ ...newMember, expertiseAreas: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateMemberOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleCreateMember()} disabled={mutating}>
              {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.ai.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sampleInsightOpen} onOpenChange={setSampleInsightOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.ai.sampleInsightTitle")}</DialogTitle>
            <DialogDescription>{t("settings.ai.sampleInsightDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>{t("settings.ai.severity")}</Label>
              <Select value={sampleSeverity} onValueChange={setSampleSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["Info", "Low", "Medium", "High", "Critical"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.insightTitleField")}</Label>
              <Input value={sampleTitle} onChange={(e) => setSampleTitle(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.ai.insightDescriptionField")}</Label>
              <Textarea rows={3} value={sampleDescription} onChange={(e) => setSampleDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSampleInsightOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleCreateSampleInsight()} disabled={mutating}>
              {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.ai.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
