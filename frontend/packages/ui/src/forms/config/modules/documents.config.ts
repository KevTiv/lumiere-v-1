
import { i18n } from "@lumiere/i18n"
//! Documents Module Form Configurations
//!
//! This module provides form configurations for Documents.
//! Includes forms for: Documents, Folders

import type { FormRegistryEntry } from "../types"

export const documentsForms: FormRegistryEntry[] = [
  // Document Upload Form
  {
    moduleId: "documents",
    formId: "new-document",
    get name() { return i18n.t("forms.defaults.documents.newDocument") },
    get description() { return i18n.t("forms.defaults.documents.uploadANewDocument") },
    icon: "File",
    get category() { return i18n.t("forms.defaults.documents.documents") },
    defaultConfig: () => ({
      moduleId: "documents",
      formId: "new-document",
      get name() { return i18n.t("forms.defaults.documents.newDocument") },
      get description() { return i18n.t("forms.defaults.documents.uploadANewDocument") },
      isSystemDefault: true,
      fields: [
        {
          fieldId: "title",
          name: "title",
          get label() { return i18n.t("settings.ai.insightTitleField") },
          fieldType: "Text",
          get placeholder() { return i18n.t("forms.defaults.documents.documentTitle") },
          validation: { required: true, minLength: 2 },
          aiSuggestions: [],
          order: 1,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Full",
        },
        {
          fieldId: "description",
          name: "description",
          get label() { return i18n.t("settings.ai.description") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("forms.defaults.documents.documentDescription") },
          validation: { required: false },
          aiSuggestions: [],
          order: 2,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "category",
          name: "category",
          get label() { return i18n.t("documents.forms.newCategory.sections.category") },
          fieldType: "Select",
          options: [
            { value: "contract", get label() { return i18n.t("forms.defaults.documents.contract") }, color: "blue" },
            { value: "invoice", get label() { return i18n.t("forms.defaults.documents.invoice") }, color: "green" },
            { value: "report", get label() { return i18n.t("forms.defaults.documents.report") }, color: "purple" },
            { value: "policy", get label() { return i18n.t("forms.defaults.documents.policy") }, color: "orange" },
            { value: "manual", get label() { return i18n.t("forms.defaults.documents.manual") }, color: "teal" },
            { value: "other", get label() { return i18n.t("common.entityView.otherColumn") }, color: "gray" },
          ],
          validation: { required: false },
          aiSuggestions: [],
          order: 3,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Half",
        },
        {
          fieldId: "tags",
          name: "tags",
          get label() { return i18n.t("settings.formConfig.fieldDialog.fieldTypes.Tags") },
          fieldType: "Tags",
          validation: { required: false },
          aiSuggestions: [],
          order: 4,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
      ],
      roleConfigs: {
        "role-admin": {
          roleId: "role-admin",
          enabledFields: ["title", "description", "category", "tags"],
          requiredFields: ["title"],
          defaultPrompts: [],
        },
        "role-manager": {
          roleId: "role-manager",
          enabledFields: ["title", "description", "category", "tags"],
          requiredFields: ["title"],
          defaultPrompts: [],
        },
      },
    }),
  },

  // Folder Form
  {
    moduleId: "documents",
    formId: "new-folder",
    get name() { return i18n.t("forms.defaults.documents.newFolder") },
    get description() { return i18n.t("forms.defaults.documents.createANewFolder") },
    icon: "FolderPlus",
    get category() { return i18n.t("forms.defaults.documents.folders") },
    defaultConfig: () => ({
      moduleId: "documents",
      formId: "new-folder",
      get name() { return i18n.t("forms.defaults.documents.newFolder") },
      get description() { return i18n.t("forms.defaults.documents.createANewFolder") },
      isSystemDefault: true,
      fields: [
        {
          fieldId: "name",
          name: "name",
          get label() { return i18n.t("forms.defaults.documents.folderName") },
          fieldType: "Text",
          get placeholder() { return i18n.t("forms.defaults.documents.enterFolderName") },
          validation: { required: true, minLength: 1 },
          aiSuggestions: [],
          order: 1,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Full",
        },
        {
          fieldId: "description",
          name: "description",
          get label() { return i18n.t("settings.ai.description") },
          fieldType: "Textarea",
          validation: { required: false },
          aiSuggestions: [],
          order: 2,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
      ],
      roleConfigs: {
        "role-admin": {
          roleId: "role-admin",
          enabledFields: ["name", "description"],
          requiredFields: ["name"],
          defaultPrompts: [],
        },
        "role-manager": {
          roleId: "role-manager",
          enabledFields: ["name", "description"],
          requiredFields: ["name"],
          defaultPrompts: [],
        },
      },
    }),
  },
]
