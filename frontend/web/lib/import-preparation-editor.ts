import type { ChatImportTask } from "./chat-import-task"
import {
  importPreparationIdentity,
  importPreparationSchema,
  importPreparationTextFields,
  type ImportPreparation,
  type ImportPreparationRules,
  type ImportPreparationSection,
  type ImportRecipe,
} from "./import-preparation"

export const preparationFieldLabels = {
  name: "Name",
  description: "Description",
  internal_reference: "Product reference",
  barcode: "Barcode",
  sale_price: "Sale price",
  cost_price: "Cost price",
  uom_id: "Sales unit ID",
  uom_po_id: "Purchase unit ID",
  category_id: "Product category ID",
  active: "Active record",
  can_be_sold: "Available for sale",
  can_be_purchased: "Available for purchase",
  type_field: "Product type",
  weight: "Weight",
  volume: "Volume",
  first_name: "First name",
  last_name: "Last name",
  title: "Title",
  email: "Email",
  email_secondary: "Secondary email",
  phone: "Phone",
  mobile: "Mobile phone",
  fax: "Fax",
  website: "Website",
  street: "Street",
  street2: "Address line 2",
  city: "City",
  state_code: "Region code",
  zip: "Postal code",
  country_code: "Country code",
  tax_id: "Tax identifier",
  company_registry: "Company registration",
  industry: "Industry",
  employees_count: "Employee count",
  annual_revenue: "Annual revenue",
  notes: "Notes",
  color: "Color",
  is_customer: "Customer role",
  is_vendor: "Vendor role",
  is_employee: "Employee role",
  is_prospect: "Prospect role",
  is_partner: "Partner role",
  type_: "Contact type",
  company_id: "Company ID",
  usage: "Location use",
  complete_name: "Full location name",
  is_scrap: "Scrap location",
  date: "Source date",
  business_date: "Transaction date",
  as_of: "Snapshot date",
  invoice_date: "Invoice date",
  count_date: "Stock count date",
  balance_date: "Balance date",
  amount: "Amount",
  quantity: "Quantity",
  pieces: "Quantity in pieces",
  kilograms: "Quantity in kilograms",
  debit: "Debit amount",
  credit: "Credit amount",
  product_label: "Product label",
  category: "Expense or source category",
  counterparty: "Customer, vendor or other party",
  document_reference: "Document reference",
  external_reference: "External record reference",
  currency: "Currency code",
  unit: "Source unit",
  reported_method: "Reported payment method",
  reported_destination: "Reported payment destination",
  business_interpretation: "Business meaning",
  observation_kind: "Historical fact type",
  debit_account_id: "Debit account ID",
  credit_account_id: "Credit account ID",
  currency_id: "Currency ID",
} as const

export type PreparationField = keyof typeof preparationFieldLabels

/** Mirrors the bounded preparation contract; this is not the ERP write catalog. */
export const preparationTargetFields: Record<
  ImportPreparationSection["targetEntity"],
  readonly PreparationField[]
> = {
  product: [
    "name",
    "internal_reference",
    "barcode",
    "sale_price",
    "cost_price",
    "uom_id",
    "uom_po_id",
    "category_id",
    "description",
    "active",
    "can_be_sold",
    "can_be_purchased",
    "type_field",
    "weight",
    "volume",
  ],
  contact: [
    "name",
    "first_name",
    "last_name",
    "title",
    "email",
    "email_secondary",
    "phone",
    "mobile",
    "fax",
    "website",
    "street",
    "street2",
    "city",
    "state_code",
    "zip",
    "country_code",
    "tax_id",
    "company_registry",
    "industry",
    "employees_count",
    "annual_revenue",
    "notes",
    "color",
    "is_customer",
    "is_vendor",
    "is_employee",
    "is_prospect",
    "is_partner",
    "type_",
    "company_id",
  ],
  stock_location: [
    "name",
    "usage",
    "complete_name",
    "barcode",
    "active",
    "is_scrap",
  ],
  source_observation: [
    "date",
    "business_date",
    "as_of",
    "invoice_date",
    "count_date",
    "balance_date",
    "description",
    "name",
    "product_label",
    "category",
    "counterparty",
    "document_reference",
    "external_reference",
    "currency",
    "unit",
    "reported_method",
    "reported_destination",
    "business_interpretation",
    "observation_kind",
    "debit_account_id",
    "credit_account_id",
    "currency_id",
    "amount",
    "quantity",
    "pieces",
    "kilograms",
    "debit",
    "credit",
  ],
}

export function normalizedPreparationHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

export function mappedPreparationFields(
  section: ImportPreparationSection,
): PreparationField[] {
  const allowed = preparationTargetFields[section.targetEntity]
  const mapped = new Set(
    section.expectedHeaders.map(
      (header) =>
        section.headerMap?.[header] ?? normalizedPreparationHeader(header),
    ),
  )
  return allowed.filter((field) => mapped.has(field))
}

