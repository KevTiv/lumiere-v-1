"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useStdbConnection } from "@lumiere/stdb"
import { FormModal, mergeFieldDefaultValues } from "@lumiere/ui"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  useAiAgents,
  useCreateAiAgent,
  useCreateAiInsight,
  useCreateAiTeamMember,
  useDismissAiInsight,
  useRecordAiSpend,
  useSetAiAgentActive,
  useUpdateAiAgent,
} from "@/hooks/ai-agents"
import { aiAgentCreateFormConfig, aiAgentEditFormConfig } from "@/lib/ai-agent-form-configs"
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

function numFromForm(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  const n = Number.parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : 0
}

function u32FromForm(v: unknown): number {
  return Math.round(numFromForm(v))
}

function strOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim()
  return s === "" ? null : s
}

function optF64(v: unknown): number | null {
  const s = String(v ?? "").trim()
  if (s === "") return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function optU32(v: unknown): number | null {
  const s = String(v ?? "").trim()
  if (s === "") return null
  const n = Math.round(Number.parseFloat(s))
  return Number.isFinite(n) ? n : null
}

function buildCreateAiAgentParams(data: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(data.name ?? "").trim() || "Unnamed agent",
    model: String(data.model ?? "").trim(),
    provider: String(data.provider ?? "").trim(),
    temperature: numFromForm(data.temperature),
    maxTokens: u32FromForm(data.maxTokens),
    rateLimitPerMinute: u32FromForm(data.rateLimitPerMinute),
    costPer1KTokens: numFromForm(data.costPer1KTokens),
    contextWindow: u32FromForm(data.contextWindow),
    topP: numFromForm(data.topP),
    frequencyPenalty: numFromForm(data.frequencyPenalty),
    presencePenalty: numFromForm(data.presencePenalty),
    isActive: true,
    isDefault: false,
    allowedModels: [] as string[],
    allowedActions: [] as string[],
    description: strOrNull(data.description),
    apiKeyReference: null,
    systemPrompt: strOrNull(data.systemPrompt),
    monthlyBudget: optF64(data.monthlyBudget),
    metadata: null,
  }
}

