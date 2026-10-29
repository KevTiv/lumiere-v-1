import { i18n as uiI18n } from "@lumiere/i18n"
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
      ],
    },
    {
      id: "doc-filing",
      title: t("documents.forms.newDocument.sections.filing", { defaultValue: "Optional links and filing" }),
      description: t("documents.forms.newDocument.sections.filingHint", { defaultValue: "Link an existing business record or add filing details when your document policy requires them." }),
      fields: [
        {
          id: "resModel",
          name: "resModel",
          type: "select",
          label: t("documents.forms.newDocument.fields.resModel"),
          width: "1/2",
          options: [
            { value: "", label: t("documents.forms.newDocument.fields.resModelNone") },
            { value: "sale_order", label: t("documents.forms.recordTypes.salesOrder", { defaultValue: "Sales order" }) },
            { value: "purchase_order", label: t("documents.forms.recordTypes.purchaseOrder", { defaultValue: "Purchase order" }) },
            { value: "account_move", label: t("documents.forms.recordTypes.accountingDocument", { defaultValue: "Accounting document" }) },
            { value: "hr_expense", label: t("documents.forms.recordTypes.expense", { defaultValue: "Expense" }) },
            { value: "contact", label: t("documents.forms.recordTypes.contact", { defaultValue: "Contact" }) },
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
          description: t("documents.forms.newDocument.fields.tagIdsDescription"),
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
            { value: "tax_invoice_pdf", label: t("documents.forms.fiscalKinds.taxInvoicePdf", { defaultValue: "Tax invoice (PDF)" }) },
            { value: "nfe_xml", label: t("documents.forms.fiscalKinds.nfeXml", { defaultValue: "NF-e (XML)" }) },
            { value: "nfe_pdf", label: t("documents.forms.fiscalKinds.nfePdf", { defaultValue: "NF-e (PDF)" }) },
            { value: "danfe_pdf", label: t("documents.forms.fiscalKinds.danfePdf", { defaultValue: "DANFe (PDF)" }) },
            { value: "myinvois_xml", label: t("documents.forms.fiscalKinds.myInvoisXml", { defaultValue: "MyInvois (XML)" }) },
            { value: "efaktur_xml", label: t("documents.forms.fiscalKinds.eFakturXml", { defaultValue: "e-Faktur (XML)" }) },
            { value: "efaktur_pdf", label: t("documents.forms.fiscalKinds.eFakturPdf", { defaultValue: "e-Faktur (PDF)" }) },
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
          type: "money",
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
  title: t("documents.builtIn.documentsFormConfigs.uploadDocumentVersionForm.uploadDocumentVersion.title"),
  description: t("documents.builtIn.documentsFormConfigs.uploadDocumentVersionForm.uploadDocumentVersion.description"),
  submitLabel: t("documents.page.uploadVersion"),
  sections: [
    {
      id: "version",
      fields: [
        {
          id: "file",
          name: "file",
          type: "file",
          label: t("documents.builtIn.documentsFormConfigs.uploadDocumentVersionForm.file.label"),
          required: true,
          width: "full",
          accept: ".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx,.xls,.xlsx,application/pdf,image/*,text/plain",
        },
        {
          id: "changesDescription",
          name: "changesDescription",
          type: "textarea",
          label: t("documents.builtIn.documentsFormConfigs.uploadDocumentVersionForm.changesDescription.label"),
          rows: 2,
          width: "full",
        },
        {
          id: "unlockAfter",
          name: "unlockAfter",
          type: "checkbox",
          label: t("documents.builtIn.documentsFormConfigs.uploadDocumentVersionForm.unlockAfter.label"),
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
  title: t("documents.builtIn.documentsFormConfigs.editKnowledgeArticleForm.editKnowledgeArticle.title"),
  submitLabel: t("documents.builtIn.documentsFormConfigs.editKnowledgeArticleForm.editKnowledgeArticle.submitLabel"),
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
  title: t("documents.builtIn.documentsFormConfigs.editDocumentFolderForm.editDocumentFolder.title"),
  submitLabel: t("documents.builtIn.documentsFormConfigs.editDocumentFolderForm.editDocumentFolder.submitLabel"),
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
  get title() { return uiI18n.t("documents.builtIn.documentsFormConfigs.addArticleMemberForm.addArticleMember.title") },
  get submitLabel() { return uiI18n.t("documents.builtIn.documentsFormConfigs.addArticleMemberForm.addArticleMember.submitLabel") },
  sections: [
    {
      id: "member",
      fields: [
        {
          id: "member",
          name: "member",
          type: "text",
          get label() { return uiI18n.t("documents.knowledgeActions.memberIdentity") },
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const newDocumentTemplateForm = (_t: TFunction): FormConfig => ({
  id: "new-document-template",
  get title() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newDocumentTemplateForm.newDocumentTemplate.title") },
  get submitLabel() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newDocumentTemplateForm.newDocumentTemplate.submitLabel") },
  sections: [
    {
      id: "template",
      fields: [
        { id: "name", name: "name", type: "text", get label() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newDocumentTemplateForm.name.label") }, required: true, width: "full" },
        { id: "model", name: "model", type: "text", get label() { return uiI18n.t("documents.processing.columns.modelUsed") }, required: true, width: "1/2", get placeholder() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newDocumentTemplateForm.model.placeholder") } },
        {
          id: "reportType",
          name: "reportType",
          type: "text",
          get label() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newDocumentTemplateForm.reportType.label") },
          defaultValue: "qweb-pdf",
          width: "1/2",
        },
        {
          id: "bodyHtml",
          name: "bodyHtml",
          type: "textarea",
          get label() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newDocumentTemplateForm.bodyHtml.label") },
          format: "plain",
          required: true,
          rows: 8,
          width: "full",
        },
        {
          id: "isDefault",
          name: "isDefault",
          type: "checkbox",
          get label() { return uiI18n.t("documents.studio.default") },
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          get label() { return uiI18n.t("common.active") },
          defaultValue: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const newMailTemplateForm = (_t: TFunction): FormConfig => ({
  id: "new-mail-template",
  get title() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newMailTemplateForm.newMailTemplate.title") },
  get submitLabel() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newMailTemplateForm.newMailTemplate.submitLabel") },
  sections: [
    {
      id: "template",
      fields: [
        { id: "name", name: "name", type: "text", get label() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newMailTemplateForm.name.label") }, required: true, width: "full" },
        { id: "model", name: "model", type: "text", get label() { return uiI18n.t("documents.processing.columns.modelUsed") }, required: true, width: "1/2" },
        { id: "subject", name: "subject", type: "text", get label() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newMailTemplateForm.subject.label") }, required: true, width: "1/2" },
        {
          id: "bodyHtml",
          name: "bodyHtml",
          type: "textarea",
          get label() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newMailTemplateForm.bodyHtml.label") },
          format: "plain",
          required: true,
          rows: 6,
          width: "full",
        },
        {
          id: "attachDocument",
          name: "attachDocument",
          type: "checkbox",
          get label() { return uiI18n.t("documents.builtIn.documentsFormConfigs.newMailTemplateForm.attachDocument.label") },
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          get label() { return uiI18n.t("common.active") },
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
  "set-document-retention": setDocumentRetentionForm(t),
})
