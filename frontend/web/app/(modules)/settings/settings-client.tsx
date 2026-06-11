"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { DashboardHeader, FormModal, MissingOrganization, SettingsModule, type FormConfig } from "@lumiere/ui"
import {
  useCreateAuditRule,
  useEndUserSession,
  useRecordPrivacyConsent,
  useUpdateAuditRule,
  useUpdateGoogleDriveCredentials,
  useUpdateUserEmail,
  useUpdateUserPassword,
  useUpdateUserProfile,
  useUpdateWhatsappCredentials,
} from "@lumiere/query-hooks/hooks/auth"
import {
  useCreateCompany,
  useCreateDataClassification,
  useCreateDataClassificationRule,
  useDeleteCompany,
  useUpdateCompany,
  useUpdateCompanyAddress,
  useUpdateCompanyBusiness,
  useUpdateCompanyHierarchy,
} from "@lumiere/query-hooks/hooks/organization-company"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

type SettingsAction =
  | "createAuditRule"
  | "updateAuditRule"
  | "endSession"
  | "updateProfile"
  | "updatePassword"
  | "updateEmail"
  | "recordPrivacyConsent"
  | "googleDriveCredentials"
  | "whatsappCredentials"
  | "createCompany"
  | "updateCompany"
  | "updateCompanyAddress"
  | "updateCompanyBusiness"
  | "updateCompanyHierarchy"
  | "deleteCompany"
  | "createDataClassification"
  | "createDataClassificationRule"

