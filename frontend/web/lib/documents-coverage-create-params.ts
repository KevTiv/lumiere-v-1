/** Auto-generated Create*Params mappers for documents coverage gap. */

import type {
  CreateDocumentSignatureRequestParams,
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
} from "@lumiere/erp-shared/create-params-helpers"

export function toCreateDocumentSignatureRequestParams(
  formData: Record<string, unknown>,
): CreateDocumentSignatureRequestParams | null {
  const provider = optionalTrimmedString(field(formData, "provider", "provider"))
  if (!provider) return null

  return {
    provider,
    externalEnvelopeId: optionalTrimmedString(field(formData, "externalEnvelopeId", "external_envelope_id")) ?? "",
    signersJson: optionalTrimmedString(field(formData, "signersJson", "signers_json")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

