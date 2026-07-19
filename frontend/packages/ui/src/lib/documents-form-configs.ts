import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newDocumentForm = (t: TFunction): FormConfig => ({
  id: "new-document",
  title: t("documents.forms.newDocument.title"),
  description: t("documents.forms.newDocument.description"),
  sections: [
    {
      id: "doc-details",
      title: t("documents.forms.newDocument.sections.documentDetails"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("documents.forms.newDocument.fields.name"),
          placeholder: t("documents.forms.newDocument.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "file",
          name: "file",
          type: "file",
          label: t("documents.forms.newDocument.fields.file"),
          description: t("documents.forms.newDocument.fields.fileHint"),
          required: true,
          width: "full",
          accept: ".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx,.xls,.xlsx,application/pdf,image/*,text/plain",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("documents.forms.newDocument.fields.description"),
          placeholder: t("documents.forms.newDocument.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
        {
          id: "isFavorite",
          name: "isFavorite",
          type: "checkbox",
          label: t("documents.forms.newDocument.fields.isFavorite"),
          width: "1/2",
        },
        {
          id: "folderId",
          name: "folderId",
          type: "select",
          label: t("documents.forms.newDocument.fields.folderId"),
          placeholder: t("documents.forms.newDocument.fields.folderIdHint"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "resModel",
          name: "resModel",
          type: "select",
          label: t("documents.forms.newDocument.fields.resModel"),
          width: "1/2",
          options: [
            { value: "", label: t("documents.forms.newDocument.fields.resModelNone") },
            { value: "sale_order", label: "sale_order" },
            { value: "purchase_order", label: "purchase_order" },
            { value: "account_move", label: "account_move" },
            { value: "hr_expense", label: "hr_expense" },
            { value: "contact", label: "contact" },
          ],
        },
        {
          id: "resId",
          name: "resId",
          type: "number",
          label: t("documents.forms.newDocument.fields.resId"),
          width: "1/2",
        },
        {
          id: "tagIds",
          name: "tagIds",
          type: "text",
          label: t("documents.forms.newDocument.fields.tagIds"),
          placeholder: t("documents.forms.newDocument.fields.tagIdsHint"),
          width: "full",
        },
        {
          id: "retentionDays",
          name: "retentionDays",
          type: "number",
          label: t("documents.forms.newDocument.fields.retentionDays"),
          placeholder: t("documents.forms.newDocument.fields.retentionDaysHint"),
          width: "1/2",
          min: 0,
        },
        {
          id: "fiscalKind",
          name: "fiscalKind",
          type: "select",
          label: t("documents.forms.newDocument.fields.fiscalKind"),
          width: "1/2",
          options: [
            { value: "", label: t("documents.forms.newDocument.fields.fiscalKindNone") },
            { value: "tax_invoice_pdf", label: "tax_invoice_pdf" },
            { value: "nfe_xml", label: "nfe_xml" },
            { value: "nfe_pdf", label: "nfe_pdf" },
            { value: "danfe_pdf", label: "danfe_pdf" },
            { value: "myinvois_xml", label: "myinvois_xml" },
            { value: "efaktur_xml", label: "efaktur_xml" },
            { value: "efaktur_pdf", label: "efaktur_pdf" },
          ],
        },
        {
          id: "residencyRegion",
          name: "residencyRegion",
          type: "text",
          label: t("documents.forms.newDocument.fields.residencyRegion"),
          placeholder: t("documents.forms.newDocument.fields.residencyRegionHint"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newKnowledgeArticleForm = (t: TFunction): FormConfig => ({
  id: "new-knowledge-article",
  title: t("documents.forms.newArticle.title"),
  description: t("documents.forms.newArticle.description"),
  sections: [
    {
      id: "article-info",
      title: t("documents.forms.newArticle.sections.article"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("documents.forms.newArticle.fields.name"),
          placeholder: t("documents.forms.newArticle.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("documents.forms.newArticle.fields.description"),
          placeholder: t("documents.forms.newArticle.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
        {
          id: "body",
          name: "body",
          type: "textarea",
          label: t("documents.forms.newArticle.fields.body"),
          placeholder: t("documents.forms.newArticle.fields.bodyPlaceholder"),
          width: "full",
          rows: 6,
        },
        {
          id: "isPublished",
          name: "isPublished",
          type: "checkbox",
          label: t("documents.forms.newArticle.fields.isPublished"),
          width: "1/2",
        },
        {
          id: "parentId",
          name: "parentId",
          type: "select",
          label: t("documents.forms.newArticle.fields.parentId"),
          placeholder: t("documents.forms.newArticle.fields.parentIdHint"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "categoryId",
          name: "categoryId",
          type: "select",
          label: t("documents.forms.newArticle.fields.categoryId"),
          placeholder: t("documents.forms.newArticle.fields.categoryIdHint"),
          width: "1/2",
          options: emptySelect,
        },
      ],
    },
  ],
})

export const newKnowledgeCategoryForm = (t: TFunction): FormConfig => ({
  id: "new-knowledge-category",
  title: t("documents.forms.newCategory.title"),
  description: t("documents.forms.newCategory.description"),
  sections: [
    {
      id: "category-info",
      title: t("documents.forms.newCategory.sections.category"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("documents.forms.newCategory.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("documents.forms.newCategory.fields.description"),
          rows: 2,
          width: "full",
        },
        {
          id: "parentId",
          name: "parentId",
          type: "select",
          label: t("documents.forms.newCategory.fields.parentId"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("documents.forms.newCategory.fields.sequence"),
          defaultValue: 10,
          width: "1/2",
        },
        {
          id: "color",
          name: "color",
          type: "number",
          label: t("documents.forms.newCategory.fields.color"),
          placeholder: t("documents.forms.newCategory.fields.colorPlaceholder"),
          min: 0,
          max: 11,
          width: "1/2",
        },
      ],
    },
  ],
})

export const newDocumentFolderForm = (t: TFunction): FormConfig => ({
  id: "new-document-folder",
  title: t("documents.forms.newFolder.title"),
  description: t("documents.forms.newFolder.description"),
  sections: [
    {
      id: "folder-info",
      title: t("documents.forms.newFolder.sections.folder"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("documents.forms.newFolder.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("documents.forms.newFolder.fields.description"),
          rows: 2,
          width: "full",
        },
        {
          id: "parentId",
          name: "parentId",
          type: "select",
          label: t("documents.forms.newFolder.fields.parentId"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("documents.forms.newFolder.fields.sequence"),
          defaultValue: 10,
          width: "1/2",
        },
        {
          id: "isFavorite",
          name: "isFavorite",
          type: "checkbox",
          label: t("documents.forms.newFolder.fields.isFavorite"),
          width: "1/2",
        },
        {
          id: "isHidden",
          name: "isHidden",
          type: "checkbox",
          label: t("documents.forms.newFolder.fields.isHidden"),
          width: "1/2",
        },
        {
          id: "residencyRegion",
          name: "residencyRegion",
          type: "text",
          label: t("documents.forms.newFolder.fields.residencyRegion"),
          placeholder: t("documents.forms.newFolder.fields.residencyRegionHint"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const reindexDocumentForm = (t: TFunction): FormConfig => ({
  id: "reindex-document",
  title: t("documents.forms.reindexDocument.title"),
  description: t("documents.forms.reindexDocument.description"),
  sections: [
    {
      id: "index",
      title: t("documents.forms.reindexDocument.sections.index"),
      fields: [
        {
          id: "content",
          name: "content",
          type: "textarea",
          label: t("documents.forms.reindexDocument.fields.content"),
          placeholder: t("documents.forms.reindexDocument.fields.contentPlaceholder"),
          required: true,
          width: "full",
          rows: 6,
        },
        {
          id: "language",
          name: "language",
          type: "text",
          label: t("documents.forms.reindexDocument.fields.language"),
          placeholder: t("documents.forms.reindexDocument.fields.languageHint"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const setDocumentRetentionForm = (t: TFunction): FormConfig => ({
  id: "set-document-retention",
  title: t("documents.forms.setRetention.title"),
  description: t("documents.forms.setRetention.description"),
  sections: [
    {
      id: "retention",
      title: t("documents.forms.setRetention.sections.retention"),
      fields: [
        {
          id: "retentionDays",
          name: "retentionDays",
          type: "number",
          label: t("documents.forms.setRetention.fields.retentionDays"),
          placeholder: t("documents.forms.setRetention.fields.retentionDaysHint"),
          width: "1/2",
          min: 0,
        },
        {
          id: "classificationId",
          name: "classificationId",
          type: "number",
          label: t("documents.forms.setRetention.fields.classificationId"),
          placeholder: t("documents.forms.setRetention.fields.classificationIdHint"),
          width: "1/2",
          min: 0,
        },
      ],
    },
  ],
})

export const newDocumentProcessingJobForm = (t: TFunction): FormConfig => ({
  id: "new-document-processing-job",
  title: t("documents.forms.newProcessingJob.title"),
  description: t("documents.forms.newProcessingJob.description"),
  sections: [
    {
      id: "job-params",
      title: t("documents.forms.newProcessingJob.sections.params"),
      fields: [
        {
          id: "documentType",
          name: "documentType",
          type: "text",
          label: t("documents.forms.newProcessingJob.fields.documentType"),
          placeholder: t("documents.forms.newProcessingJob.fields.documentTypePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "jobType",
          name: "jobType",
          type: "text",
          label: t("documents.forms.newProcessingJob.fields.jobType"),
          placeholder: t("documents.forms.newProcessingJob.fields.jobTypePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "documentId",
          name: "documentId",
          type: "number",
          label: t("documents.forms.newProcessingJob.fields.documentId"),
          placeholder: t("documents.forms.newProcessingJob.fields.documentIdHint"),
          width: "1/2",
          min: 0,
        },
        {
          id: "documentVersionId",
          name: "documentVersionId",
          type: "number",
          label: t("documents.forms.newProcessingJob.fields.documentVersionId"),
          placeholder: t("documents.forms.newProcessingJob.fields.documentVersionIdHint"),
          width: "1/2",
          min: 0,
        },
        {
          id: "aiAgentId",
          name: "aiAgentId",
          type: "select",
          label: t("documents.forms.newProcessingJob.fields.aiAgentId"),
          placeholder: t("documents.forms.newProcessingJob.fields.aiAgentIdPlaceholder"),
          width: "full",
          options: emptySelect,
        },
        {
          id: "inputData",
          name: "inputData",
          type: "textarea",
          label: t("documents.forms.newProcessingJob.fields.inputData"),
          placeholder: t("documents.forms.newProcessingJob.fields.inputDataPlaceholder"),
          width: "full",
          rows: 4,
        },
        {
          id: "metadata",
          name: "metadata",
          type: "textarea",
          label: t("documents.forms.newProcessingJob.fields.metadata"),
          placeholder: t("documents.forms.newProcessingJob.fields.metadataPlaceholder"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const completeDocumentProcessingJobForm = (t: TFunction): FormConfig => ({
  id: "complete-document-processing-job",
  title: t("documents.forms.completeProcessingJob.title"),
  description: t("documents.forms.completeProcessingJob.description"),
  sections: [
    {
      id: "result",
      title: t("documents.forms.completeProcessingJob.sections.result"),
      fields: [
        {
          id: "extractedData",
          name: "extractedData",
          type: "textarea",
          label: t("documents.forms.completeProcessingJob.fields.extractedData"),
          placeholder: t("documents.forms.completeProcessingJob.fields.extractedDataPlaceholder"),
          width: "full",
          rows: 6,
        },
        {
          id: "modelUsed",
          name: "modelUsed",
          type: "text",
          label: t("documents.forms.completeProcessingJob.fields.modelUsed"),
          width: "1/2",
        },
        {
          id: "confidenceScore",
          name: "confidenceScore",
          type: "number",
          label: t("documents.forms.completeProcessingJob.fields.confidenceScore"),
          width: "1/2",
        },
        {
          id: "tokensUsed",
          name: "tokensUsed",
          type: "number",
          label: t("documents.forms.completeProcessingJob.fields.tokensUsed"),
          width: "1/2",
        },
        {
          id: "cost",
          name: "cost",
          type: "number",
          label: t("documents.forms.completeProcessingJob.fields.cost"),
          width: "1/2",
        },
        {
          id: "errorMessage",
          name: "errorMessage",
          type: "textarea",
          label: t("documents.forms.completeProcessingJob.fields.errorMessage"),
          placeholder: t("documents.forms.completeProcessingJob.fields.errorMessagePlaceholder"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const acknowledgeDocumentInsightForm = (t: TFunction): FormConfig => ({
  id: "acknowledge-document-insight",
  title: t("documents.forms.acknowledgeInsight.title"),
  description: t("documents.forms.acknowledgeInsight.description"),
  sections: [
    {
      id: "note",
      title: t("documents.forms.acknowledgeInsight.sections.note"),
      fields: [
        {
          id: "actionTaken",
          name: "actionTaken",
          type: "textarea",
          label: t("documents.forms.acknowledgeInsight.fields.actionTaken"),
          placeholder: t("documents.forms.acknowledgeInsight.fields.actionTakenPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const uploadDocumentVersionForm = (t: TFunction): FormConfig => ({
  id: "upload-document-version",
  title: "Upload new version",
  description: "Check in a new file revision for the selected document.",
  submitLabel: "Upload version",
  sections: [
    {
      id: "version",
      fields: [
        {
          id: "file",
          name: "file",
          type: "file",
          label: "File",
          required: true,
          width: "full",
          accept: ".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx,.xls,.xlsx,application/pdf,image/*,text/plain",
        },
        {
          id: "changesDescription",
          name: "changesDescription",
          type: "textarea",
          label: "Change notes",
          rows: 2,
          width: "full",
        },
        {
          id: "unlockAfter",
          name: "unlockAfter",
          type: "checkbox",
          label: "Unlock after check-in",
          defaultValue: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const editKnowledgeArticleForm = (
  t: TFunction,
  row: Record<string, unknown>,
): FormConfig => ({
  id: "edit-knowledge-article",
  title: "Update article",
  submitLabel: "Save article",
  sections: [
    {
      id: "article",
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("documents.forms.newArticle.fields.name"),
          required: true,
          defaultValue: String(row.name ?? ""),
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("documents.forms.newArticle.fields.description"),
          defaultValue: String(row.description ?? ""),
          rows: 2,
          width: "full",
        },
        {
          id: "body",
          name: "body",
          type: "textarea",
          label: t("documents.forms.newArticle.fields.body"),
          defaultValue: String(row.body ?? ""),
          rows: 6,
          width: "full",
        },
        {
          id: "isPublished",
          name: "isPublished",
          type: "checkbox",
          label: t("documents.forms.newArticle.fields.isPublished"),
          defaultValue: Boolean(row.isPublished),
          width: "1/2",
        },
      ],
    },
  ],
})

export const editDocumentFolderForm = (
  t: TFunction,
  row: Record<string, unknown>,
): FormConfig => ({
  id: "edit-document-folder",
  title: "Update folder",
  submitLabel: "Save folder",
  sections: [
    {
      id: "folder",
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("documents.forms.newFolder.fields.name"),
          required: true,
          defaultValue: String(row.name ?? ""),
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("documents.forms.newFolder.fields.description"),
          defaultValue: String(row.description ?? ""),
          rows: 2,
          width: "full",
        },
        {
          id: "parentId",
          name: "parentId",
          type: "select",
          label: t("documents.forms.newFolder.fields.parentId"),
          defaultValue: row.parentId != null ? String(row.parentId) : "",
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("documents.forms.newFolder.fields.sequence"),
          defaultValue: Number(row.sequence ?? 10),
          width: "1/2",
        },
        {
          id: "isFavorite",
          name: "isFavorite",
          type: "checkbox",
          label: t("documents.forms.newFolder.fields.isFavorite"),
          defaultValue: Boolean(row.isFavorite),
          width: "1/2",
        },
        {
          id: "isHidden",
          name: "isHidden",
          type: "checkbox",
          label: t("documents.forms.newFolder.fields.isHidden"),
          defaultValue: Boolean(row.isHidden),
          width: "1/2",
        },
        {
          id: "residencyRegion",
          name: "residencyRegion",
          type: "text",
          label: t("documents.forms.newFolder.fields.residencyRegion"),
          placeholder: t("documents.forms.newFolder.fields.residencyRegionHint"),
          defaultValue: String(row.residencyRegion ?? ""),
          width: "1/2",
        },
      ],
    },
  ],
})

export const addArticleMemberForm = (_t: TFunction): FormConfig => ({
  id: "add-article-member",
  title: "Add article member",
  submitLabel: "Add member",
  sections: [
    {
      id: "member",
      fields: [
        {
          id: "member",
          name: "member",
          type: "text",
          label: "Member identity (hex)",
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const newDocumentTemplateForm = (_t: TFunction): FormConfig => ({
  id: "new-document-template",
  title: "New document template",
  submitLabel: "Create template",
  sections: [
    {
      id: "template",
      fields: [
        { id: "name", name: "name", type: "text", label: "Name", required: true, width: "full" },
        { id: "model", name: "model", type: "text", label: "Model", required: true, width: "1/2", placeholder: "sale.order" },
        {
          id: "reportType",
          name: "reportType",
          type: "text",
          label: "Report type",
          defaultValue: "qweb-pdf",
          width: "1/2",
        },
        {
          id: "bodyHtml",
          name: "bodyHtml",
          type: "textarea",
          label: "Body HTML",
          required: true,
          rows: 8,
          width: "full",
        },
        {
          id: "isDefault",
          name: "isDefault",
          type: "checkbox",
          label: "Default",
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: "Active",
          defaultValue: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const newMailTemplateForm = (_t: TFunction): FormConfig => ({
  id: "new-mail-template",
  title: "New mail template",
  submitLabel: "Create template",
  sections: [
    {
      id: "template",
      fields: [
        { id: "name", name: "name", type: "text", label: "Name", required: true, width: "full" },
        { id: "model", name: "model", type: "text", label: "Model", required: true, width: "1/2" },
        { id: "subject", name: "subject", type: "text", label: "Subject", required: true, width: "1/2" },
        {
          id: "bodyHtml",
          name: "bodyHtml",
          type: "textarea",
          label: "Body HTML",
          required: true,
          rows: 6,
          width: "full",
        },
        {
          id: "attachDocument",
          name: "attachDocument",
          type: "checkbox",
          label: "Attach document",
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: "Active",
          defaultValue: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const documentsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-document": newDocumentForm(t),
  "new-knowledge-article": newKnowledgeArticleForm(t),
  "new-knowledge-category": newKnowledgeCategoryForm(t),
  "new-document-folder": newDocumentFolderForm(t),
  "new-document-processing-job": newDocumentProcessingJobForm(t),
  "complete-document-processing-job": completeDocumentProcessingJobForm(t),
  "acknowledge-document-insight": acknowledgeDocumentInsightForm(t),
  "upload-document-version": uploadDocumentVersionForm(t),
  "new-document-template": newDocumentTemplateForm(t),
  "new-mail-template": newMailTemplateForm(t),
  "reindex-document": reindexDocumentForm(t),
  "set-document-retention": setDocumentRetentionForm(t),
})
