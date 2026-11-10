"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import { apiFetch } from "@/lib/api-fetch"
import { responseErrorMessage } from "@lumiere/api-client/response-error"
import { parsePlatformAiProfile, parsePlatformAiProfileState, type PlatformAiProfile, type PlatformAiProfileState, type PlatformModelProfile } from "@/lib/ai-platform-profile"

const roles = ["generation_profile", "review_profile"] as const
const numericModelFields = ["max_tokens", "context_window", "timeout_ms", "max_concurrency", "input_cost_per_1k_microunits", "output_cost_per_1k_microunits"] as const
const numericProfileFields = ["monthly_limit_units", "rate_limit_per_minute", "max_enrolled_organizations"] as const

export function platformProfileFromForm(form: FormData): PlatformAiProfile {
  const model = (role: (typeof roles)[number]) => ({
    provider: String(form.get(`${role}.provider`) ?? ""),
    model: String(form.get(`${role}.model`) ?? "").trim(),
    ...Object.fromEntries(numericModelFields.map((field) => [field, Number(form.get(`${role}.${field}`) || NaN)])),
  })
  return parsePlatformAiProfile({
    template_key: String(form.get("template_key") ?? "").trim(),
    template_version: Number(form.get("template_version")),
    currency: String(form.get("currency") ?? "").trim().toUpperCase(),
    generation_profile: model("generation_profile"), review_profile: model("review_profile"),
    ...Object.fromEntries(numericProfileFields.map((field) => [field, Number(form.get(field) || NaN)])),
  })
}

async function profileRequest(profile?: PlatformAiProfile): Promise<PlatformAiProfileState> {
  const response = await apiFetch("/api/ai/harness/profile", profile ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
  } : undefined)
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return parsePlatformAiProfileState(await response.json())
}

export function PlatformAiProfilePanel({ organizationId }: { organizationId: bigint }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const queryKey = ["ai-platform-profile", String(organizationId)]
  const query = useQuery({ queryKey, queryFn: () => profileRequest(), retry: false })
  const publish = useMutation({
    mutationFn: profileRequest,
    retry: false,
    onSuccess: (data) => qc.setQueryData(queryKey, data),
  })
  if (query.isPending) return <p role="status">{t("aiHarness.platformProfile.loading")}</p>
  if (query.error || !query.data) return <div role="alert" className="space-y-3">
    <p>{query.error?.message ?? t("aiHarness.platformProfile.unavailable")}</p>
    <Button variant="outline" onClick={() => void query.refetch()}>{t("aiHarness.platformProfile.retry")}</Button>
  </div>
  return <PlatformAiProfileForm
    key={query.data.active_template?.id ?? "unconfigured"}
    state={query.data}
    pending={publish.isPending}
    error={publish.error?.message}
    saved={publish.isSuccess}
    onPublish={(profile) => publish.mutate(profile)}
  />
}

