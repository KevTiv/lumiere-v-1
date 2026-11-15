"use client"

import { useState } from "react"
import { PlayIcon, PlusIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import { nullableBigIntU64 as asId } from "@lumiere/erp-shared/form-coercion"
import {
  useContactSegmentRules,
  useContactSegments,
  useContactTags,
  useEvaluateDynamicSegment,
  useSetContactSegmentRules,
} from "@lumiere/query-hooks/hooks/crm"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  maxSegmentRules,
  savedSegmentRules,
  segmentOperators,
  segmentRuleNeedsValue,
  segmentRuleReplacement,
  type SegmentRuleDraft,
} from "./segment-rule-editor"

const fields = {
  CountryCode: "Country code",
  City: "City",
  Industry: "Industry",
  IsCustomer: "Customer",
  IsProspect: "Prospect",
  IsVendor: "Vendor",
  TagId: "Contact tag",
} as const satisfies Record<SegmentRuleDraft["field"], string>

const operatorLabels = {
  Eq: "Equals",
  Neq: "Does not equal",
  Contains: "Contains",
  IsTrue: "Yes",
  IsFalse: "No",
} as const satisfies Record<SegmentRuleDraft["operator"], string>

const newRule: SegmentRuleDraft = { field: "CountryCode", operator: "Eq", value: "" }

