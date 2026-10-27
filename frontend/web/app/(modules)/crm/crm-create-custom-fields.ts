import { customFieldEntriesFromMetadata } from "../../../lib/persist-record-custom-fields"

/** Native creates store metadata but do not commit EAV values or expose a retry-safe record identity. */
export function assertCrmCreateCustomFieldsSupported(metadata: unknown, message: string): void {
  if (customFieldEntriesFromMetadata(metadata).length > 0) throw new Error(message)
}
