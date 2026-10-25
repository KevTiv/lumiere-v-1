/** Display aliases for the CRM tables; values come from their canonical source fields. */
interface LeadListSource {
  name: string
  contactName?: string | null
  companyName?: string | null
  partnerId?: number | string | bigint | null
  email?: string | null
  createdAt?: unknown
}

export function crmLeadListRow<T extends LeadListSource>(row: T, contacts: ReadonlyMap<string, string>) {
  return {
    ...row,
    contactName: row.contactName || row.name,
    partnerName: row.companyName || (row.partnerId == null ? undefined : contacts.get(String(row.partnerId))),
    emailFrom: row.email,
    createDate: row.createdAt,
  }
}

interface ContactListSource {
  name: string
  type?: string
  parentId?: number | string | bigint | null
}

export function crmContactListRow<T extends ContactListSource>(row: T, contacts: ReadonlyMap<string, string>) {
  const isCompany = row.type?.toLowerCase() === "company"
  return {
    ...row,
    isCompany: row.type == null ? undefined : isCompany,
    companyName: isCompany ? row.name : row.parentId == null ? undefined : contacts.get(String(row.parentId)),
  }
}
