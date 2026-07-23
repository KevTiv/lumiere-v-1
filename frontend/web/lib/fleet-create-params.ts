/** Auto-generated Create*Params mappers for fleet coverage gap. */

import type {
  CreateFleetVehicleParams,
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

export function toCreateFleetVehicleParams(
  formData: Record<string, unknown>,
): CreateFleetVehicleParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const vehicleType = optionalTrimmedString(field(formData, "vehicleType", "vehicle_type"))
  if (!name || !vehicleType) return null

  return {
    name,
    vehicleType,
    licensePlate: optionalTrimmedString(field(formData, "licensePlate", "license_plate")),
    driverName: optionalTrimmedString(field(formData, "driverName", "driver_name")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

