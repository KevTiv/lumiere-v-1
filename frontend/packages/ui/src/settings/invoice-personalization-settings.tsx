"use client"

import { useTranslation, i18n } from "@lumiere/i18n"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  INVOICE_PROFILE_FIELDS, INVOICE_PROFILE_LIMITS, INVOICE_LOGO_MAX_BYTES, inspectInvoiceLogo, invoiceSellerFromCompany,
  isManagedInvoiceLogoUrl, resolveInvoiceProfile, validateInvoiceProfileValues,
  type InvoiceDocumentSnapshot, type InvoiceProfileField, type InvoiceProfileValues,
  type InvoiceProfileVersion, type InvoicePersonalizationProfile,
} from "@lumiere/erp-shared/invoice-personalization"
import {
  checkInvoiceProfileSubmission, useInvoicePersonalization, useSaveInvoicePersonalizationVersion,
  type InvoicePersonalizationState, type InvoiceProfileSaveInput, type InvoiceProfileSaveOutcome, type InvoiceProfileSubmission,
} from "@lumiere/query-hooks/hooks/invoice-personalization"
import { Button } from "../components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Input } from "../components/input"
import { Label } from "../components/label"
import { Textarea } from "../components/textarea"
import { InvoiceDocument } from "../accounting-components/invoice-document"
import { useConfirmDialog } from "../hooks/use-confirm-dialog"
import { useRBAC } from "../lib/rbac-context"
import { workspaceStyles } from "../lib/workspace-styles"
import { cn } from "../lib/utils"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"

export type UploadInvoiceLogo = (file: File, companyId: string | null) => Promise<string>
type Company = Parameters<typeof invoiceSellerFromCompany>[0]
type Scope = { organizationId: number; companyId: string | null; companyName?: string }
const scopeKey = (scope: Pick<Scope, "organizationId" | "companyId">) => `${scope.organizationId}:${scope.companyId ?? "organization"}`
const equal = (left: InvoiceProfileValues, right: InvoiceProfileValues) => JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort())
const LABELS: Record<InvoiceProfileField, string> = { logoUrl: "Logo", accent: "Accent", email: "Email", phone: "Phone", website: "Website", notice: "Notice", terms: "Terms", paymentInstructions: "Payment instructions", footer: "Footer" }
const MULTILINE = new Set<InvoiceProfileField>(["notice", "terms", "paymentInstructions", "footer"])
const controlClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
const actionClass = "h-auto min-h-11 max-w-full whitespace-normal px-3 py-2"

/** Validate bytes and actual decoded raster dimensions before invoking managed storage. */
export async function validateInvoiceLogoFile(file: File): Promise<void> {
  if (file.size <= 0 || file.size > INVOICE_LOGO_MAX_BYTES) throw new Error(i18n.t("accounting.invoicePersonalizationSettings.logoMustBeANonEmptyPNGOrJPEGNoLarger", { defaultValue: "Logo must be a non-empty PNG or JPEG no larger than 2 MiB" }))
  const size = inspectInvoiceLogo(new Uint8Array(await file.arrayBuffer()), file.type)
  if (typeof createImageBitmap === "function") {
    const decoded = await createImageBitmap(file)
    try { if (decoded.width !== size.width || decoded.height !== size.height) throw new Error(i18n.t("accounting.invoicePersonalizationSettings.logoDimensionsDoNotMatchItsRasterContent", { defaultValue: "Logo dimensions do not match its raster content" })) }
    finally { decoded.close() }
    return
  }
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => image.naturalWidth === size.width && image.naturalHeight === size.height ? resolve() : reject(new Error(i18n.t("accounting.invoicePersonalizationSettings.logoDimensionsDoNotMatchItsRasterContent", { defaultValue: "Logo dimensions do not match its raster content" })))
      image.onerror = () => reject(new Error(i18n.t("accounting.invoicePersonalizationSettings.logoCouldNotBeDecodedAsAPNGOrJPEG", { defaultValue: "Logo could not be decoded as a PNG or JPEG image" })))
      image.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}

