import type { TFunction } from "i18next"
import type { FormConfig, HiddenField } from "./form-types"

/** Hidden scope field — submissions read `companyId` from form data. */
const companyIdHiddenField: HiddenField = {
  type: "hidden",
  id: "companyId",
  name: "companyId",
  defaultValue: "",
  required: true,
}

/** Prepends hidden `companyId` so mutations use `data.companyId` from the form builder. */
export function withCompanyIdField(config: FormConfig): FormConfig {
  if (config.sections.length === 0) return config
  const [first, ...rest] = config.sections
  return {
    ...config,
    sections: [{ ...first, fields: [companyIdHiddenField, ...first.fields] }, ...rest],
  }
}

/** Company picker — `showActions: false`; parent syncs via ModularForm `onValuesChange`. */
export function organizationCompanyPickerForm(t: TFunction): FormConfig {
  return {
    id: "settings-company-picker",
    title: "",
    hideTitle: true,
    showActions: false,
    sections: [
      {
        id: "pick",
        fields: [
          {
            type: "select",
            id: "companyId",
            name: "companyId",
            label: t("settings.organization.company.selectLabel"),
            required: true,
            options: [],
            width: "full",
            className: "max-w-md",
          },
        ],
      },
    ],
  }
}

/** Company legal name → `update_company` */
export function organizationCompanyLegalNameForm(t: TFunction): FormConfig {
  return {
    id: "settings-company-legal-name",
    title: "",
    hideTitle: true,
    submitLabel: t("settings.organization.company.saveName"),
    sections: [
      {
        id: "legal",
        fields: [
          {
            type: "text",
            id: "name",
            name: "name",
            label: t("settings.organization.company.legalName"),
            required: true,
            width: "full",
            validation: { minLength: 1 },
          },
        ],
      },
    ],
  }
}

/** Company registered address → `update_company_address` */
export function organizationCompanyAddressForm(t: TFunction): FormConfig {
  return {
    id: "settings-company-address",
    title: "",
    hideTitle: true,
    submitLabel: t("settings.organization.company.saveAddress"),
    sections: [
      {
        id: "addr",
        fields: [
          {
            type: "text",
            id: "addressStreet",
            name: "addressStreet",
            label: t("settings.organization.street"),
            placeholder: t("settings.organization.streetPlaceholder"),
            width: "full",
          },
          {
            type: "text",
            id: "addressCity",
            name: "addressCity",
            label: t("settings.organization.city"),
            placeholder: t("settings.organization.cityPlaceholder"),
            width: "1/2",
          },
          {
            type: "text",
            id: "addressZip",
            name: "addressZip",
            label: t("settings.organization.zip"),
            placeholder: t("settings.organization.zipPlaceholder"),
            width: "1/2",
          },
          {
            type: "text",
            id: "addressCountryCode",
            name: "addressCountryCode",
            label: t("settings.organization.country"),
            placeholder: t("settings.organization.countryPlaceholder"),
            width: "1/2",
          },
        ],
      },
    ],
  }
}

/** Tax / registry → `update_company_business` */
export function organizationCompanyBusinessForm(t: TFunction): FormConfig {
  return {
    id: "settings-company-business",
    title: "",
    hideTitle: true,
    submitLabel: t("settings.organization.company.saveBusiness"),
    sections: [
      {
        id: "biz",
        fields: [
          {
            type: "text",
            id: "taxId",
            name: "taxId",
            label: t("settings.organization.taxIdLabel"),
            width: "full",
          },
          {
            type: "text",
            id: "companyRegistry",
            name: "companyRegistry",
            label: t("settings.organization.registrationLabel"),
            width: "full",
          },
        ],
      },
    ],
  }
}

/** Parent / subsidiary link → `update_company_hierarchy` */
export function organizationCompanyHierarchyForm(t: TFunction): FormConfig {
  return {
    id: "settings-company-hierarchy",
    title: "",
    hideTitle: true,
    submitLabel: t("settings.organization.company.saveHierarchy"),
    sections: [
      {
        id: "hier",
        fields: [
          {
            type: "checkbox",
            id: "isParent",
            name: "isParent",
            label: t("settings.organization.company.isParent"),
            defaultValue: false,
            width: "full",
          },
          {
            type: "select",
            id: "parentId",
            name: "parentId",
            label: t("settings.organization.company.parentCompany"),
            options: [{ value: "__none__", label: t("settings.organization.company.noParent") }],
            width: "full",
          },
        ],
      },
    ],
  }
}

