/** Auto-generated Create*Params mappers for ai coverage gap. */

import type {
  CreateAiSkillCertificationEnvironmentParams,
  CreateAiSkillFixtureParams,
  CreateAiSkillVersionParams,
} from "@lumiere/stdb/types"

import {
  field,
  optionalBigIntU64,
  optionalTrimmedString,
  u64IdArrayFromForm,
  num,
  stringArrayFromForm,
  optionalTimestampFromForm,
  requiredTimestampFromForm,
  optionalIdentityFromForm,
  requiredIdentityFromForm,
  identityArrayFromForm,
  unitEnumFromForm,
  unitEnumArrayFromForm,
  messageChannelArrayFromForm,
  objectArrayFromForm,
  stbTimestampFromDate,
} from "./create-params-helpers"

export function toCreateAiSkillCertificationEnvironmentParams(
  formData: Record<string, unknown>,
): CreateAiSkillCertificationEnvironmentParams | null {
  const fixtureId = optionalBigIntU64(field(formData, "fixtureId", "fixture_id"))
  const environmentKey = optionalTrimmedString(field(formData, "environmentKey", "environment_key"))
  const datasetJson = optionalTrimmedString(field(formData, "datasetJson", "dataset_json"))
  if (fixtureId === undefined || !environmentKey || !datasetJson) return null

  return {
    fixtureId,
    environmentKey,
    datasetJson,
    virtualFilesJson: optionalTrimmedString(field(formData, "virtualFilesJson", "virtual_files_json")) ?? "",
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateAiSkillFixtureParams(
  formData: Record<string, unknown>,
): CreateAiSkillFixtureParams | null {
  const skillId = optionalBigIntU64(field(formData, "skillId", "skill_id"))
  const fixtureKey = optionalTrimmedString(field(formData, "fixtureKey", "fixture_key"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (skillId === undefined || !fixtureKey || !name) return null

  return {
    skillId,
    fixtureKey,
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    inputJson: optionalTrimmedString(field(formData, "inputJson", "input_json")) ?? "",
    expectedOutputJson: optionalTrimmedString(field(formData, "expectedOutputJson", "expected_output_json")) ?? "",
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateAiSkillVersionParams(
  formData: Record<string, unknown>,
): CreateAiSkillVersionParams | null {
  const skillId = optionalBigIntU64(field(formData, "skillId", "skill_id"))
  const manifestJson = optionalTrimmedString(field(formData, "manifestJson", "manifest_json"))
  if (skillId === undefined || !manifestJson) return null

  return {
    skillId,
    manifestJson,
    reviewNotes: optionalTrimmedString(field(formData, "reviewNotes", "review_notes")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

