export type NativeSkillBinding = {
  skillKey: string
  adapterMajor: number
  manifest: {
    schema_version: number
    skill_key: string
    version: string
    source_hash: string
    risk: string
    permissions: string[]
    resources: string[]
    output_types: string[]
    limits: { max_steps: number; max_tool_calls: number }
  }
}

export type NativeSkillBindings = {
  bindings: NativeSkillBinding[]
  runtimeHash: string | null
  certificationConfigured: boolean
}

/** Canonical module JSON sorts every object; policy lists must be sorted too. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

export function nativeVersionManifest(binding: NativeSkillBinding, version: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)
    || Number(version.split(".")[0]) !== binding.adapterMajor) {
    throw new Error(`Use a semantic skill version compatible with adapter ${binding.adapterMajor}.x`)
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(binding.manifest.source_hash)) {
    throw new Error("The current harness did not provide a valid source binding")
  }
  return JSON.stringify(canonical({
    ...binding.manifest,
    skill_key: binding.skillKey,
    version,
    permissions: [...binding.manifest.permissions].sort(),
    resources: [...binding.manifest.resources].sort(),
    output_types: [...binding.manifest.output_types].sort(),
  }))
}

export function nextSkillVersion(versions: Array<string | undefined>): string {
  const stable = versions.flatMap((version) => {
    const match = /^(1)\.(\d+)\.(\d+)$/.exec(version ?? "")
    return match ? [[Number(match[1]), Number(match[2]), Number(match[3])]] : []
  }).sort((a, b) => b[1]! - a[1]! || b[2]! - a[2]!)
  const latest = stable[0]
  return latest ? `${latest[0]}.${latest[1]}.${latest[2]! + 1}` : "1.0.0"
}
