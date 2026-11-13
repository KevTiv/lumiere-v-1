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
  // Keep the gateway's exact encoding for immutable version and certificate comparisons.
  const sourceHash = binding.manifest.source_hash
  if (typeof sourceHash !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/.test(sourceHash)) {
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

function stableSkillVersion(version: string | undefined) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? "")
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}

export function nextSkillVersion(
  versions: Array<string | undefined>,
  advertisedVersion = "1.0.0",
): string {
  const advertised = stableSkillVersion(advertisedVersion) ?? { major: 1, minor: 0, patch: 0 }
  const stable = versions.flatMap((version) => {
    const parsed = stableSkillVersion(version)
    return parsed && parsed.major === advertised.major ? [parsed] : []
  }).sort((a, b) => b.minor - a.minor || b.patch - a.patch)
  const latest = stable[0]
  if (latest && (
    latest.minor > advertised.minor
    || (latest.minor === advertised.minor && latest.patch >= advertised.patch)
  )) {
    return `${latest.major}.${latest.minor}.${latest.patch + 1}`
  }
  return `${advertised.major}.${advertised.minor}.${advertised.patch}`
}
