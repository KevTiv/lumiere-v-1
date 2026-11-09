import { z } from "zod"

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const positiveId = z.string().regex(/^[1-9]\d*$/)
const recordNumber = z.number().int().min(1).max(25_000)
const columnNumber = z.number().int().min(1).max(200)
const fieldKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,99}$/)
  .refine((value) => !["constructor", "prototype"].includes(value))
const bytes = (maximum: number) =>
  z
    .string()
    .refine((value) => new TextEncoder().encode(value).length <= maximum)
const text = (maximum: number) =>
  bytes(maximum).refine(
    (value) => value.length > 0 && !/[\u0000-\u001f]/.test(value),
  )
const filename = text(300).refine((value) => !/[\\/]/.test(value))

export const importPreparationTextFields = new Set([
  "name",
  "description",
  "internal_reference",
  "barcode",
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
  "notes",
  "complete_name",
  "product_label",
  "category",
  "counterparty",
  "document_reference",
  "external_reference",
  "currency",
  "business_interpretation",
])
const textRuleField = fieldKey.refine(
  (value) => importPreparationTextFields.has(value),
  "Choose a text field; amounts, units and record states require separate review.",
)
const aliasSchema = z
  .object({ field: textRuleField, from: text(2000), to: text(2000) })
  .strict()
const transformSchema = z
  .object({
    field: textRuleField,
    operation: z.enum(["trim", "uppercase", "lowercase"]),
  })
  .strict()

export const importPreparationSectionSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    headerRecord: recordNumber,
    firstRecord: recordNumber,
    lastRecord: recordNumber,
    targetEntity: z.enum([
      "product",
      "contact",
      "stock_location",
      "source_observation",
    ]),
    expectedHeaders: z.array(bytes(2000)).min(1).max(200),
    headerMap: z.record(z.string(), fieldKey).optional(),
    aliases: z.array(aliasSchema).max(100).optional(),
    transforms: z.array(transformSchema).max(100).optional(),
    firstColumn: columnNumber.optional(),
    lastColumn: columnNumber.optional(),
    identityNamespace: text(200).optional(),
    identityFields: z.array(fieldKey).max(8).optional(),
  })
  .strict()
  .superRefine((section, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, message })
    if (
      !(
        section.headerRecord < section.firstRecord &&
        section.firstRecord <= section.lastRecord
      )
    ) {
      issue("Choose a header before the section's ordered data records.")
    }
    const start = section.firstColumn ?? 1
    const end = section.lastColumn ?? start + section.expectedHeaders.length - 1
    if (end > 200 || end - start + 1 !== section.expectedHeaders.length)
      issue("Selected columns must match the exact expected headers.")
    const mapping = section.headerMap ?? {}
    if (
      Object.keys(mapping).some((key) => !section.expectedHeaders.includes(key))
    )
      issue("Map only columns from this source section.")
    const headers = section.expectedHeaders.map(
      (header) =>
        mapping[header] ??
        header
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_"),
    )
    if (new Set(headers).size !== headers.length)
      issue("Select distinct mapped columns.")
    const identities = section.identityFields ?? []
    if (Boolean(identities.length) !== Boolean(section.identityNamespace))
      issue("Choose an identity namespace and its source fields together.")
    if (
      new Set(identities).size !== identities.length ||
      identities.some((key) => !headers.includes(key))
    )
      issue("Identity fields must be distinct mapped source columns.")
    if (
      [...(section.aliases ?? []), ...(section.transforms ?? [])].some(
        (rule) => !headers.includes(rule.field),
      )
    )
      issue("Apply text rules only to fields in this section.")
    const aliases = (section.aliases ?? []).map((rule) =>
      JSON.stringify([rule.field, rule.from]),
    )
    if (new Set(aliases).size !== aliases.length)
      issue("Resolve competing aliases before reusing this rule.")
  })

const fileRuleShape = {
  expectedLayoutSha256: sha256.optional(),
  delimiter: z.enum([",", ";", "\t", "|"]).optional(),
  decimalSeparator: z.enum([".", ","]).optional(),
  groupingSeparator: z.enum([".", ",", " ", "none"]).optional(),
  dateOrder: z.enum(["iso", "dmy", "mdy"]).optional(),
  sections: z.array(importPreparationSectionSchema).max(50).optional(),
}

function validateFileRules(
  options: z.infer<ReturnType<typeof fileRulesObject>>,
  context: z.RefinementCtx,
) {
  const issue = (message: string) =>
    context.addIssue({ code: z.ZodIssueCode.custom, message })
  const grouping = options.groupingSeparator ?? "none"
  if (
    grouping === options.decimalSeparator ||
    (!options.decimalSeparator && grouping !== "none")
  ) {
    issue(
      "Choose an explicit decimal separator and a different grouping separator.",
    )
  }
  const sections = options.sections ?? []
  if (new Set(sections.map((section) => section.key)).size !== sections.length)
    issue("Use distinct section names.")
  sections.forEach((section, index) => {
    const start = section.firstColumn ?? 1
    const end = section.lastColumn ?? start + section.expectedHeaders.length - 1
    for (const previous of sections.slice(0, index)) {
      const previousStart = previous.firstColumn ?? 1
      const previousEnd =
        previous.lastColumn ??
        previousStart + previous.expectedHeaders.length - 1
      if (
        Math.max(section.headerRecord, previous.headerRecord) <=
          Math.min(section.lastRecord, previous.lastRecord) &&
        Math.max(start, previousStart) <= Math.min(end, previousEnd)
      )
        issue("Sections cannot reuse the same source cells.")
    }
  })
}

function fileRulesObject() {
  return z.object(fileRuleShape).strict()
}
export const importPreparationRulesSchema =
  fileRulesObject().superRefine(validateFileRules)
