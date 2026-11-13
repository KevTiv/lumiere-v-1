import assert from "node:assert/strict"
import test from "node:test"
import { nativeVersionManifest, nextSkillVersion, type NativeSkillBinding } from "./native-skill-validation"

const binding: NativeSkillBinding = {
  skillKey: "report_analysis",
  adapterMajor: 1,
  manifest: {
    schema_version: 1,
    skill_key: "report_analysis",
    version: "1.0.0",
    source_hash: `sha256:${"a".repeat(64)}`,
    risk: "green",
    permissions: ["report:read"],
    resources: ["reports.z", "reports.a"],
    output_types: ["analytics.report_analysis.result.v1"],
    limits: { max_steps: 8, max_tool_calls: 12 },
  },
}

test("new skill revisions use the discovered harness without changing its adapter revision", () => {
  const raw = nativeVersionManifest(binding, "1.0.9")
  const manifest = JSON.parse(raw)
  assert.equal(manifest.version, "1.0.9")
  assert.equal(manifest.source_hash, binding.manifest.source_hash)
  assert.equal(manifest.skill_key, binding.skillKey)
  assert.deepEqual(manifest.resources, ["reports.a", "reports.z"])
  assert.equal(raw, JSON.stringify(manifest))
  assert.deepEqual(Object.keys(manifest), [...Object.keys(manifest)].sort())
  assert.deepEqual(Object.keys(manifest.limits), ["max_steps", "max_tool_calls"])
})

test("invalid or incompatible versions and missing executable bindings cannot be prepared", () => {
  for (const version of ["2.0.0", "1", "1.2", "01.0.1", "1.00.2", "1.0.x"]) {
    assert.throws(() => nativeVersionManifest(binding, version))
  }
  for (const source_hash of ["browser-asserted", "a".repeat(63), "A".repeat(64), `SHA256:${"a".repeat(64)}`]) {
    assert.throws(() => nativeVersionManifest({ ...binding, manifest: { ...binding.manifest, source_hash } }, "1.0.9"))
  }
})

test("generation candidates preserve the gateway's bare digest", () => {
  const source_hash = "b".repeat(64)
  const generationBinding: NativeSkillBinding = {
    ...binding,
    skillKey: "rag_generation",
    manifest: { ...binding.manifest, skill_key: "rag_generation", version: "1.0.1", source_hash },
  }

  assert.equal(JSON.parse(nativeVersionManifest(generationBinding, "1.0.1")).source_hash, source_hash)
})

test("the suggested version starts at the discovered revision and advances past registered versions", () => {
  assert.equal(nextSkillVersion(["1.0.7", "1.0.8"]), "1.0.9")
  assert.equal(nextSkillVersion(["1.2.9", "1.10.1", "1.0.20"]), "1.10.2")
  assert.equal(nextSkillVersion([]), "1.0.0")
  assert.equal(nextSkillVersion([], "1.0.1"), "1.0.1")
  assert.equal(nextSkillVersion(["1.0.2"], "1.0.5"), "1.0.5")
  assert.equal(nextSkillVersion(["1.0.5", "2.0.1"], "1.0.5"), "1.0.6")
  assert.equal(nextSkillVersion(["1.9.99"], "1.10.0"), "1.10.0")
  assert.equal(nextSkillVersion(["2.1.5", "1.99.1"], "2.1.4"), "2.1.6")
})