const settingsActionForms: Record<SettingsAction, FormConfig> = {
  createAuditRule: {
    id: "settings-create-audit-rule",
    title: "Create Audit Rule",
    submitLabel: "Create rule",
    sections: [
      {
        id: "rule",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "full" },
          { id: "resource", type: "text", name: "resourceType", label: "Resource type", required: true, width: "1/2" },
          { id: "action", type: "text", name: "actionType", label: "Action type", required: true, width: "1/2" },
          { id: "severity", type: "text", name: "severity", label: "Severity", defaultValue: "info", width: "1/2" },
          { id: "active", type: "switch", name: "isActive", label: "Active", defaultValue: true, width: "1/2" },
        ],
      },
    ],
  },
  updateAuditRule: {
    id: "settings-update-audit-rule",
    title: "Update Audit Rule",
    submitLabel: "Update rule",
    sections: [
      {
        id: "rule",
        fields: [
          { id: "rule-id", type: "number", name: "ruleId", label: "Rule ID", required: true, width: "1/2" },
          { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
          { id: "resource", type: "text", name: "resourceType", label: "Resource type", width: "1/2" },
          { id: "action", type: "text", name: "actionType", label: "Action type", width: "1/2" },
          { id: "severity", type: "text", name: "severity", label: "Severity", width: "1/2" },
          { id: "active", type: "switch", name: "isActive", label: "Active", width: "1/2" },
        ],
      },
    ],
  },
  endSession: {
    id: "settings-end-session",
    title: "End User Session",
    submitLabel: "End session",
    sections: [{ id: "session", fields: [{ id: "session-id", type: "number", name: "sessionId", label: "Session ID", required: true }] }],
  },
  updateProfile: {
    id: "settings-update-profile",
    title: "Update Profile",
    submitLabel: "Update profile",
    sections: [
      {
        id: "profile",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
          { id: "department", type: "text", name: "department", label: "Department", width: "1/2" },
          { id: "timezone", type: "text", name: "timezone", label: "Timezone", width: "1/2" },
          { id: "locale", type: "text", name: "locale", label: "Locale", width: "1/2" },
        ],
      },
    ],
  },
  updatePassword: {
    id: "settings-update-password",
    title: "Update User Password",
    description: "Admin flow expects a target identity and a server-produced password hash.",
    submitLabel: "Update password",
    sections: [
      {
        id: "password",
        fields: [
          { id: "identity", type: "text", name: "targetIdentity", label: "Target identity", required: true, width: "full" },
          { id: "hash", type: "textarea", name: "newPasswordHash", label: "New password hash", required: true, rows: 3, width: "full" },
        ],
      },
    ],
  },
  updateEmail: {
    id: "settings-update-email",
    title: "Update Email",
    submitLabel: "Update email",
    sections: [
      {
        id: "email",
        fields: [
          { id: "email", type: "text", name: "email", label: "Email", required: true, width: "1/2" },
          { id: "verified", type: "switch", name: "emailVerified", label: "Email verified", width: "1/2" },
        ],
      },
    ],
  },
  recordPrivacyConsent: {
    id: "settings-record-privacy-consent",
    title: "Record Privacy Consent",
    submitLabel: "Record consent",
    sections: [
      {
        id: "privacy",
        fields: [
          { id: "contact", type: "number", name: "contactId", label: "Contact ID", required: true, width: "1/2" },
          { id: "type", type: "text", name: "consentType", label: "Consent type", required: true, width: "1/2" },
          { id: "granted", type: "switch", name: "granted", label: "Granted", defaultValue: true, width: "1/2" },
          { id: "ip", type: "text", name: "ipAddress", label: "IP address", width: "1/2" },
          { id: "agent", type: "text", name: "userAgent", label: "User agent", width: "full" },
          { id: "metadata", type: "textarea", name: "metadata", label: "Metadata JSON/string", rows: 3, width: "full" },
        ],
      },
    ],
  },
  googleDriveCredentials: {
    id: "settings-google-drive-credentials",
    title: "Update Google Drive Credentials",
    submitLabel: "Save credentials",
    sections: [
      {
        id: "credentials",
        fields: [
          { id: "user", type: "number", name: "userId", label: "User ID", required: true, width: "full" },
          { id: "json", type: "textarea", name: "credentialsJson", label: "Credentials JSON", required: true, rows: 6, width: "full" },
        ],
      },
    ],
  },
  whatsappCredentials: {
    id: "settings-whatsapp-credentials",
    title: "Update WhatsApp Credentials",
    submitLabel: "Save credentials",
    sections: [
      {
        id: "credentials",
        fields: [
          { id: "user", type: "number", name: "userId", label: "User ID", required: true, width: "full" },
          { id: "json", type: "textarea", name: "credentialsJson", label: "Credentials JSON", required: true, rows: 6, width: "full" },
        ],
      },
    ],
  },
  createCompany: {
    id: "settings-create-company",
    title: "Create Company",
    submitLabel: "Create company",
    sections: [
      {
        id: "company",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "1/2" },
          { id: "code", type: "text", name: "code", label: "Code", required: true, width: "1/2" },
          { id: "currency", type: "number", name: "currencyId", label: "Currency ID", width: "1/2" },
          { id: "country", type: "text", name: "addressCountryCode", label: "Country code", width: "1/2" },
        ],
      },
    ],
  },
  updateCompany: {
    id: "settings-update-company",
    title: "Update Company",
    submitLabel: "Update company",
    sections: [
      {
        id: "company",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/2" },
          { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
          { id: "code", type: "text", name: "code", label: "Code", width: "1/2" },
          { id: "active", type: "switch", name: "isActive", label: "Active", width: "1/2" },
        ],
      },
    ],
  },
  updateCompanyAddress: {
    id: "settings-update-company-address",
    title: "Update Company Address",
    submitLabel: "Update address",
    sections: [
      {
        id: "address",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/2" },
          { id: "street", type: "text", name: "addressStreet", label: "Street", width: "1/2" },
          { id: "city", type: "text", name: "addressCity", label: "City", width: "1/2" },
          { id: "zip", type: "text", name: "addressZip", label: "Zip", width: "1/2" },
          { id: "country", type: "text", name: "addressCountryCode", label: "Country code", width: "1/2" },
        ],
      },
    ],
  },
  updateCompanyBusiness: {
    id: "settings-update-company-business",
    title: "Update Company Business",
    submitLabel: "Update business",
    sections: [
      {
        id: "business",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/2" },
          { id: "tax", type: "text", name: "taxId", label: "Tax ID", width: "1/2" },
          { id: "registry", type: "text", name: "companyRegistry", label: "Company registry", width: "1/2" },
        ],
      },
    ],
  },
  updateCompanyHierarchy: {
    id: "settings-update-company-hierarchy",
    title: "Update Company Hierarchy",
    submitLabel: "Update hierarchy",
    sections: [
      {
        id: "hierarchy",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/3" },
          { id: "parent-id", type: "number", name: "parentId", label: "Parent ID", width: "1/3" },
          { id: "is-parent", type: "switch", name: "isParent", label: "Is parent", width: "1/3" },
        ],
      },
    ],
  },
  deleteCompany: {
    id: "settings-delete-company",
    title: "Delete Company",
    submitLabel: "Delete company",
    sections: [{ id: "company", fields: [{ id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true }] }],
  },
  createDataClassification: {
    id: "settings-create-data-classification",
    title: "Create Data Classification",
    submitLabel: "Create classification",
    sections: [
      {
        id: "classification",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "1/2" },
          { id: "level", type: "number", name: "level", label: "Level", defaultValue: 2, width: "1/2" },
          { id: "description", type: "textarea", name: "description", label: "Description", rows: 3, width: "full" },
          { id: "retention", type: "number", name: "retentionDays", label: "Retention days", width: "1/2" },
          { id: "encrypt", type: "switch", name: "encryptionRequired", label: "Encryption required", width: "1/2" },
        ],
      },
    ],
  },
  createDataClassificationRule: {
    id: "settings-create-data-classification-rule",
    title: "Create Data Classification Rule",
    submitLabel: "Create rule",
    sections: [
      {
        id: "rule",
        fields: [
          { id: "table", type: "text", name: "tableName", label: "Table name", required: true, width: "1/2" },
          { id: "column", type: "text", name: "columnName", label: "Column name", required: true, width: "1/2" },
          { id: "classification", type: "number", name: "classificationId", label: "Classification ID", required: true, width: "1/2" },
          { id: "applies", type: "text", name: "appliesTo", label: "Applies to", defaultValue: "all", width: "1/2" },
        ],
      },
    ],
  },
}