export const managedImportSelectionSchema = z
  .object({
    documentId: positiveId,
    versionId: positiveId,
    current: z.boolean(),
    sheetName: text(255),
    firstRow: z.number().int().min(1).max(1_048_576),
    lastRow: z.number().int().min(1).max(1_048_576),
    firstColumn: columnNumber,
    lastColumn: columnNumber,
    encoding: z
      .enum(["utf-8", "utf-16le", "utf-16be", "windows-1252"])
      .optional(),
    headerRow: z.number().int().min(1).max(1_048_576).optional(),
  })
  .strict()
  .refine(
    ({ firstRow, lastRow, firstColumn, lastColumn, headerRow }) =>
      firstRow <= lastRow &&
      firstColumn <= lastColumn &&
      (lastRow - firstRow + 1) * (lastColumn - firstColumn + 1) <= 5000 &&
      (headerRow === undefined || headerRow <= firstRow),
  )

export const importPreparationFileSchema = z
  .object({
    fileName: filename,
    sourceSha256: sha256,
    managedSelection: managedImportSelectionSchema.optional(),
    ...fileRuleShape,
  })
  .strict()
  .superRefine((options, context) => {
    validateFileRules(options, context)
    if (
      options.managedSelection &&
      (options.sections?.length || options.expectedLayoutSha256)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use the original document selection for preparation.",
      })
  })

export const importRecipeReferenceSchema = z
  .object({
    key: text(100),
    version: z.number().int().positive().max(2_147_483_647),
  })
  .strict()
export const importPreparationSchema = z
  .object({
    version: z.literal(1),
    recipe: importRecipeReferenceSchema.optional(),
    files: z.array(importPreparationFileSchema).max(20),
  })
  .strict()
  .superRefine((preparation, context) => {
    if (
      new Set(preparation.files.map((file) => file.fileName)).size !==
      preparation.files.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use one preparation configuration per source file.",
      })
    }
  })

export type ImportPreparationSection = z.infer<
  typeof importPreparationSectionSchema
>
export type ImportPreparationRules = z.infer<
  typeof importPreparationRulesSchema
>
export type ImportPreparationFile = z.infer<typeof importPreparationFileSchema>
export type ImportPreparation = z.infer<typeof importPreparationSchema>

const coverageSource = z.object({
  fileName: filename,
  sourceSha256: sha256,
  record: recordNumber,
  rowStart: z.number().int().positive(),
  rowEnd: z.number().int().positive(),
  sectionKey: z.string(),
  itemKey: z.string(),
})
export const importCoverageSchema = z.object({
  version: z.literal(1),
  complete: z.boolean(),
  files: z
    .array(
      z.object({
        fileName: filename,
        sourceSha256: sha256,
        byteCount: z.number().int().positive().max(5_000_000),
        status: z.enum(["prepared", "held"]),
        worksheet: z.string().nullable(),
        recordCount: z.number().int().nonnegative().max(25_000).nullable(),
        reviewRecords: z.number().int().nonnegative(),
        blankRecords: z.number().int().nonnegative(),
        headerRecords: z.number().int().nonnegative(),
        records: z
          .array(
            z.object({
              record: recordNumber,
              rowStart: z.number().int().positive(),
              rowEnd: z.number().int().positive(),
              columns: z.number().int().min(0).max(200),
              sectionKeys: z.array(z.string()).max(100),
              disposition: z.enum(["review", "blank", "header"]),
              itemKeys: z.array(z.string()).max(100),
            }),
          )
          .max(25_000),
        sections: z
          .array(
            z.object({
              key: z.string(),
              targetEntity: z.string(),
              headerRecord: recordNumber.nullable(),
              firstRecord: recordNumber,
              lastRecord: recordNumber,
              firstColumn: columnNumber,
              lastColumn: columnNumber,
              headerSha256: sha256.nullable(),
            }),
          )
          .max(100),
        layoutSha256: sha256.nullable(),
        error: z.string().nullable(),
      }),
    )
    .max(20),
  reconciliation: z
    .array(
      z.object({
        status: z.enum([
          "same_record",
          "conflicting_version",
          "missing_identity",
          "overlapping_period",
        ]),
        identitySha256: sha256.nullable(),
        sources: z.array(coverageSource).min(1).max(25_000),
      }),
    )
    .max(25_000),
})
export const importPreparationReceiptSchema = z.object({
  version: z.literal(1),
  engineVersion: z.literal("lumiere-import-preparation/2"),
  sourceFingerprint: sha256,
  optionsSha256: sha256,
  outputSha256: sha256,
  recipe: importRecipeReferenceSchema.nullable(),
  semantics: z.literal("deterministic_review_proposals"),
})
export type ImportCoverage = z.infer<typeof importCoverageSchema>
export type ImportPreparationReceipt = z.infer<
  typeof importPreparationReceiptSchema
>

export const importRecipeSchema = z.object({
  companyId: positiveId,
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
  name: text(200),
  version: z.number().int().positive().max(2_147_483_647),
  sha256,
  createdAt: z.string(),
  slots: z
    .array(
      z
        .object({
          key: z.string().regex(/^source-[1-9]\d*$/),
          label: filename,
          format: z.enum(["csv", "xlsx"]),
          options: importPreparationRulesSchema,
        })
        .strict(),
    )
    .min(1)
    .max(20),
})
export type ImportRecipe = z.infer<typeof importRecipeSchema>

/** Stable comparison for request recovery. It is not a server approval signature. */
export function importPreparationIdentity(
  preparation?: ImportPreparation | null,
): string {
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted)
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, nested]) => [key, sorted(nested)]),
      )
    return value
  }
  return JSON.stringify(
    sorted(
      preparation == null ? null : importPreparationSchema.parse(preparation),
    ),
  )
}