export function SegmentRulesPanel({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { rows: segments, state } = moduleCollection(useContactSegments(organization))
  const [segmentId, setSegmentId] = useState("")
  const dynamicSegments = segments.filter((row) => row.isDynamic)
  const selected = dynamicSegments.find((row) => String(row.id) === segmentId)
  const selectedId = asId(selected?.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crm.segments.rulesTitle", "Dynamic segment rules")}</CardTitle>
        <CardDescription>{t("crm.segments.rulesDescription", "Contacts must match every rule. Evaluate to refresh membership.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "loading" ? <p role="status">{t("common.loading")}</p> : <ModuleDataNotice state={state} />}
        <div className="space-y-2">
          <Label htmlFor="dynamic-segment">{t("crm.segments.select", "Dynamic segment")}</Label>
          <Select value={selected ? segmentId : ""} disabled={state.status !== "ready"} onValueChange={(value) => setSegmentId(value ?? "")}>
            <SelectTrigger id="dynamic-segment">
              <SelectValue placeholder={t("crm.segments.selectPlaceholder", "Choose segment")} />
            </SelectTrigger>
            <SelectContent>
              {dynamicSegments.map((segment) => (
                <SelectItem key={String(segment.id)} value={String(segment.id)}>{segment.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {state.status === "ready" && selected && selectedId != null ? (
          <SegmentRuleEditor
            key={`${organization}:${selectedId}`}
            organization={organization}
            segmentId={selectedId}
            memberCount={selected.memberCount}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function SegmentRuleEditor({ organization, segmentId, memberCount }: {
  organization: bigint
  segmentId: bigint
  memberCount?: number | null
}) {
  const { t } = useTranslation()
  const { checkPermission } = useRBAC()
  const canWrite = checkPermission("contact_segment", "write").allowed
  const rulesQuery = useContactSegmentRules(organization)
  const { rows, state } = moduleCollection(rulesQuery)
  const tags = moduleCollection(useContactTags(organization))
  const setRules = useSetContactSegmentRules(organization)
  const evaluate = useEvaluateDynamicSegment(organization)
  const [draft, setDraft] = useState<{ rules: SegmentRuleDraft[]; fingerprint: string }>()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const saved = savedSegmentRules(rows, segmentId)
  const next = draft?.rules ?? saved.rules
  const replacement = segmentRuleReplacement(next, saved.metadata)
  const unchanged = JSON.stringify(next) === JSON.stringify(saved.rules)
  const changedRemotely = draft != null && draft.fingerprint !== saved.fingerprint
  const editingAllowed = state.status === "ready" && canWrite && saved.canEdit
  const tagName = (id: string) => tags.rows.find((tag) => String(tag.id) === id)?.name ?? id
  const fieldLabel = (field: SegmentRuleDraft["field"]) => t(`crm.segments.fields.${field}`, { defaultValue: fields[field] })
  const operatorLabel = (operator: SegmentRuleDraft["operator"]) => t(`crm.segments.operators.${operator}`, { defaultValue: operatorLabels[operator] })

  function change(rules: SegmentRuleDraft[]) {
    setDraft({ rules, fingerprint: saved.fingerprint })
    setReviewOpen(false)
    setError("")
    setNotice("")
  }

  async function save() {
    if (!editingAllowed || !reviewOpen || !replacement || !draft || unchanged || changedRemotely || saving) return
    setSaving(true)
    setError("")
    try {
      const fresh = await fetchQueryList("/api/query/contact-segment-rules", "Failed to refresh segment rules")
      const freshSaved = savedSegmentRules(fresh, segmentId)
      if (!freshSaved.canEdit || freshSaved.fingerprint !== draft.fingerprint) {
        void rulesQuery.refetch()
        throw new Error(t("crm.segments.rulesRefreshConflict", { defaultValue: "Saved rules could not be verified. Reload the saved rules before replacing them." }))
      }
      await setRules.mutateAsync({ segmentId, params: replacement })
      setNotice(t("crm.segments.rulesSaved", { defaultValue: "Rules saved. Evaluate to update membership." }))
      setDraft(undefined)
      setReviewOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function describe(rule: SegmentRuleDraft) {
    return [fieldLabel(rule.field), operatorLabel(rule.operator), rule.field === "TagId" ? tagName(rule.value) : rule.value]
      .filter(Boolean).join(" · ")
  }

  if (state.status === "loading") return <p role="status">{t("common.loading")}</p>
  if (state.status !== "ready") return <ModuleDataNotice state={state} />

  return (
    <div className="space-y-4">
      {typeof memberCount === "number" ? <p className="text-sm text-muted-foreground">{t("crm.segments.existingMembers", {
        defaultValue: "Current membership: {{count}}",
        count: memberCount,
      })}</p> : null}
      {!saved.canEdit ? (
        <p role="status" className="text-sm text-muted-foreground">{t("crm.segments.rulesCannotEdit", { defaultValue: "These saved rules include settings that this editor cannot preserve." })}</p>
      ) : null}
      {next.length === 0 ? <p className="text-sm text-muted-foreground">{t("crm.segments.noRules", "No rules yet.")}</p> : null}
      {next.map((rule, index) => {
        const update = (value: SegmentRuleDraft) => change(next.map((row, position) => position === index ? value : row))
        if (!editingAllowed) return <p key={index} className="text-sm">{describe(rule)}</p>
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select value={rule.field} disabled={saving || changedRemotely} onValueChange={(field) => {
              if (Object.hasOwn(segmentOperators, field)) {
                const selectedField = field as SegmentRuleDraft["field"]
                update({ field: selectedField, operator: segmentOperators[selectedField][0], value: "" })
              }
            }}>
              <SelectTrigger aria-label={t("crm.segments.ruleField", { defaultValue: "Rule field {{number}}", number: index + 1 })}><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(fields) as SegmentRuleDraft["field"][]).map((field) => <SelectItem key={field} value={field}>{fieldLabel(field)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={rule.operator} disabled={saving || changedRemotely} onValueChange={(operator) => {
              const selectedOperator = segmentOperators[rule.field].find((option) => option === operator)
              if (selectedOperator) update({ ...rule, operator: selectedOperator })
            }}>
              <SelectTrigger aria-label={t("crm.segments.ruleOperator", { defaultValue: "Rule operator {{number}}", number: index + 1 })}><SelectValue /></SelectTrigger>
              <SelectContent>{segmentOperators[rule.field].map((operator) => <SelectItem key={operator} value={operator}>{operatorLabel(operator)}</SelectItem>)}</SelectContent>
            </Select>
            {segmentRuleNeedsValue(rule.field) ? rule.field === "TagId" ? (
              <Select value={rule.value} disabled={saving || changedRemotely || tags.state.status !== "ready"} onValueChange={(value) => update({ ...rule, value: value ?? "" })}>
                <SelectTrigger aria-label={t("crm.segments.ruleValue", { defaultValue: "Rule value {{number}}", number: index + 1 })}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {rule.value && !tags.rows.some((tag) => String(tag.id) === rule.value) ? <SelectItem value={rule.value}>{rule.value}</SelectItem> : null}
                  {tags.rows.map((tag) => <SelectItem key={String(tag.id)} value={String(tag.id)}>{tag.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input className="w-48" value={rule.value} disabled={saving || changedRemotely}
                aria-label={t("crm.segments.ruleValue", { defaultValue: "Rule value {{number}}", number: index + 1 })}
                onChange={(event) => update({ ...rule, value: event.target.value })} />
            ) : null}
            <Button type="button" size="sm" variant="ghost" disabled={saving || changedRemotely} onClick={() => change(next.filter((_, position) => position !== index))}>
              {t("crm.segments.removeRule", { defaultValue: "Remove rule" })}
            </Button>
          </div>
        )
      })}
      {next.some((rule) => rule.field === "TagId") ? <ModuleDataNotice state={tags.state} /> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {changedRemotely ? <p role="alert" className="text-sm text-destructive">{t("crm.segments.rulesChanged", {
        defaultValue: "The saved rules changed while you were editing.",
      })}</p> : null}
      {editingAllowed ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={saving || changedRemotely || next.length >= maxSegmentRules} onClick={() => change([...next, newRule])}>
            <PlusIcon /> {t("crm.segments.addRule", { defaultValue: "Add rule" })}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={saving || !replacement || unchanged || changedRemotely} onClick={() => setReviewOpen(true)}>
            {t("crm.segments.reviewRules", { defaultValue: "Review changes" })}
          </Button>
          {draft ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => {
            setDraft(undefined)
            setReviewOpen(false)
            setError("")
          }}>{t("crm.segments.resetRules", { defaultValue: "Reload saved rules" })}</Button> : null}
          <Button type="button" size="sm" disabled={saving || evaluate.isPending || !unchanged || saved.rules.length === 0} onClick={async () => {
            setError("")
            setNotice("")
            try {
              await evaluate.mutateAsync(segmentId)
              setNotice(t("crm.segments.evaluated", { defaultValue: "Membership refreshed." }))
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          }}>
            <PlayIcon /> {t("crm.segments.evaluate", "Evaluate")}
          </Button>
        </div>
      ) : null}
      {reviewOpen && editingAllowed ? (
        <section className="space-y-2 rounded-md border p-3 text-sm">
          <h3 className="font-medium">{t("crm.segments.replacementTitle", { defaultValue: "Rules after saving" })}</h3>
          <ul className="list-disc pl-5">{next.map((rule, index) => <li key={index}>{describe(rule)}</li>)}</ul>
          <p>{next.length
            ? t("crm.segments.replacementImpact", { defaultValue: "These rules replace the current rules. Existing membership changes when you evaluate the new rules." })
            : t("crm.segments.removeAllImpact", { defaultValue: "This removes every rule. Current membership stays in place, and evaluation requires at least one rule." })}</p>
          <Button type="button" size="sm" disabled={saving || changedRemotely || unchanged || !replacement} onClick={() => void save()}>
            {t("crm.segments.saveRules", { defaultValue: "Save replacement rules" })}
          </Button>
        </section>
      ) : null}
    </div>
  )
}