export function editablePreparationTextFields(
  section: ImportPreparationSection,
): PreparationField[] {
  return mappedPreparationFields(section).filter((field) =>
    importPreparationTextFields.has(field),
  )
}

export function identityPreparationFields(
  section: ImportPreparationSection,
): PreparationField[] {
  const references = new Set([
    "name",
    "internal_reference",
    "barcode",
    "email",
    "phone",
    "mobile",
    "tax_id",
    "company_registry",
    "document_reference",
    "external_reference",
    "product_label",
    "counterparty",
    "complete_name",
  ])
  return mappedPreparationFields(section).filter((field) =>
    references.has(field),
  )
}

/** Changing a source mapping drops dependent rules that no longer have a column. */
export function prunePreparationSection(
  section: ImportPreparationSection,
): ImportPreparationSection {
  const available = new Set(mappedPreparationFields(section))
  const identityFields = section.identityFields?.filter((field) =>
    available.has(field as PreparationField),
  )
  return {
    ...section,
    aliases: section.aliases?.filter((rule) =>
      available.has(rule.field as PreparationField),
    ),
    transforms: section.transforms?.filter((rule) =>
      available.has(rule.field as PreparationField),
    ),
    identityFields,
    identityNamespace: identityFields?.length
      ? section.identityNamespace
      : undefined,
  }
}

export function savedPreparationRules(
  task: ChatImportTask,
): Record<string, ImportPreparationRules> {
  return Object.fromEntries(
    (task.preparation?.files ?? []).map(
      ({ fileName, sourceSha256: _digest, ...options }) => [fileName, options],
    ),
  )
}

function hasRules(options: ImportPreparationRules): boolean {
  return Object.values(options).some(
    (value) =>
      value !== undefined && (!Array.isArray(value) || value.length > 0),
  )
}

export function preparationForSources(
  task: ChatImportTask,
  rules: Record<string, ImportPreparationRules>,
) {
  return importPreparationSchema.safeParse({
    version: 1,
    files: task.files
      .filter((file) => hasRules(rules[file.fileName] ?? {}))
      .map((file) => ({
        fileName: file.fileName,
        sourceSha256: file.sha256,
        ...rules[file.fileName],
      })),
  })
}

export function preparationHasChanges(
  task: ChatImportTask,
  preparation: ImportPreparation,
): boolean {
  const normalize = (
    value: ImportPreparation | null | undefined,
  ): ImportPreparation => ({
    version: 1,
    files: [...(value?.files ?? [])]
      .filter((file) => {
        const { fileName: _name, sourceSha256: _digest, ...rules } = file
        return hasRules(rules)
      })
      .sort((left, right) =>
        left.fileName < right.fileName
          ? -1
          : left.fileName > right.fileName
            ? 1
            : 0,
      ),
  })
  return (
    importPreparationIdentity(normalize(task.preparation)) !==
    importPreparationIdentity(normalize(preparation))
  )
}

export function canSavePreparationRecipe(task: ChatImportTask): boolean {
  return (
    task.status === "needs_review" &&
    task.decision.selectedOptionId === "prepare_import" &&
    !!task.coverage?.complete &&
    !!task.preparation?.files.length &&
    task.preparation.files.every((file) => {
      const coverage = task.coverage?.files.find(
        (source) =>
          source.fileName === file.fileName &&
          source.sourceSha256 === file.sourceSha256,
      )
      return (
        coverage?.status === "prepared" &&
        !!coverage.layoutSha256 &&
        coverage.sections.some((section) => !!section.headerSha256) &&
        !!(
          file.delimiter ||
          file.decimalSeparator ||
          file.groupingSeparator ||
          file.dateOrder ||
          file.sections?.length
        )
      )
    })
  )
}

export function recipeMatchesPreparation(
  recipe: ImportRecipe,
  task: ChatImportTask,
): boolean {
  if (
    !canSavePreparationRecipe(task) ||
    recipe.slots.length !== task.preparation!.files.length
  )
    return false
  return task.preparation!.files.every((file) => {
    const original = task.files.find(
      (source) =>
        source.fileName === file.fileName &&
        source.sha256 === file.sourceSha256,
    )
    if (!original) return false
    const slot = recipe.slots.find(
      (value) => value.key === `source-${original.ordinal + 1}`,
    )
    const coverage = task.coverage!.files.find(
      (value) => value.fileName === file.fileName,
    )
    if (!slot || slot.label !== file.fileName) return false
    const { fileName, sourceSha256, ...rules } = file
    const identity = (options: ImportPreparationRules) =>
      importPreparationIdentity({
        version: 1,
        files: [{ fileName, sourceSha256, ...options }],
      })
    return (
      identity(slot.options) ===
      identity({ ...rules, expectedLayoutSha256: coverage!.layoutSha256! })
    )
  })
}

export function nextPreparationSectionKey(
  sections: readonly ImportPreparationSection[],
): string {
  const keys = new Set(sections.map((section) => section.key))
  for (let index = 1; index <= 51; index++)
    if (!keys.has(`section-${index}`)) return `section-${index}`
  return "section-51"
}
