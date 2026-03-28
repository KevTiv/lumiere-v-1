import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

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
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("purchasing.forms.newPurchaseOrder.fields.partnerId"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.partnerPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("purchasing.forms.newPurchaseOrder.fields.pricelistId"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.pricelistPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "origin",
          name: "origin",
          type: "text",
          label: t("purchasing.forms.newPurchaseOrder.fields.origin"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.originPlaceholder"),
          width: "1/2",
        },
        {
          id: "partnerRef",
          name: "partnerRef",
          type: "text",
          label: t("purchasing.forms.newPurchaseOrder.fields.partnerRef"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.partnerRefPlaceholder"),
          width: "1/2",
        },
      ],
    },
    {
      id: "po-schedule",
      title: t("purchasing.forms.newPurchaseOrder.sections.schedule"),
      fields: [
        {
          id: "datePlanned",
          name: "datePlanned",
          type: "date",
          label: t("purchasing.forms.newPurchaseOrder.fields.datePlanned"),
          width: "1/2",
        },
        {
          id: "paymentTermId",
          name: "paymentTermId",
          type: "number",
          label: t("purchasing.forms.newPurchaseOrder.fields.paymentTermId"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.paymentTermPlaceholder"),
          width: "1/2",
        },
      ],
    },
    {
      id: "po-notes",
      title: t("purchasing.forms.newPurchaseOrder.sections.additionalInfo"),
      fields: [
        {
          id: "notes",
          name: "notes",
          type: "textarea",
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
          id: "vendorId",
          name: "vendorId",
          type: "select",
          label: t("purchasing.forms.newPurchaseRequisition.fields.vendorId"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.vendorPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "origin",
          name: "origin",
          type: "text",
          label: t("purchasing.forms.newPurchaseRequisition.fields.origin"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.originPlaceholder"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
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
          id: "orderingDate",
          name: "orderingDate",
          type: "date",
          label: t("purchasing.forms.newPurchaseRequisition.fields.orderingDate"),
          width: "1/3",
        },
        {
          id: "scheduleDate",
          name: "scheduleDate",
          type: "date",
          label: t("purchasing.forms.newPurchaseRequisition.fields.scheduleDate"),
          width: "1/3",
        },
        {
          id: "dateEnd",
          name: "dateEnd",
          type: "date",
          label: t("purchasing.forms.newPurchaseRequisition.fields.dateEnd"),
          width: "1/3",
        },
      ],
    },
  ],
})

export const purchasingFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-purchase-order": newPurchaseOrderForm(t),
  "new-purchase-requisition": newPurchaseRequisitionForm(t),
})
