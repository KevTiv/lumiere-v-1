"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { apiFetch } from "@lumiere/query-hooks/http"
import { Button, Input } from "@lumiere/ui"
import { nativeVersionManifest, nextSkillVersion, type NativeSkillBinding, type NativeSkillBindings } from "./native-skill-validation"

interface Props {
  skillKey: string
  existingVersions: Array<string | undefined>
  pending: boolean
  onCreate: (manifestJson: string, reviewNotes: string, metadata: string) => Promise<void>
}

async function currentBinding(skillKey: string) {
  const response = await apiFetch("/api/ai/skills/certifications?view=native-bindings")
  if (!response.ok) throw new Error("The current harness is unavailable. Try again when it is online.")
  const result = await response.json() as NativeSkillBindings
  const binding = result.bindings.find((item) => item.skillKey === skillKey)
  if (!binding) throw new Error("This skill has no native adapter in the current harness. A registered implementation is required before validation.")
  if (!result.certificationConfigured || !result.runtimeHash) throw new Error("The current harness has no configured certification runtime.")
  return { binding, runtimeHash: result.runtimeHash }
}

export function NativeSkillVersionForm({ skillKey, existingVersions, pending, onCreate }: Props) {
  const { t } = useTranslation()
  const [editedVersion, setEditedVersion] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [prepared, setPrepared] = useState<{
    binding: NativeSkillBinding
    runtimeHash: string
    version: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = editedVersion ?? prepared?.version ?? nextSkillVersion(existingVersions)
  const label = (key: string, defaultValue: string) => t(`aiSkills.registry.validation.${key}`, { defaultValue })

  async function prepare() {
    setLoading(true)
    setError(null)
    setPrepared(null)
    try {
      const current = await currentBinding(skillKey)
      const candidateVersion = editedVersion ?? nextSkillVersion(existingVersions, current.binding.manifest.version)
      nativeVersionManifest(current.binding, candidateVersion)
      setPrepared({ ...current, version: candidateVersion })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function create() {
    if (!prepared) return
    setLoading(true)
    setError(null)
    try {
      const current = await currentBinding(skillKey)
      const manifest = nativeVersionManifest(current.binding, version)
      if (current.runtimeHash !== prepared.runtimeHash || manifest !== nativeVersionManifest(prepared.binding, version)) {
        setPrepared(null)
        throw new Error("The harness changed. Prepare validation again to review its current binding.")
      }
      await onCreate(manifest, note.trim(), JSON.stringify({ binding: "native_adapter", runtime_hash: current.runtimeHash, adapter_major: current.binding.adapterMajor }))
      setPrepared(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <h4 className="text-sm font-medium">{label("title", "Validate a new skill version")}</h4>
      <p className="text-xs text-muted-foreground">
        {label("description", "Attach this skill to the running harness. Skill versions can change independently; fixture certification checks the current adapter before activation.")}
      </p>
      <label className="block space-y-1 text-sm">
        <span>{label("version", "Skill version")}</span>
        <Input
          value={version}
          disabled={loading || pending}
          onChange={(event) => {
            setEditedVersion(event.target.value)
            setPrepared(null)
          }}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{label("note", "Validation note")}</span>
        <Input value={note} maxLength={8000} onChange={(event) => setNote(event.target.value)} />
      </label>
      <Button size="sm" variant="outline" disabled={loading || pending} onClick={() => void prepare()}>
        {label("prepare", "Prepare validation")}
      </Button>
      {prepared ? (
        <div className="space-y-2 rounded border border-border p-3 text-xs" role="status">
          <p>{label("attached", "Attached to current harness")} · {skillKey} · {prepared.binding.manifest.risk}</p>
          <p>{prepared.binding.manifest.resources.join(", ")}</p>
          <details>
            <summary className="cursor-pointer">{label("runtime", "Certification runtime")}</summary>
            <p className="mt-1 break-all">{prepared.runtimeHash}</p>
            <p className="break-all">{prepared.binding.manifest.source_hash}</p>
          </details>
          <Button size="sm" disabled={loading || pending || !note.trim()} onClick={() => void create()}>
            {label("create", "Create version for validation")}
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}