export function PlatformAiProfileForm({ state, pending, error, saved, onPublish }: {
  state: PlatformAiProfileState
  pending: boolean
  error?: string
  saved?: boolean
  onPublish: (profile: PlatformAiProfile) => void
}) {
  const { t } = useTranslation()
  const [validationError, setValidationError] = useState<string | null>(null)
  const current = state.active_template
  const nextVersion = Math.max(0, ...state.templates.filter((item) => item.template_key === (current?.template_key ?? "alpha-default")).map((item) => item.template_version)) + 1
  return <form className="max-w-5xl space-y-6" onSubmit={(event) => {
    event.preventDefault()
    if (pending) return
    setValidationError(null)
    try { onPublish(platformProfileFromForm(new FormData(event.currentTarget))) }
    catch (error) { setValidationError(error instanceof Error ? error.message : t("aiHarness.platformProfile.invalid")) }
  }}>
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{t("aiHarness.platformProfile.title")}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{t("aiHarness.platformProfile.description")}</p>
      <p className="text-sm">{current
        ? t("aiHarness.platformProfile.active", { key: current.template_key, version: current.template_version })
        : t("aiHarness.platformProfile.empty")}</p>
    </div>
    <fieldset disabled={pending} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="platform-template-key">{t("aiHarness.platformProfile.fields.template_key")}</Label><Input id="platform-template-key" name="template_key" required maxLength={96} defaultValue={current?.template_key ?? "alpha-default"} /></div>
        <div className="space-y-2"><Label htmlFor="platform-template-version">{t("aiHarness.platformProfile.fields.template_version")}</Label><Input id="platform-template-version" name="template_version" type="number" min={1} step={1} max={0xffffffff} required defaultValue={nextVersion} /></div>
        <div className="space-y-2"><Label htmlFor="platform-currency">{t("aiHarness.platformProfile.fields.currency")}</Label><Input id="platform-currency" name="currency" minLength={3} maxLength={3} required defaultValue={current?.currency ?? ""} /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {roles.map((role) => <ModelProfileFields key={role} role={role} profile={current?.[role]} />)}
      </div>
      <fieldset className="space-y-4 border-t pt-5">
        <legend className="px-1 font-medium">{t("aiHarness.platformProfile.limits")}</legend>
        <p className="text-sm text-muted-foreground">{t("aiHarness.platformProfile.budgetHint")}</p>
        <div className="grid gap-4 sm:grid-cols-3">{numericProfileFields.map((field) => <div key={field} className="space-y-2">
          <Label htmlFor={`platform-${field}`}>{t(`aiHarness.platformProfile.fields.${field}`)}</Label>
          <Input id={`platform-${field}`} name={field} type="number" min={1} step={1} max={field === "monthly_limit_units" ? Number.MAX_SAFE_INTEGER : 0xffffffff} required defaultValue={current?.[field] ?? ""} />
        </div>)}</div>
      </fieldset>
      <p className="text-sm text-muted-foreground">{t("aiHarness.platformProfile.publishHint")}</p>
      {validationError || error ? <p role="alert" className="text-sm text-destructive">{validationError ?? error}</p> : null}
      {saved ? <p role="status" className="text-sm">{t("aiHarness.platformProfile.saved")}</p> : null}
      <Button type="submit" disabled={pending}>{t(pending ? "aiHarness.platformProfile.publishing" : "aiHarness.platformProfile.publish")}</Button>
    </fieldset>
  </form>
}

function ModelProfileFields({ role, profile }: { role: (typeof roles)[number]; profile?: PlatformModelProfile }) {
  const { t } = useTranslation()
  return <fieldset className="space-y-4 border-t pt-5">
    <legend className="px-1 font-medium">{t(`aiHarness.platformProfile.roles.${role}`)}</legend>
    <div className="space-y-2">
      <Label htmlFor={`${role}-provider`}>{t("aiHarness.platformProfile.fields.provider")}</Label>
      <Select name={`${role}.provider`} required defaultValue={profile?.provider}>
        <SelectTrigger id={`${role}-provider`}><SelectValue placeholder={t("aiHarness.platformProfile.chooseProvider")} /></SelectTrigger>
        <SelectContent>{["mistral", "gemini", "ollama"].map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="space-y-2"><Label htmlFor={`${role}-model`}>{t("aiHarness.platformProfile.fields.model")}</Label><Input id={`${role}-model`} name={`${role}.model`} required maxLength={128} defaultValue={profile?.model ?? ""} /></div>
    <div className="grid gap-4 sm:grid-cols-2">{numericModelFields.map((field) => <div key={field} className="space-y-2">
      <Label htmlFor={`${role}-${field}`}>{t(`aiHarness.platformProfile.fields.${field}`)}</Label>
      <Input id={`${role}-${field}`} name={`${role}.${field}`} type="number" min={field.includes("cost") ? 0 : 1} step={1} max={field.includes("cost") ? 1_000_000_000_000 : 0xffffffff} required defaultValue={profile?.[field] ?? ""} />
    </div>)}</div>
    <p className="text-sm text-muted-foreground">{t("aiHarness.platformProfile.modelHint")}</p>
  </fieldset>
}