function compactParams(formData: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const key of keys) {
    const value = formData[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params[key] = value
    }
  }
  return params
}

function parseCredentials(value: unknown): Record<string, unknown> {
  const raw = String(value ?? "").trim()
  if (!raw) throw new Error("Credentials JSON is required")
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credentials must be a JSON object")
  }
  return parsed as Record<string, unknown>
}

function toBigIntId(value: unknown, label: string): bigint {
  const raw = String(value ?? "").trim()
  if (!raw) throw new Error(`${label} is required`)
  return BigInt(raw)
}

export function SettingsClient({ organizationId }: { organizationId?: number }) {
  const { t } = useTranslation()
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <SettingsLoaded organizationId={organizationId} title={t("settings.page.title")} description={t("settings.page.description")} />
}

function SettingsLoaded({
  organizationId,
  title,
  description,
}: {
  organizationId: number
  title: string
  description: string
}) {
  const { orgId } = orgBigInts(organizationId)
  const [activeAction, setActiveAction] = useState<SettingsAction | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const createAuditRule = useCreateAuditRule(orgId)
  const updateAuditRule = useUpdateAuditRule(orgId)
  const endSession = useEndUserSession(orgId)
  const updateProfile = useUpdateUserProfile(orgId)
  const updatePassword = useUpdateUserPassword(orgId)
  const updateEmail = useUpdateUserEmail(orgId)
  const recordPrivacyConsent = useRecordPrivacyConsent(orgId)
  const updateGoogleDriveCredentials = useUpdateGoogleDriveCredentials(orgId)
  const updateWhatsappCredentials = useUpdateWhatsappCredentials(orgId)
  const createCompany = useCreateCompany(organizationId)
  const updateCompany = useUpdateCompany()
  const updateCompanyAddress = useUpdateCompanyAddress()
  const updateCompanyBusiness = useUpdateCompanyBusiness()
  const updateCompanyHierarchy = useUpdateCompanyHierarchy()
  const deleteCompany = useDeleteCompany()
  const createDataClassification = useCreateDataClassification(organizationId)
  const createDataClassificationRule = useCreateDataClassificationRule(organizationId)

  const isPending =
    createAuditRule.isPending ||
    updateAuditRule.isPending ||
    endSession.isPending ||
    updateProfile.isPending ||
    updatePassword.isPending ||
    updateEmail.isPending ||
    recordPrivacyConsent.isPending ||
    updateGoogleDriveCredentials.isPending ||
    updateWhatsappCredentials.isPending ||
    createCompany.isPending ||
    updateCompany.isPending ||
    updateCompanyAddress.isPending ||
    updateCompanyBusiness.isPending ||
    updateCompanyHierarchy.isPending ||
    deleteCompany.isPending ||
    createDataClassification.isPending ||
    createDataClassificationRule.isPending

  const handleSubmit = async (formData: Record<string, unknown>) => {
    if (!activeAction) return
    setSubmitError(null)
    setSuccessMessage(null)
    try {
      const submittedAction = activeAction
      if (activeAction === "createAuditRule") {
        await createAuditRule.mutateAsync(formData)
      } else if (activeAction === "updateAuditRule") {
        await updateAuditRule.mutateAsync({
          ruleId: formData.ruleId as string | number,
          params: compactParams(formData, ["name", "resourceType", "actionType", "severity", "isActive"]),
        })
      } else if (activeAction === "endSession") {
        await endSession.mutateAsync(formData.sessionId as string | number)
      } else if (activeAction === "updateProfile") {
        await updateProfile.mutateAsync(compactParams(formData, ["name", "department", "timezone", "locale"]))
      } else if (activeAction === "updatePassword") {
        await updatePassword.mutateAsync({
          targetIdentity: String(formData.targetIdentity ?? ""),
          newPasswordHash: String(formData.newPasswordHash ?? ""),
        })
      } else if (activeAction === "updateEmail") {
        await updateEmail.mutateAsync({
          email: String(formData.email ?? ""),
          emailVerified: Boolean(formData.emailVerified),
        })
      } else if (activeAction === "recordPrivacyConsent") {
        await recordPrivacyConsent.mutateAsync({
          contactId: formData.contactId as string | number,
          consentType: String(formData.consentType ?? ""),
          granted: Boolean(formData.granted),
          ipAddress: formData.ipAddress ? String(formData.ipAddress) : null,
          userAgent: formData.userAgent ? String(formData.userAgent) : null,
          metadata: formData.metadata ? String(formData.metadata) : null,
        })
      } else if (activeAction === "googleDriveCredentials") {
        await updateGoogleDriveCredentials.mutateAsync({
          userId: formData.userId as string | number,
          credentials: parseCredentials(formData.credentialsJson),
        })
      } else if (activeAction === "whatsappCredentials") {
        await updateWhatsappCredentials.mutateAsync({
          userId: formData.userId as string | number,
          credentials: parseCredentials(formData.credentialsJson),
        })
      } else if (activeAction === "createCompany") {
        await createCompany.mutateAsync(compactParams(formData, ["name", "code", "currencyId", "addressCountryCode"]))
      } else if (activeAction === "updateCompany") {
        await updateCompany.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: compactParams(formData, ["name", "code", "isActive"]),
        })
      } else if (activeAction === "updateCompanyAddress") {
        await updateCompanyAddress.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: compactParams(formData, ["addressStreet", "addressCity", "addressZip", "addressCountryCode"]),
        })
      } else if (activeAction === "updateCompanyBusiness") {
        await updateCompanyBusiness.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: compactParams(formData, ["taxId", "companyRegistry"]),
        })
      } else if (activeAction === "updateCompanyHierarchy") {
        const parentRaw = String(formData.parentId ?? "").trim()
        await updateCompanyHierarchy.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: {
            ...compactParams(formData, ["isParent"]),
            parentId: parentRaw !== "" ? BigInt(parentRaw) : null,
          },
        })
      } else if (activeAction === "deleteCompany") {
        if (!confirm("Delete this company?")) return
        await deleteCompany.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
        })
      } else if (activeAction === "createDataClassification") {
        await createDataClassification.mutateAsync(compactParams(formData, ["name", "level", "description", "retentionDays", "encryptionRequired"]))
      } else if (activeAction === "createDataClassificationRule") {
        await createDataClassificationRule.mutateAsync(compactParams(formData, ["tableName", "columnName", "classificationId", "appliesTo"]))
      }
      const completed = actions.find((action) => action.id === submittedAction)
      setSuccessMessage(`${completed?.title ?? "Settings action"} completed.`)
      setActiveAction(null)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    }
  }

  const actions: Array<{ id: SettingsAction; title: string; description: string }> = [
    { id: "createAuditRule", title: "Create audit rule", description: "Add a new audit rule for monitored resources." },
    { id: "updateAuditRule", title: "Update audit rule", description: "Patch an existing audit rule by ID." },
    { id: "endSession", title: "End session", description: "Terminate a user session by session ID." },
    { id: "updateProfile", title: "Profile", description: "Update profile fields for the current identity." },
    { id: "updatePassword", title: "Password", description: "Admin password hash update flow." },
    { id: "updateEmail", title: "Email", description: "Update email and verification state." },
    { id: "recordPrivacyConsent", title: "Privacy consent", description: "Record a contact consent decision." },
    { id: "googleDriveCredentials", title: "Google Drive", description: "Update integration credentials." },
    { id: "whatsappCredentials", title: "WhatsApp", description: "Update integration credentials." },
    { id: "createCompany", title: "Create company", description: "Create a company record in the organization." },
    { id: "updateCompany", title: "Update company", description: "Patch core company fields." },
    { id: "updateCompanyAddress", title: "Company address", description: "Update company address fields." },
    { id: "updateCompanyBusiness", title: "Company business", description: "Update tax and registry fields." },
    { id: "updateCompanyHierarchy", title: "Company hierarchy", description: "Update parent/company hierarchy settings." },
    { id: "deleteCompany", title: "Delete company", description: "Delete a company by ID." },
    { id: "createDataClassification", title: "Data classification", description: "Create a data privacy classification." },
    { id: "createDataClassificationRule", title: "Classification rule", description: "Map a classification to a table column." },
  ]

  return (
    <div className="space-y-6">
      <DashboardHeader title={title} description={description} />
      <SettingsModule />

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Admin action coverage</h2>
          <p className="text-sm text-muted-foreground">
            Direct form-builder surfaces for settings reducers that are not yet embedded in the settings subsections.
          </p>
        </div>
        {successMessage ? (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {successMessage}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50"
              onClick={() => {
                setSubmitError(null)
                setSuccessMessage(null)
                setActiveAction(action.id)
              }}
            >
              <p className="text-sm font-medium">{action.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
            </button>
          ))}
        </div>
      </section>

      {activeAction ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setActiveAction(null)
              setSubmitError(null)
            }
          }}
          config={settingsActionForms[activeAction]}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  )
}
