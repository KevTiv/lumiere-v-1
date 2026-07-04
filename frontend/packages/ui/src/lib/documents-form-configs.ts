import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

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
          id: "fileName",
          name: "fileName",
          type: "text",
          label: t("documents.forms.newDocument.fields.fileName"),
          placeholder: t("documents.forms.newDocument.fields.fileNamePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "mimetype",
          name: "mimetype",
          type: "select",
          label: t("documents.forms.newDocument.fields.mimetype"),
          width: "1/2",
          options: [
            { value: "application/pdf", label: t("documents.forms.newDocument.fields.options.pdf") },
            { value: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: t("documents.forms.newDocument.fields.options.excel") },
            { value: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: t("documents.forms.newDocument.fields.options.word") },
            { value: "image/png", label: t("documents.forms.newDocument.fields.options.png") },
            { value: "image/jpeg", label: t("documents.forms.newDocument.fields.options.jpeg") },
            { value: "text/plain", label: t("documents.forms.newDocument.fields.options.text") },
          ],
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
          id: "isShared",
          name: "isShared",
          type: "checkbox",
          label: t("documents.forms.newDocument.fields.isShared"),
          width: "1/2",
        },
        {
          id: "folderId",
          name: "folderId",
          type: "text",
          label: t("documents.forms.newDocument.fields.folderId"),
          placeholder: t("documents.forms.newDocument.fields.folderIdHint"),
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
          type: "text",
          label: t("documents.forms.newArticle.fields.parentId"),
          placeholder: t("documents.forms.newArticle.fields.parentIdHint"),
          width: "1/2",
        },
        {
          id: "categoryId",
          name: "categoryId",
          type: "text",
          label: t("documents.forms.newArticle.fields.categoryId"),
          placeholder: t("documents.forms.newArticle.fields.categoryIdHint"),
          width: "1/2",
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
          type: "text",
          label: t("documents.forms.newCategory.fields.parentId"),
          width: "1/2",
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
          type: "text",
          label: t("documents.forms.newFolder.fields.parentId"),
          width: "1/2",
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
          id: "aiAgentId",
          name: "aiAgentId",
          type: "text",
          label: t("documents.forms.newProcessingJob.fields.aiAgentId"),
          placeholder: t("documents.forms.newProcessingJob.fields.aiAgentIdPlaceholder"),
          width: "full",
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

export const documentsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-document": newDocumentForm(t),
  "new-knowledge-article": newKnowledgeArticleForm(t),
  "new-knowledge-category": newKnowledgeCategoryForm(t),
  "new-document-folder": newDocumentFolderForm(t),
  "new-document-processing-job": newDocumentProcessingJobForm(t),
  "complete-document-processing-job": completeDocumentProcessingJobForm(t),
  "acknowledge-document-insight": acknowledgeDocumentInsightForm(t),
})
