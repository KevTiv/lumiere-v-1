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
          type: "text",
          label: t("documents.forms.newDocument.fields.name"),
          placeholder: t("documents.forms.newDocument.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "fileName",
          type: "text",
          label: t("documents.forms.newDocument.fields.fileName"),
          placeholder: t("documents.forms.newDocument.fields.fileNamePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "mimetype",
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
          type: "textarea",
          label: t("documents.forms.newDocument.fields.description"),
          placeholder: t("documents.forms.newDocument.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
        {
          id: "isFavorite",
          type: "checkbox",
          label: t("documents.forms.newDocument.fields.isFavorite"),
          width: "1/2",
        },
        {
          id: "isShared",
          type: "checkbox",
          label: t("documents.forms.newDocument.fields.isShared"),
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
          type: "text",
          label: t("documents.forms.newArticle.fields.name"),
          placeholder: t("documents.forms.newArticle.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "description",
          type: "textarea",
          label: t("documents.forms.newArticle.fields.description"),
          placeholder: t("documents.forms.newArticle.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
        {
          id: "body",
          type: "textarea",
          label: t("documents.forms.newArticle.fields.body"),
          placeholder: t("documents.forms.newArticle.fields.bodyPlaceholder"),
          width: "full",
          rows: 6,
        },
        {
          id: "isPublished",
          type: "checkbox",
          label: t("documents.forms.newArticle.fields.isPublished"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const documentsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-document": newDocumentForm(t),
  "new-knowledge-article": newKnowledgeArticleForm(t),
})
