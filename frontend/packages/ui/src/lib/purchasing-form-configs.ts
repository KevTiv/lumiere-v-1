import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newPurchaseOrderForm = (t: TFunction): FormConfig => ({
  id: "new-purchase-order",
  title: t("purchasing.forms.newPurchaseOrder.title"),
  description: t("purchasing.forms.newPurchaseOrder.description"),
  sections: [
    {
      id: "po-vendor",
      title: t("purchasing.forms.newPurchaseOrder.sections.vendor"),
      fields: [
        {
          type: "number",
          name: "partnerId",
          label: t("purchasing.forms.newPurchaseOrder.fields.partnerId"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.partnerPlaceholder"),
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "currencyId",
          label: t("purchasing.forms.newPurchaseOrder.fields.currencyId"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.currencyPlaceholder"),
          required: true,
          width: "half",
        },
        {
          type: "text",
          name: "origin",
          label: t("purchasing.forms.newPurchaseOrder.fields.origin"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.originPlaceholder"),
          width: "half",
        },
        {
          type: "text",
          name: "partnerRef",
          label: t("purchasing.forms.newPurchaseOrder.fields.partnerRef"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.partnerRefPlaceholder"),
          width: "half",
        },
      ],
    },
    {
      id: "po-schedule",
      title: t("purchasing.forms.newPurchaseOrder.sections.schedule"),
      fields: [
        {
          type: "date",
          name: "datePlanned",
          label: t("purchasing.forms.newPurchaseOrder.fields.datePlanned"),
          width: "half",
        },
        {
          type: "number",
          name: "paymentTermId",
          label: t("purchasing.forms.newPurchaseOrder.fields.paymentTermId"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.paymentTermPlaceholder"),
          width: "half",
        },
      ],
    },
    {
      id: "po-notes",
      title: t("purchasing.forms.newPurchaseOrder.sections.additionalInfo"),
      fields: [
        {
          type: "textarea",
          name: "notes",
          label: t("purchasing.forms.newPurchaseOrder.fields.notes"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.notesPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const newPurchaseRequisitionForm = (t: TFunction): FormConfig => ({
  id: "new-purchase-requisition",
  title: t("purchasing.forms.newPurchaseRequisition.title"),
  description: t("purchasing.forms.newPurchaseRequisition.description"),
  sections: [
    {
      id: "req-general",
      title: t("purchasing.forms.newPurchaseRequisition.sections.general"),
      fields: [
        {
          type: "number",
          name: "vendorId",
          label: t("purchasing.forms.newPurchaseRequisition.fields.vendorId"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.vendorPlaceholder"),
          width: "half",
        },
        {
          type: "text",
          name: "origin",
          label: t("purchasing.forms.newPurchaseRequisition.fields.origin"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.originPlaceholder"),
          width: "half",
        },
        {
          type: "textarea",
          name: "description",
          label: t("purchasing.forms.newPurchaseRequisition.fields.description"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.descriptionPlaceholder"),
          width: "full",
        },
      ],
    },
    {
      id: "req-dates",
      title: t("purchasing.forms.newPurchaseRequisition.sections.dates"),
      fields: [
        {
          type: "date",
          name: "orderingDate",
          label: t("purchasing.forms.newPurchaseRequisition.fields.orderingDate"),
          width: "third",
        },
        {
          type: "date",
          name: "scheduleDate",
          label: t("purchasing.forms.newPurchaseRequisition.fields.scheduleDate"),
          width: "third",
        },
        {
          type: "date",
          name: "dateEnd",
          label: t("purchasing.forms.newPurchaseRequisition.fields.dateEnd"),
          width: "third",
        },
      ],
    },
  ],
})

export const purchasingFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-purchase-order": newPurchaseOrderForm(t),
  "new-purchase-requisition": newPurchaseRequisitionForm(t),
})
