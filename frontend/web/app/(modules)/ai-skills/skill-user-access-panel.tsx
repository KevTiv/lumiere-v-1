"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { httpResponseError } from "@lumiere/api-client/response-error"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import type { AiSkillListItem } from "@lumiere/query-hooks/hooks/ai-skills"
import { Button, Label } from "@lumiere/ui"
import { RecordPicker } from "@lumiere/ui/components/record-picker"

import { apiFetch } from "@/lib/api-fetch"
import { personIdentity, selectedPerson } from "@/lib/authorized-people"
import { useAuthorizedPeople } from "@/lib/use-authorized-people"

const ACCESS_PATH = "/api/ai/skills/user-access"

interface SkillUserAccess {
  builtInSkillKeys: string[]
  revokedUserIdentities: string[]
}

async function readSkillUserAccess(skillKey: string, signal: AbortSignal): Promise<SkillUserAccess> {
  const query = skillKey ? `?${new URLSearchParams({ skillKey })}` : ""
  const response = await apiFetch(ACCESS_PATH + query, { signal, cache: "no-store" })
  if (!response.ok) throw await httpResponseError(response)

  const data: unknown = await response.json()
  if (!data || typeof data !== "object"
    || !("builtInSkillKeys" in data) || !Array.isArray(data.builtInSkillKeys)
    || !data.builtInSkillKeys.every((key) => typeof key === "string" && /^[a-z][a-z0-9_]*$/.test(key))
    || !("revokedUserIdentities" in data) || !Array.isArray(data.revokedUserIdentities)) {
    throw new Error("Unexpected skill access response")
  }
  const revokedUserIdentities = data.revokedUserIdentities.map(personIdentity)
  if (revokedUserIdentities.some((identity) => identity === null)) {
    throw new Error("Unexpected skill access identity")
  }
  return {
    builtInSkillKeys: data.builtInSkillKeys,
    revokedUserIdentities: revokedUserIdentities.filter((identity): identity is string => identity !== null),
  }
}