function buildUpdateAiAgentParams(data: Record<string, unknown>): Record<string, unknown> {
  return {
    temperature: numFromForm(data.temperature),
    maxTokens: u32FromForm(data.maxTokens),
    rateLimitPerMinute: u32FromForm(data.rateLimitPerMinute),
    contextWindow: optU32(data.contextWindow),
    topP: optF64(data.topP),
    frequencyPenalty: optF64(data.frequencyPenalty),
    presencePenalty: optF64(data.presencePenalty),
    systemPrompt: strOrNull(data.systemPrompt),
    monthlyBudget: optF64(data.monthlyBudget),
  }
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

export function AiSettings() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { organizationId } = useStdbConnection()

  const orgReady = organizationId != null && organizationId > 0
  const orgId = organizationId ?? 0

  const agentsQuery = useAiAgents(orgId, orgReady)
  const refetchAgents = agentsQuery.refetch
  const createAgentMutation = useCreateAiAgent(orgId)
  const updateAgentMutation = useUpdateAiAgent(orgId)
  const setActiveMutation = useSetAiAgentActive(orgId)
  const createTeamMemberMutation = useCreateAiTeamMember(orgId)
  const dismissInsightMutation = useDismissAiInsight()
  const createInsightMutation = useCreateAiInsight()
  const recordSpendMutation = useRecordAiSpend(orgId)

  const agents = agentsQuery.data ?? []

  const [members, setMembers] = useState<Row[]>([])
  const [insights, setInsights] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const [createAgentOpen, setCreateAgentOpen] = useState(false)
  const [createFormKey, setCreateFormKey] = useState(0)
  const [createAgentError, setCreateAgentError] = useState<string | null>(null)
  const [editAgent, setEditAgent] = useState<Row | null>(null)
  const [editAgentError, setEditAgentError] = useState<string | null>(null)
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const [sampleInsightOpen, setSampleInsightOpen] = useState(false)

  const createFormConfig = useMemo(() => aiAgentCreateFormConfig(t), [t])
  const editFormBase = useMemo(() => aiAgentEditFormConfig(t), [t])
  const editFormConfig = useMemo(() => {
    if (!editAgent) return editFormBase
    const id = num(editAgent.id)
    const merged = mergeFieldDefaultValues(editFormBase, {
      agentId: String(id),
      temperature: Number(editAgent.temperature ?? 0.7),
      maxTokens: num(editAgent.maxTokens),
      rateLimitPerMinute: num(editAgent.rateLimitPerMinute),
      contextWindow: editAgent.contextWindow != null ? String(editAgent.contextWindow) : "",
      topP: editAgent.topP != null ? String(editAgent.topP) : "",
      frequencyPenalty: editAgent.frequencyPenalty != null ? String(editAgent.frequencyPenalty) : "",
      presencePenalty: editAgent.presencePenalty != null ? String(editAgent.presencePenalty) : "",
      systemPrompt: str(editAgent.systemPrompt),
      monthlyBudget:
        editAgent.monthlyBudget != null && editAgent.monthlyBudget !== undefined
          ? String(editAgent.monthlyBudget)
          : "",
    })
    return { ...merged, description: str(editAgent.name) }
  }, [editAgent, editFormBase])

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

  const loadSecondary = useCallback(async () => {
    if (!orgReady) return
    setLoading(true)
    try {
      const [m, i] = await Promise.all([fetchQuery("ai-team-members"), fetchQuery("ai-insights")])
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
  }, [orgReady, t, toast])

  const refreshAll = useCallback(async () => {
    if (!orgReady) return
    setLoading(true)
    try {
      const [m, i] = await Promise.all([fetchQuery("ai-team-members"), fetchQuery("ai-insights")])
      setMembers(m)
      setInsights(i)
      await refetchAgents()
    } catch (e) {
      toast({
        title: t("settings.ai.loadError"),
        description: e instanceof Error ? e.message : t("settings.ai.loadErrorDescription"),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [orgReady, refetchAgents, t, toast])

  useEffect(() => {
    if (!orgReady) return
    void loadSecondary()
  }, [orgReady, loadSecondary])

  const activeInsights = useMemo(
    () => insights.filter((r) => !bool(r.dismissed)),
    [insights],
  )

  const handleCreateMember = async () => {
    if (!orgId) return
    const aid = Number.parseInt(newMember.aiAgentId, 10)
    if (!Number.isFinite(aid)) {
      toast({ title: t("settings.ai.pickAgent"), variant: "destructive" })
      return
    }
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
      await createTeamMemberMutation.mutateAsync({ companyId: null, params })
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
      await refreshAll()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    }
  }

  const handleDismissInsight = async (row: Row) => {
    try {
      const cid = row.companyId != null && row.companyId !== undefined ? num(row.companyId) : null
      await dismissInsightMutation.mutateAsync({ companyId: cid, insightId: num(row.id) })
      toast({ title: t("settings.ai.insightDismissed") })
      await refreshAll()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    }
  }

  const handleCreateSampleInsight = async () => {
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
      await createInsightMutation.mutateAsync({ companyId: null, params })
      toast({ title: t("settings.ai.insightCreated") })
      setSampleInsightOpen(false)
      setSampleTitle("")
      setSampleDescription("")
      await refreshAll()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
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
    try {
      await recordSpendMutation.mutateAsync({ agentId, tokensUsed: tokens })
      toast({ title: t("settings.ai.spendRecorded") })
      setSpendByAgent((prev) => ({ ...prev, [String(agentId)]: "" }))
      await refreshAll()
    } catch (e) {
      toast({
        title: t("settings.ai.mutationError"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
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

  const listLoading = loading || agentsQuery.isLoading
  const agentOpsPending =
    createAgentMutation.isPending || updateAgentMutation.isPending || setActiveMutation.isPending
  const mutating =
    createTeamMemberMutation.isPending ||
    dismissInsightMutation.isPending ||
    createInsightMutation.isPending ||
    recordSpendMutation.isPending

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
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void refreshAll()}
          disabled={listLoading}
        >
          {listLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
          <Button
            size="sm"
            className="gap-1"
            onClick={() => {
              setCreateFormKey((k) => k + 1)
              setCreateAgentError(null)
              setCreateAgentOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            {t("settings.ai.addAgent")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {listLoading ? (
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
                          onCheckedChange={(c) => {
                            void (async () => {
                              try {
                                await setActiveMutation.mutateAsync({ agentId: id, isActive: c })
                                toast({
                                  title: c
                                    ? t("settings.ai.agentActivated")
                                    : t("settings.ai.agentDeactivated"),
                                })
                              } catch (e) {
                                toast({
                                  title: t("settings.ai.mutationError"),
                                  description: e instanceof Error ? e.message : "",
                                  variant: "destructive",
                                })
                              }
                            })()
                          }}
                          disabled={mutating || agentOpsPending}
                        />
                        <span className="text-sm text-muted-foreground">{t("settings.ai.active")}</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setEditAgent(a)}>
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

      <FormModal
        key={createFormKey}
        open={createAgentOpen}
        onOpenChange={(o) => {
          setCreateAgentOpen(o)
          if (!o) setCreateAgentError(null)
        }}
        config={createFormConfig}
        closeOnSubmit={false}
        submitError={createAgentError}
        onSubmit={async (data) => {
          setCreateAgentError(null)
          if (!orgId) return
          try {
            await createAgentMutation.mutateAsync(buildCreateAiAgentParams(data))
            toast({ title: t("settings.ai.agentCreated") })
            setCreateAgentOpen(false)
          } catch (e) {
            setCreateAgentError(e instanceof Error ? e.message : t("settings.ai.mutationError"))
          }
        }}
      />

      {editAgent != null ? (
        <FormModal
          key={`edit-${num(editAgent.id)}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setEditAgent(null)
              setEditAgentError(null)
            }
          }}
          config={editFormConfig}
          closeOnSubmit={false}
          submitError={editAgentError}
          onSubmit={async (data) => {
            setEditAgentError(null)
            if (!orgId) return
            const aid = Number.parseInt(String(data.agentId), 10)
            if (!Number.isFinite(aid)) {
              setEditAgentError(t("settings.ai.mutationError"))
              return
            }
            try {
              await updateAgentMutation.mutateAsync({
                agentId: aid,
                params: buildUpdateAiAgentParams(data),
              })
              toast({ title: t("settings.ai.agentUpdated") })
              setEditAgent(null)
            } catch (e) {
              setEditAgentError(e instanceof Error ? e.message : t("settings.ai.mutationError"))
            }
          }}
        />
      ) : null}

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
