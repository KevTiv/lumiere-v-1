
import type { ReducerCommandContractMeta } from "./types";

export const TEMPLATES_BFF_REDUCERS = [
  "create_document_template",
  "create_mail_template",
  "queue_mail_from_template",
  "update_document_template",
  "update_mail_template",
] as const;

export type TemplatesBffReducerKey = (typeof TEMPLATES_BFF_REDUCERS)[number];

export function templatesCommandContract(
  reducer: TemplatesBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Document/mail template reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: ["document-templates", "mail-templates", "mail-messages"],
    affectedTables: ["document_template", "mail_template", "mail_message"],
    expectations: "Authenticated session with organization scope.",
  };
}

export type DocumentPdfKind = "sale-order" | "account-move" | "financial-report";

export type DocumentExportFormat = "pdf" | "csv" | "xlsx";

export type DocumentExportKind = DocumentPdfKind;

export function documentPdfUrl(kind: DocumentPdfKind, id: number) {
  return `/api/documents/pdf/${kind}/${id}`;
}

export function documentExportUrl(
  format: DocumentExportFormat,
  kind: DocumentExportKind,
  id: number,
) {
  return `/api/documents/${format}/${kind}/${id}`;
}