export function SkillUserAccessPanel({
  organizationId,
  skills,
}: {
  organizationId: number
  skills: readonly AiSkillListItem[]
}) {
  const { t } = useTranslation()
  const session = useErpSession()
  const queryClient = useQueryClient()
  const [skillKey, setSkillKey] = useState("")
  const [userIdentity, setUserIdentity] = useState("")
  const queryKey = ["ai-skill-user-access", organizationId, session.identity] as const
  const canLoad = session.organizationId === organizationId && !!session.identity
  const catalog = useQuery({
    queryKey: [...queryKey, "catalog"],
    queryFn: ({ signal }) => readSkillUserAccess("", signal),
    enabled: canLoad,
    retry: false,
  })
  const skillOptions = (catalog.data?.builtInSkillKeys ?? []).map((key) => ({
    value: key,
    label: skills.find((skill) => skill.skill_key === key)?.name
      ?? key.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
  })).sort((left, right) => left.label.localeCompare(right.label))
  const selectedSkill = skillOptions.some(({ value }) => value === skillKey) ? skillKey : ""
  const people = useAuthorizedPeople(organizationId, !!selectedSkill)
  const skillAccessKey = [...queryKey, "skill", selectedSkill] as const
  const access = useQuery({
    queryKey: skillAccessKey,
    queryFn: ({ signal }) => readSkillUserAccess(selectedSkill, signal),
    enabled: canLoad && !!selectedSkill,
    retry: false,
  })
  const update = useMutation({
    retry: false,
    mutationFn: async ({ skill, user, revoke }: { skill: string; user: string; revoke: boolean }) => {
      const [userIdentity] = await people.validateSelection([user])
      const response = await apiFetch(ACCESS_PATH, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillKey: skill, userIdentity, revoked: revoke }),
      })
      if (!response.ok) throw await httpResponseError(response)
      const receipt: unknown = await response.json()
      if (!receipt || typeof receipt !== "object"
        || !("skillKey" in receipt) || receipt.skillKey !== skill
        || !("userIdentity" in receipt) || personIdentity(receipt.userIdentity) !== userIdentity
        || !("revoked" in receipt) || receipt.revoked !== revoke) {
        throw new Error("Unexpected skill access receipt")
      }
    },
    onSettled: async (_receipt, _error, { skill }) => {
      await queryClient.invalidateQueries({ queryKey: [...queryKey, "skill", skill] })
    },
  })
  const busy = update.isPending
  const peopleOptions = busy && people.status === "loading" ? people.data ?? [] : people.options
  const selectedUser = selectedPerson(userIdentity, peopleOptions)
  const revoked = !!selectedUser && access.data?.revokedUserIdentities.includes(selectedUser) === true
  const accessReady = access.isSuccess && !access.isFetching

  return (
    <section aria-labelledby="ai-skill-user-access-title" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 id="ai-skill-user-access-title" className="text-sm font-semibold">{t("aiSkills.userAccess.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("aiSkills.userAccess.description")}</p>
      </div>
      {catalog.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">{t("aiSkills.userAccess.catalogError")}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void catalog.refetch()}>{t("common.retry")}</Button>
        </div>
      ) : catalog.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">{t("aiSkills.userAccess.loadingSkills")}</p>
      ) : skillOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("aiSkills.userAccess.noSkills")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="ai-user-access-skill">{t("aiSkills.userAccess.skill")}</Label>
            <RecordPicker
              id="ai-user-access-skill"
              value={selectedSkill}
              onChange={(value) => {
                setSkillKey(value)
                update.reset()
              }}
              options={skillOptions}
              placeholder={t("aiSkills.userAccess.chooseSkill")}
              searchPlaceholder={t("aiSkills.userAccess.searchSkills")}
              emptyText={t("aiSkills.userAccess.noSkills")}
              disabled={busy}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="ai-user-access-person">{t("aiSkills.userAccess.person")}</Label>
            <RecordPicker
              id="ai-user-access-person"
              value={selectedUser ?? ""}
              onChange={(value) => {
                setUserIdentity(value)
                update.reset()
              }}
              options={peopleOptions.map((person) => access.data?.revokedUserIdentities.includes(person.value)
                ? { ...person, label: `${person.label} · ${t("aiSkills.userAccess.revokedLabel")}` }
                : person)}
              placeholder={t("aiSkills.userAccess.choosePerson")}
              searchPlaceholder={t("aiSkills.userAccess.searchPeople")}
              emptyText={t("aiSkills.userAccess.noPeople")}
              disabled={!selectedSkill || people.status !== "ready" || busy}
            />
            {!selectedSkill || busy ? null : people.status === "loading" ? (
              <p role="status" className="text-sm text-muted-foreground">{t("peoplePicker.loading", { defaultValue: "Loading authorized people…" })}</p>
            ) : people.status === "denied" ? (
              <p className="text-sm text-muted-foreground">{t("aiSkills.userAccess.peopleDenied")}</p>
            ) : people.status === "error" ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-sm text-destructive">{t("aiSkills.userAccess.peopleError")}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void people.refetch()}>{t("common.retry")}</Button>
              </div>
            ) : people.options.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("aiSkills.userAccess.noPeople")}</p>
            ) : null}
          </div>
        </div>
      )}
      {selectedSkill && selectedUser ? (
        access.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">{t("aiSkills.userAccess.accessError")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void access.refetch()}>{t("common.retry")}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p role="status" className={revoked ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {busy ? t("aiSkills.userAccess.saving")
                : accessReady ? t(revoked ? "aiSkills.userAccess.revoked" : "aiSkills.userAccess.defaultAccess")
                  : t("aiSkills.userAccess.loadingAccess")}
            </p>
            <Button
              type="button"
              size="sm"
              variant={revoked ? "outline" : "destructive"}
              disabled={busy || !accessReady}
              onClick={() => update.mutate({ skill: selectedSkill, user: selectedUser, revoke: !revoked })}
            >
              {t(revoked ? "aiSkills.userAccess.restore" : "aiSkills.userAccess.revoke")}
            </Button>
          </div>
        )
      ) : null}
      {update.isError ? <p role="alert" className="text-sm text-destructive">{t("aiSkills.userAccess.saveError")}</p> : null}
    </section>
  )
}
