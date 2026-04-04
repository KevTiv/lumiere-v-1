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

/** Add a product line to a draft purchase order (calls `add_purchase_order_line`). */
export const addPurchaseOrderLineForm = (t: TFunction): FormConfig => ({
  id: "add-purchase-order-line",
  title: t("purchasing.forms.addPurchaseOrderLine.title"),
  description: t("purchasing.forms.addPurchaseOrderLine.description"),
  sections: [
    {
      id: "pol-order",
      title: t("purchasing.forms.addPurchaseOrderLine.sections.order"),
      fields: [
        {
          id: "orderId",
          name: "orderId",
          type: "select",
          label: t("purchasing.forms.addPurchaseOrderLine.fields.orderId"),
          placeholder: t("purchasing.forms.addPurchaseOrderLine.fields.orderPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
      ],
    },
    {
      id: "pol-product",
      title: t("purchasing.forms.addPurchaseOrderLine.sections.product"),
      fields: [
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("purchasing.forms.addPurchaseOrderLine.fields.productId"),
          placeholder: t("purchasing.forms.addPurchaseOrderLine.fields.productPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "uomId",
          name: "uomId",
          type: "select",
          label: t("purchasing.forms.addPurchaseOrderLine.fields.uomId"),
          placeholder: t("purchasing.forms.addPurchaseOrderLine.fields.uomPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "quantity",
          name: "quantity",
          type: "number",
          label: t("purchasing.forms.addPurchaseOrderLine.fields.quantity"),
          required: true,
          width: "1/2",
        },
        {
          id: "priceUnit",
          name: "priceUnit",
          type: "number",
          label: t("purchasing.forms.addPurchaseOrderLine.fields.priceUnit"),
          required: true,
          width: "1/2",
        },
      ],
    },
  ],
})

/** Record received quantity on a PO line (`receive_po_line`). */
export const receivePurchaseOrderLineForm = (t: TFunction): FormConfig => ({
  id: "receive-purchase-order-line",
  title: t("purchasing.forms.receivePurchaseOrderLine.title"),
  description: t("purchasing.forms.receivePurchaseOrderLine.description"),
  sections: [
    {
      id: "recv-line",
      title: t("purchasing.forms.receivePurchaseOrderLine.sections.line"),
      fields: [
        {
          id: "lineId",
          name: "lineId",
          type: "select",
          label: t("purchasing.forms.receivePurchaseOrderLine.fields.lineId"),
          placeholder: t("purchasing.forms.receivePurchaseOrderLine.fields.linePlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "qty",
          name: "qty",
          type: "number",
          label: t("purchasing.forms.receivePurchaseOrderLine.fields.qty"),
          required: true,
          width: "1/2",
        },
      ],
    },
  ],
})

/** Record invoiced quantity on a PO line (`invoice_po_line`). */
export const invoicePurchaseOrderLineForm = (t: TFunction): FormConfig => ({
  id: "invoice-purchase-order-line",
  title: t("purchasing.forms.invoicePurchaseOrderLine.title"),
  description: t("purchasing.forms.invoicePurchaseOrderLine.description"),
  sections: [
    {
      id: "inv-line",
      title: t("purchasing.forms.invoicePurchaseOrderLine.sections.line"),
      fields: [
        {
          id: "lineId",
          name: "lineId",
          type: "select",
          label: t("purchasing.forms.invoicePurchaseOrderLine.fields.lineId"),
          placeholder: t("purchasing.forms.invoicePurchaseOrderLine.fields.linePlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "qty",
          name: "qty",
          type: "number",
          label: t("purchasing.forms.invoicePurchaseOrderLine.fields.qty"),
          required: true,
          width: "1/2",
        },
      ],
    },
  ],
})

/** Update qty/price/product/UoM on a draft PO line (`update_purchase_order_line`). */
export const editPurchaseOrderLineForm = (t: TFunction): FormConfig => ({
  id: "edit-purchase-order-line",
  title: t("purchasing.forms.editPurchaseOrderLine.title"),
  description: t("purchasing.forms.editPurchaseOrderLine.description"),
  sections: [
    {
      id: "eol-line",
      title: t("purchasing.forms.editPurchaseOrderLine.sections.line"),
      fields: [
        {
          id: "lineId",
          name: "lineId",
          type: "select",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.lineId"),
          placeholder: t("purchasing.forms.editPurchaseOrderLine.fields.linePlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.productId"),
          placeholder: t("purchasing.forms.editPurchaseOrderLine.fields.productPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "uomId",
          name: "uomId",
          type: "select",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.uomId"),
          placeholder: t("purchasing.forms.editPurchaseOrderLine.fields.uomPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "quantity",
          name: "quantity",
          type: "number",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.quantity"),
          required: true,
          width: "1/2",
        },
        {
          id: "priceUnit",
          name: "priceUnit",
          type: "number",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.priceUnit"),
          required: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const newPartnerBankForm = (t: TFunction): FormConfig => ({
  id: "new-partner-bank",
  title: t("purchasing.forms.newPartnerBank.title"),
  description: t("purchasing.forms.newPartnerBank.description"),
  sections: [
    {
      id: "pb-main",
      title: t("purchasing.forms.newPartnerBank.sections.main"),
      fields: [
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("purchasing.forms.newPartnerBank.fields.partnerId"),
          placeholder: t("purchasing.forms.newPartnerBank.fields.partnerPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "accNumber",
          name: "accNumber",
          type: "text",
          label: t("purchasing.forms.newPartnerBank.fields.accNumber"),
          required: true,
          width: "full",
        },
        {
          id: "accHolderName",
          name: "accHolderName",
          type: "text",
          label: t("purchasing.forms.newPartnerBank.fields.accHolderName"),
          width: "1/2",
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "number",
          label: t("purchasing.forms.newPartnerBank.fields.currencyId"),
          width: "1/2",
        },
        {
          id: "allowOutPayment",
          name: "allowOutPayment",
          type: "checkbox",
          label: t("purchasing.forms.newPartnerBank.fields.allowOutPayment"),
          width: "full",
        },
      ],
    },
  ],
})

export const editPartnerBankForm = (t: TFunction): FormConfig => ({
  id: "edit-partner-bank",
  title: t("purchasing.forms.editPartnerBank.title"),
  description: t("purchasing.forms.editPartnerBank.description"),
  sections: [
    {
      id: "epb-main",
      title: t("purchasing.forms.editPartnerBank.sections.main"),
      fields: [
        {
          id: "bankId",
          name: "bankId",
          type: "select",
          label: t("purchasing.forms.editPartnerBank.fields.bankId"),
          placeholder: t("purchasing.forms.editPartnerBank.fields.bankPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "accNumber",
          name: "accNumber",
          type: "text",
          label: t("purchasing.forms.editPartnerBank.fields.accNumber"),
          width: "full",
        },
        {
          id: "accHolderName",
          name: "accHolderName",
          type: "text",
          label: t("purchasing.forms.editPartnerBank.fields.accHolderName"),
          width: "1/2",
        },
        {
          id: "allowOutPayment",
          name: "allowOutPayment",
          type: "checkbox",
          label: t("purchasing.forms.editPartnerBank.fields.allowOutPayment"),
          width: "1/3",
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("purchasing.forms.editPartnerBank.fields.active"),
          width: "1/3",
        },
      ],
    },
  ],
})

export const purchasingFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-purchase-order": newPurchaseOrderForm(t),
  "new-purchase-requisition": newPurchaseRequisitionForm(t),
  "add-purchase-order-line": addPurchaseOrderLineForm(t),
  "receive-purchase-order-line": receivePurchaseOrderLineForm(t),
  "invoice-purchase-order-line": invoicePurchaseOrderLineForm(t),
  "edit-purchase-order-line": editPurchaseOrderLineForm(t),
  "new-partner-bank": newPartnerBankForm(t),
  "edit-partner-bank": editPartnerBankForm(t),
})