export interface InvoicePersonalizationEditorProps {
  organizationId: number
  companyId: string | null
  companyName?: string
  company?: Company
  state: InvoicePersonalizationState
  profile: InvoicePersonalizationProfile | null
  organizationVersion: InvoiceProfileVersion | null
  companyVersion: InvoiceProfileVersion | null
  canPublishOrganization: boolean
  canPublishCompany: boolean
  onSave: (input: InvoiceProfileSaveInput) => Promise<InvoiceProfileSaveOutcome>
  onCheck: (submission: InvoiceProfileSubmission) => Promise<InvoiceProfileSaveOutcome>
  onReload?: () => void
  uploadInvoiceLogo?: UploadInvoiceLogo
}

/** Controlled data boundary for the connected settings panel and synthetic browser fixtures. */
export function InvoicePersonalizationEditor(props: InvoicePersonalizationEditorProps) {
  const { t } = useTranslation()
  const { organizationId, companyId, companyName, company, state, organizationVersion, companyVersion, canPublishOrganization, canPublishCompany, onSave, onCheck, onReload, uploadInvoiceLogo } = props
  const formId = useId()
  const [mode, setMode] = useState<"company" | "organization">(companyId ? "company" : "organization")
  const desired: Scope = { organizationId, companyId: mode === "company" ? companyId : null, companyName: mode === "company" ? companyName : undefined }
  const desiredKey = scopeKey(desired)
  const [boundScope, setBoundScope] = useState(desired)
  const [values, setValues] = useState<InvoiceProfileValues>({})
  const [baseline, setBaseline] = useState<InvoiceProfileValues>({})
  const [baselineVersionId, setBaselineVersionId] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [pending, setPending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uncertain, setUncertain] = useState<InvoiceProfileSubmission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  const desiredRef = useRef(desiredKey)
  desiredRef.current = desiredKey
  const busyRef = useRef(false)
  const publishedRef = useRef<{ scope: string; id: string } | null>(null)
  const dirty = !equal(values, baseline)
  const boundScopeName = boundScope.companyId === null ? t("accounting.invoicePersonalizationSettings.organizationDefaults", { defaultValue: "Organization defaults" }) : boundScope.companyName || t("accounting.invoicePersonalizationSettings.boundCompany", { defaultValue: "Company #{{id}}", id: boundScope.companyId })
  const scopeChanged = scopeKey(boundScope) !== desiredKey
  const busy = pending || uploading
  busyRef.current = busy
  const currentVersion = mode === "organization" ? organizationVersion : companyVersion
  const serverVersionId = currentVersion?.id ?? null
  const newerVersion = initialized && !scopeChanged && state.status === "ready" && serverVersionId !== baselineVersionId
    && !(publishedRef.current?.scope === desiredKey && (serverVersionId === null || BigInt(serverVersionId) < BigInt(publishedRef.current.id)))
  const allowed = boundScope.companyId === null ? canPublishOrganization : canPublishCompany
  const editable = state.status === "ready" && !scopeChanged && allowed && !busy && !uncertain
  const sourceAvailableRef = useRef(false)
  sourceAvailableRef.current = state.status === "ready" && !scopeChanged && allowed
  const validation = validateInvoiceProfileValues(values, boundScope.organizationId)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const navigationDialog = useUnsavedChangesGuard(dirty || uncertain !== null, busy)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const adopt = (scope: Scope, version: InvoiceProfileVersion | null) => {
    setBoundScope(scope); setValues({ ...version?.values }); setBaseline({ ...version?.values })
    setBaselineVersionId(version?.id ?? null); setInitialized(state.status === "ready")
    setError(null); setMessage(null)
  }
  useEffect(() => {
    if (state.status !== "ready" || busy || uncertain || dirty) return
    if (publishedRef.current?.scope === desiredKey && !scopeChanged && (serverVersionId === null || BigInt(serverVersionId) < BigInt(publishedRef.current.id))) return
    if (!initialized || scopeChanged || serverVersionId !== baselineVersionId) adopt(desired, currentVersion)
  }, [state.status, desiredKey, serverVersionId, busy, uncertain, dirty, initialized, baselineVersionId])

  const confirmDiscard = () => confirm({ title: t("accounting.invoicePersonalizationSettings.discardInvoiceSettingsEdits", { defaultValue: "Discard invoice settings edits?" }), description: t("accounting.invoicePersonalizationSettings.yourUnpublishedChangesWillBeLost", { defaultValue: "Your unpublished changes will be lost." }), confirmLabel: t("accounting.invoicePersonalizationSettings.discardEdits", { defaultValue: "Discard edits" }), cancelLabel: t("common.discardChanges.keep", { defaultValue: "Keep editing" }) })
  const changeMode = async (next: "company" | "organization") => {
    if (busyRef.current || uncertain || (dirty && !await confirmDiscard())) return
    if (!mounted.current || busyRef.current) return
    setMode(next)
    adopt({ organizationId, companyId: next === "company" ? companyId : null, companyName: next === "company" ? companyName : undefined }, next === "company" ? companyVersion : organizationVersion)
  }
  const update = (key: InvoiceProfileField, text: string) => {
    if (!editable) return
    setValues((previous) => ({ ...previous, [key]: text })); setError(null); setMessage(null)
  }
  const inherited = mode === "organization" ? resolveInvoiceProfile() : resolveInvoiceProfile(organizationVersion?.values)
  const profile = useMemo(() => mode === "organization" ? resolveInvoiceProfile(values) : resolveInvoiceProfile(organizationVersion?.values, values), [mode, organizationVersion, values])
  const preview: InvoiceDocumentSnapshot = {
    schemaVersion: 1, profileVersionIds: { organization: mode === "organization" ? baselineVersionId : organizationVersion?.id ?? null, company: mode === "company" ? baselineVersionId : null },
    seller: invoiceSellerFromCompany(company ?? { name: companyName ?? "" }, profile), profile, notes: "",
  }
  const applyOutcome = (outcome: InvoiceProfileSaveOutcome) => {
    if (!mounted.current) return
    if (outcome.status === "unconfirmed") { setUncertain(outcome.submission); setError(outcome.message); return }
    setUncertain(null); setBaseline(outcome.version.values); setValues(outcome.version.values); setBaselineVersionId(outcome.version.id)
    publishedRef.current = { scope: scopeKey({ organizationId: Number(outcome.submission.organizationId), companyId: outcome.submission.companyId }), id: outcome.version.id }
    setMessage(outcome.isCurrent ? t("accounting.invoicePersonalizationSettings.publishedVersionValueForValue", { defaultValue: "Published version #{{value1}} for {{value2}}.", value1: outcome.version.id, value2: boundScopeName }) : t("accounting.invoicePersonalizationSettings.versionValueIsSavedButANewerPublicationIsNow", { defaultValue: "Version #{{value1}} is saved, but a newer publication is now current. Reload the latest settings.", value1: outcome.version.id }))
    setError(null); onReload?.()
  }
  const save = async (nextValues = values) => {
    if (!editable || !sourceAvailableRef.current || busyRef.current || !initialized || newerVersion || desiredRef.current !== scopeKey(boundScope)) return
    const checked = validateInvoiceProfileValues(nextValues, organizationId)
    if (checked.status !== "valid") { setError(checked.status === "invalid" ? checked.error : t("accounting.invoicePersonalizationSettings.invoiceSettingsAreUnavailable", { defaultValue: "Invoice settings are unavailable" })); return }
    busyRef.current = true; setPending(true); setError(null); setMessage(null)
    try { applyOutcome(await onSave({ organizationId: boundScope.organizationId, companyId: boundScope.companyId, expectedVersionId: baselineVersionId, values: checked.value })) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (mounted.current) { setPending(false); busyRef.current = false } }
  }
  const check = async () => {
    if (!uncertain || busyRef.current || String(organizationId) !== String(uncertain.organizationId)) return
    busyRef.current = true; setPending(true)
    try { applyOutcome(await onCheck(uncertain)) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (mounted.current) { setPending(false); busyRef.current = false } }
  }
  const upload = async (file: File | undefined) => {
    if (!file || !editable || busyRef.current || !uploadInvoiceLogo) return
    const requestedScope = desiredKey
    busyRef.current = true; setUploading(true); setError(null)
    try {
      await validateInvoiceLogoFile(file)
      if (!mounted.current || desiredRef.current !== requestedScope || !sourceAvailableRef.current) throw new Error(t("accounting.invoicePersonalizationSettings.theCompanyOrAccessChangedBeforeTheLogoUploadSelect", { defaultValue: "The company or access changed before the logo upload. Select the image again in the correct company." }))
      const url = await uploadInvoiceLogo(file, boundScope.companyId)
      if (!isManagedInvoiceLogoUrl(url, boundScope.organizationId)) throw new Error(t("accounting.invoicePersonalizationSettings.uploadedLogoDidNotReturnAManagedImageFromThis", { defaultValue: "Uploaded logo did not return a managed image from this organization" }))
      if (mounted.current && desiredRef.current === requestedScope && sourceAvailableRef.current) setValues((previous) => ({ ...previous, logoUrl: url }))
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (mounted.current) { setUploading(false); busyRef.current = false } }
  }

  return <Card className={cn(workspaceStyles.surface, "min-w-0")} data-testid="invoice-profile-settings">
    <CardHeader><CardTitle className={workspaceStyles.sectionTitle}>{t("accounting.invoicePersonalizationSettings.invoiceAppearanceAndContent", { defaultValue: "Invoice appearance and content" })}</CardTitle><CardDescription className={workspaceStyles.sectionDescription}>{t("accounting.invoicePersonalizationSettings.publishOrganizationDefaultsOrOverridesForOneCompanyOmittedFields", { defaultValue: "Publish organization defaults or overrides for one company. Omitted fields inherit; an empty customized field clears its content. Issued invoices keep their frozen document." })}</CardDescription></CardHeader>
    <CardContent className="min-w-0 space-y-5">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="min-w-0 space-y-2"><Label htmlFor={`${formId}-scope`}>{t("accounting.invoicePersonalizationSettings.settingsScope", { defaultValue: "Settings scope" })}</Label><Select
        value={String(mode ?? "")}
        onValueChange={(nextValue) => void changeMode(nextValue as "company" | "organization")}
        disabled={busy || uncertain !== null}
      >
        {" "}
        <SelectTrigger id={`${formId}-scope`} className={controlClass}>
          <SelectValue />
        </SelectTrigger>{" "}
        <SelectContent>
          <SelectItem value={"organization"}>{t("accounting.invoicePersonalizationSettings.organizationDefaults", { defaultValue: "Organization defaults" })}</SelectItem>
          {companyId ? (
            <SelectItem value={"company"}>{companyName || t("accounting.invoicePersonalizationSettings.companyValue", { defaultValue: "Company #{{companyId}}", companyId: companyId })}</SelectItem>
          ) : null}
        </SelectContent>{" "}
      </Select></div><div className="self-end text-xs text-muted-foreground"><p>{t("accounting.invoicePersonalizationSettings.copy.editingValue", { defaultValue: "Editing: {{boundScopeName}}", boundScopeName: boundScopeName })}</p><p>{t("accounting.invoicePersonalizationSettings.copy.currentVersionValue", { defaultValue: "Current version: {{value1}}", value1: baselineVersionId ? t("accounting.invoicePersonalizationSettings.value", { defaultValue: "#{{baselineVersionId}}", baselineVersionId: baselineVersionId }) : t("accounting.invoicePersonalizationSettings.noPublishedVersion", { defaultValue: "No published version" }) })}</p></div></div>
      <ModuleDataNotice state={state} />
      {state.status === "loading" ? <p role="status">{t("accounting.invoicePersonalizationSettings.loadingInvoiceSettings", { defaultValue: "Loading invoice settings…" })}</p> : null}
      {scopeChanged ? <div role="alert" className="space-y-3 rounded-lg border p-4"><p>{t("accounting.invoicePersonalizationSettings.copy.theSelectedCompanyChangedUnpublishedEditsAndAny", { defaultValue: "The selected company changed. Unpublished edits and any pending result still belong to {{boundScopeName}}.", boundScopeName: boundScopeName })}</p><Button className={actionClass} variant="outline" disabled={busy || uncertain !== null} onClick={async () => { if (!dirty || await confirmDiscard()) adopt(desired, currentVersion) }}>{t("accounting.invoicePersonalizationSettings.discardEditsAndUseSelectedCompany", { defaultValue: "Discard edits and use selected company" })}</Button></div> : null}
      {!allowed ? <p role="status" className="text-sm text-muted-foreground">{t("accounting.invoicePersonalizationSettings.copy.publishingRequiresDocumentTemplateCreationAndWriteAccess", { defaultValue: "Publishing requires document template creation and write access to this {{value1}}.", value1: boundScope.companyId === null ? t("accounting.invoicePersonalizationSettings.organization", { defaultValue: "organization" }) : t("accounting.invoicePersonalizationSettings.company", { defaultValue: "company" }) })}</p> : null}
      {newerVersion && dirty ? <div role="alert" className="space-y-3 rounded-lg border p-4"><p>{t("accounting.invoicePersonalizationSettings.aNewerVersionWasPublishedWhileYouWereEditingYour", { defaultValue: "A newer version was published while you were editing. Your edits are retained. Reload the current version before publishing." })}</p><Button className={actionClass} variant="outline" disabled={busy || uncertain !== null} onClick={async () => { if (await confirmDiscard()) adopt(desired, currentVersion) }}>{t("accounting.invoicePersonalizationSettings.reloadLatestVersion", { defaultValue: "Reload latest version" })}</Button></div> : null}
      {state.status === "ready" && !scopeChanged ? <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={!editable} className={workspaceStyles.formSection}>
          {INVOICE_PROFILE_FIELDS.map((key) => {
            const overridden = Object.prototype.hasOwnProperty.call(values, key)
            const value = values[key] ?? inherited[key]
            const id = `${formId}-${key}`
            return <section key={key} className="min-w-0 space-y-2 border-b pb-4">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><Label htmlFor={id}>{t(`accounting.invoiceContent.${key}`, { defaultValue: LABELS[key] })}</Label><Select
                disabled={!editable}
                value={overridden ? "custom" : "inherit"}
                onValueChange={(nextValue) => {
                  if (!editable) return
                  setValues((previous) => {
                    const next = { ...previous }
                    if (nextValue === "inherit") delete next[key]
                    else Object.assign(next, { [key]: value })
                    return next
                  })
                  setMessage(null)
                }}
              >
                <SelectTrigger
                  className="min-h-11 max-w-full rounded-md border border-input bg-background px-2 text-xs"
                  aria-label={t("accounting.invoicePersonalizationSettings.valueSource", { defaultValue: "{{value1}} source", value1: t(`accounting.invoiceContent.${key}`, { defaultValue: LABELS[key] }) })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={"inherit"}>
                    {mode === "organization" ? t("accounting.invoicePersonalizationSettings.useSystemDefault", { defaultValue: "Use system default" }) : t("accounting.invoicePersonalizationSettings.inheritOrganizationDefault", { defaultValue: "Inherit organization default" })}
                  </SelectItem>
                  <SelectItem value={"custom"}>{t("accounting.invoicePersonalizationSettings.customize", { defaultValue: "Customize" })}</SelectItem>
                </SelectContent>
              </Select></div>
              {key === "logoUrl" ? <div className="space-y-2"><Input id={id} data-testid="invoice-profile-logoUrl" className={controlClass} type="file" accept="image/png,image/jpeg" disabled={!editable || !uploadInvoiceLogo} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = "" }} /><p className="text-xs text-muted-foreground">{t("accounting.invoicePersonalizationSettings.copy.pNGOrJPEGUpTo2MiB4096", { defaultValue: "PNG or JPEG, up to 2 MiB, 4096 pixels per side and 4 million pixels. {{value1}}", value1: uploadInvoiceLogo ? t("accounting.invoicePersonalizationSettings.imagesUseManagedOrganizationStorage", { defaultValue: "Images use managed organization storage." }) : t("accounting.invoicePersonalizationSettings.logoUploadsAreUnavailableInThisSettingsHost", { defaultValue: "Logo uploads are unavailable in this settings host." }) })}</p>{overridden ? <Button type="button" variant="outline" className={actionClass} onClick={() => update("logoUrl", "")}>{t("accounting.invoicePersonalizationSettings.clearLogo", { defaultValue: "Clear logo" })}</Button> : null}</div>
                : key === "accent" ? <Select
                  value={String(value ?? "") || "__none__"}
                  onValueChange={(selectValue) => {
                    const nextValue = selectValue === "__none__" ? "" : selectValue
                    update(key, nextValue)
                  }}
                  disabled={!editable || !overridden}
                >
                  {" "}
                  <SelectTrigger id={id} data-testid={`invoice-profile-${key}`} className={controlClass}>
                    <SelectValue />
                  </SelectTrigger>{" "}
                  <SelectContent>
                    <SelectItem value={"__none__"}>{t("accounting.invoicePersonalizationSettings.noAccentNeutral", { defaultValue: "No accent (neutral)" })}</SelectItem>
                    {["teal", "blue", "slate", "violet"].map((accent) => (
                      <SelectItem key={accent} value={String(accent)}>
                        {t(`accounting.invoicePersonalizationSettings.colors.${accent}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>{" "}
                </Select>
                : MULTILINE.has(key) ? <Textarea id={id} data-testid={`invoice-profile-${key}`} rows={key === "terms" ? 4 : 3} className="min-w-0" disabled={!editable || !overridden} value={value} onChange={(event) => update(key, event.target.value)} />
                : <Input id={id} data-testid={`invoice-profile-${key}`} className={controlClass} disabled={!editable || !overridden} value={value} onChange={(event) => update(key, event.target.value)} />}
              <p className="text-xs text-muted-foreground">{overridden ? value === "" ? t("accounting.invoicePersonalizationSettings.explicitlyClearedForThisScope", { defaultValue: "Explicitly cleared for this scope." }) : t("accounting.invoicePersonalizationSettings.customizedForThisScope", { defaultValue: "Customized for this scope." }) : t("accounting.invoicePersonalizationSettings.inheritedNoOverrideWillBeStored", { defaultValue: "Inherited; no override will be stored." })} {key !== "logoUrl" ? t("accounting.invoicePersonalizationSettings.valueValueUTF8Bytes", { defaultValue: "{{value1}}/{{value2}} UTF-8 bytes", value1: new TextEncoder().encode(value).length, value2: INVOICE_PROFILE_LIMITS[key] }) : null}</p>
            </section>
          })}
        </fieldset>
        <aside className="min-w-0 space-y-3"><h3 className={workspaceStyles.sectionTitle}>{t("accounting.invoicePersonalizationSettings.liveDocumentPreview", { defaultValue: "Live document preview" })}</h3><p className={workspaceStyles.sectionDescription}>{t("accounting.invoicePersonalizationSettings.sampleAmountsIllustrateLayoutOnlySellerIdentityComesFromThe", { defaultValue: "Sample amounts illustrate layout only. Seller identity comes from the selected company." })}</p><InvoiceDocument title={t("accounting.manualInvoice.invoiceTitle", { defaultValue: "Invoice" })} reference="PREVIEW" partnerLabel={t("accounting.createInvoiceModal.billTo", { defaultValue: "Bill to" })} partner={t("accounting.invoicePersonalizationSettings.sampleCustomer", { defaultValue: "Sample customer" })} currency={{ code: "EUR" }} lines={[{ id: "preview", description: t("accounting.invoicePersonalizationSettings.sampleService", { defaultValue: "Sample service" }), quantity: 1, unitPrice: 100, discount: 0, amount: 100 }]} subtotal={100} tax={0} total={100} personalization={preview} draft /></aside>
      </div> : null}
      {validation.status === "invalid" && !scopeChanged && state.status === "ready" ? <p role="alert" className="text-sm text-destructive">{validation.error}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {uncertain ? <div className="space-y-3 rounded-lg border p-4"><p className="break-words text-sm">{t("accounting.invoicePersonalizationSettings.copy.publicationResultUnconfirmedValueCheckThisExactVersion", { defaultValue: "Publication result unconfirmed: {{name}}. Check this exact version before making another save.", name: uncertain.name })}</p><Button className={actionClass} disabled={busy || String(organizationId) !== String(uncertain.organizationId)} onClick={() => void check()}>{t("accounting.invoicePersonalizationSettings.checkSavedVersion", { defaultValue: "Check saved version" })}</Button></div> : <div className={cn(workspaceStyles.formActions, "justify-between")}><Button type="button" variant="outline" className={actionClass} disabled={!editable || !initialized || newerVersion} onClick={async () => { if (await confirm({ title: t("accounting.invoicePersonalizationSettings.restoreInheritedInvoiceSettings", { defaultValue: "Restore inherited invoice settings?" }), description: t("accounting.invoicePersonalizationSettings.thisPublishesANewVersionWithNoOverridesExistingIssued", { defaultValue: "This publishes a new version with no overrides. Existing issued invoices are unchanged." }), confirmLabel: t("accounting.invoicePersonalizationSettings.restoreInheritance", { defaultValue: "Restore inheritance" }), cancelLabel: t("common.discardChanges.keep", { defaultValue: "Keep editing" }) })) void save({}) }}>{t("accounting.invoicePersonalizationSettings.restoreInheritance", { defaultValue: "Restore inheritance" })}</Button><Button type="button" data-testid="invoice-profile-save" className={actionClass} disabled={!editable || !initialized || !dirty || newerVersion || validation.status !== "valid"} onClick={() => void save()}>{pending ? t("accounting.invoicePersonalizationSettings.publishing", { defaultValue: "Publishing…" }) : uploading ? t("accounting.invoicePersonalizationSettings.uploading", { defaultValue: "Uploading…" }) : t("accounting.invoicePersonalizationSettings.publishInvoiceSettings", { defaultValue: "Publish invoice settings" })}</Button></div>}
      {confirmDialog}{navigationDialog}
    </CardContent>
  </Card>
}

export function InvoicePersonalizationSettings({ organizationId, companyId, companyName, company, uploadInvoiceLogo }: { organizationId: number; companyId: string | null; companyName?: string; company?: Company; uploadInvoiceLogo?: UploadInvoiceLogo }) {
  const { t } = useTranslation()
  const { checkPermission, permissionsReady } = useRBAC()
  const readable = permissionsReady === true && checkPermission("document_template", "read").allowed
  const query = useInvoicePersonalization({ organizationId, companyId, enabled: readable })
  const create = permissionsReady === true && checkPermission("document_template", "create").allowed
  const canPublishOrganization = create && checkPermission("organization", "write").allowed
  const canPublishCompany = create && checkPermission("company", "write").allowed
  const activeScopeRef = useRef({ organizationId, companyId, readable, canPublishOrganization, canPublishCompany, mounted: true })
  Object.assign(activeScopeRef.current, { organizationId, companyId, readable, canPublishOrganization, canPublishCompany })
  useEffect(() => { activeScopeRef.current.mounted = true; return () => { activeScopeRef.current.mounted = false } }, [])
  const publish = useSaveInvoicePersonalizationVersion({ mayDispatch: (input) => {
    const active = activeScopeRef.current
    return active.mounted && active.readable && String(input.organizationId) === String(active.organizationId)
      && (input.companyId === null ? active.canPublishOrganization : input.companyId === active.companyId && active.canPublishCompany)
  } })
  const state: InvoicePersonalizationState = !permissionsReady ? { status: "loading" } : !readable ? { status: "denied", message: t("accounting.invoicePersonalizationSettings.youDoNotHaveAccessToInvoiceSettings", { defaultValue: "You do not have access to invoice settings." }) } : query.state
  return <InvoicePersonalizationEditor organizationId={organizationId} companyId={companyId} companyName={companyName} company={company} state={state} profile={query.profile} organizationVersion={query.organizationVersion} companyVersion={query.companyVersion} canPublishOrganization={canPublishOrganization} canPublishCompany={canPublishCompany} onSave={(input) => publish.mutateAsync(input)} onCheck={(submission) => checkInvoiceProfileSubmission(submission)} onReload={() => { void query.refetch() }} uploadInvoiceLogo={uploadInvoiceLogo} />
}