/** Create subsidiary → `create_company` */
export function organizationCompanyCreateForm(t: TFunction): FormConfig {
  return {
    id: "settings-company-create",
    title: "",
    hideTitle: true,
    submitLabel: t("settings.organization.company.createSubmit"),
    sections: [
      {
        id: "newco",
        fields: [
          {
            type: "text",
            id: "name",
            name: "name",
            label: t("settings.organization.company.newNamePlaceholder"),
            placeholder: t("settings.organization.company.newNamePlaceholder"),
            required: true,
            width: "1/2",
            validation: { minLength: 1 },
          },
          {
            type: "text",
            id: "code",
            name: "code",
            label: t("settings.organization.company.newCodePlaceholder"),
            placeholder: t("settings.organization.company.newCodePlaceholder"),
            width: "1/2",
          },
        ],
      },
    ],
  }
}

/** `create_data_classification` */
export function organizationPrivacyClassificationForm(t: TFunction): FormConfig {
  return {
    id: "settings-privacy-classification",
    title: "",
    hideTitle: true,
    submitLabel: t("common.submit"),
    sections: [
      {
        id: "dc",
        fields: [
          {
            type: "text",
            id: "name",
            name: "name",
            label: t("settings.organization.privacy.classificationName"),
            required: true,
            width: "full",
            validation: { minLength: 1 },
          },
          {
            type: "select",
            id: "level",
            name: "level",
            label: t("settings.organization.privacy.levelLabel"),
            required: true,
            defaultValue: "2",
            options: [
              { value: "1", label: "1 — Public" },
              { value: "2", label: "2 — Internal" },
              { value: "3", label: "3 — Confidential" },
              { value: "4", label: "4 — Restricted" },
            ],
            width: "1/2",
          },
          {
            type: "textarea",
            id: "description",
            name: "description",
            label: t("settings.organization.description"),
            width: "full",
            rows: 2,
          },
          {
            type: "number",
            id: "retentionDays",
            name: "retentionDays",
            label: t("settings.organization.privacy.retentionDaysLabel"),
            width: "1/2",
          },
          {
            type: "checkbox",
            id: "encryptionRequired",
            name: "encryptionRequired",
            label: t("settings.organization.privacy.encryptionRequiredLabel"),
            defaultValue: false,
            width: "1/2",
          },
        ],
      },
    ],
  }
}

/** `create_data_classification_rule` */
export function organizationPrivacyRuleForm(t: TFunction): FormConfig {
  return {
    id: "settings-privacy-rule",
    title: "",
    hideTitle: true,
    submitLabel: t("common.submit"),
    sections: [
      {
        id: "rule",
        fields: [
          {
            type: "text",
            id: "tableName",
            name: "tableName",
            label: t("settings.organization.privacy.tableNameLabel"),
            placeholder: t("settings.organization.privacy.tableNamePlaceholder"),
            required: true,
            width: "1/2",
            validation: { minLength: 1 },
          },
          {
            type: "text",
            id: "columnName",
            name: "columnName",
            label: t("settings.organization.privacy.columnNameLabel"),
            placeholder: t("settings.organization.privacy.columnNamePlaceholder"),
            width: "1/2",
          },
          {
            type: "select",
            id: "classificationId",
            name: "classificationId",
            label: t("settings.organization.privacy.classificationPickLabel"),
            required: true,
            options: [],
            width: "full",
          },
          {
            type: "select",
            id: "appliesTo",
            name: "appliesTo",
            label: t("settings.organization.privacy.appliesToLabel"),
            required: true,
            defaultValue: "all",
            options: [{ value: "all", label: t("settings.organization.privacy.appliesToAll") }],
            width: "1/2",
          },
        ],
      },
    ],
  }
}
