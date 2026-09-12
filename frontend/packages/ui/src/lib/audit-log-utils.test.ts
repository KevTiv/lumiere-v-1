import { describe, expect, it } from "vitest"

import {
  auditActionFromRow,
  auditRecordIdFromRow,
  auditTableNameFromRow,
  auditTimestampToIso,
  formatAuditEntryDetails,
} from "./audit-log-utils"

describe("audit log consumer adapters", () => {
  it("decodes SDK timestamps and preserves the first non-null alias", () => {
    expect(auditTimestampToIso({ micros_since_unix_epoch: 1_725_494_400_000_000n })).toBe(
      "2024-09-05T00:00:00.000Z",
    )
    expect(formatAuditEntryDetails({ changedFields: null, changed_fields: ["name"] })).toBe("name")
    expect(auditRecordIdFromRow({ recordId: null, record_id: 42n })).toBe("42")
    expect(auditTableNameFromRow({ tableName: null, table_name: "contacts" })).toBe("contacts")
    expect(auditActionFromRow({ action: "update" })).toBe("update")
  })

  it("keeps invalid and absent timestamps on the audit epoch fallback", () => {
    expect(auditTimestampToIso(null)).toBe("1970-01-01T00:00:00.000Z")
    expect(auditTimestampToIso(new Date("invalid"))).toBe("1970-01-01T00:00:00.000Z")
    expect(auditTimestampToIso(new Date(1_725_494_400_000))).toBe("1970-01-20T23:18:14.400Z")
  })
})
