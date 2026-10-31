import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newPurchaseOrderForm = (t: TFunction): FormConfig => ({
  id: "new-purchase-order",
  customFieldCreateCapability: "atomic-configured-v1",
  title: t("purchasing.forms.newPurchaseOrder.title"),
  description: t("purchasing.forms.refinement.newOrderHelp", { defaultValue: "Choose the vendor and currency, save a draft, then add items and review quantities and costs before confirmation." }),
  submitLabel: t("purchasing.forms.refinement.saveDraft", { defaultValue: "Save draft" }),
  sections: [
    {
      id: "po-vendor",
      title: t("purchasing.forms.refinement.vendor", { defaultValue: "Vendor and references" }),
      fields: [
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("purchasing.forms.newPurchaseOrder.fields.partnerId"),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.partnerPlaceholder"),
          required: true,
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "partnerRef",
          name: "partnerRef",
          type: "text",
          label: t("purchasing.forms.refinement.vendorReference", { defaultValue: "Vendor reference" }),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.partnerRefPlaceholder"),
          width: "1/2",
        },
        {
          id: "origin",
          name: "origin",
          type: "text",
          label: t("purchasing.forms.refinement.origin", { defaultValue: "Source document reference" }),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.originPlaceholder"),
          description: t("purchasing.forms.refinement.originHelp", { defaultValue: "Optional reference to the request or source document for this purchase." }),
          width: "1/2",
        },
      ],
    },
    {
      id: "po-pricing",
      title: t("purchasing.forms.refinement.pricing", { defaultValue: "Pricing and payment" }),
      description: t("purchasing.forms.refinement.pricingHelp", { defaultValue: "The selected price list supplies the currency. Saving creates a draft; confirmation is a separate action." }),
      fields: [
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("purchasing.forms.refinement.pricelist", { defaultValue: "Price list and currency" }),
          placeholder: t("purchasing.forms.newPurchaseOrder.fields.pricelistPlaceholder"),
          required: true,
          description: t("purchasing.forms.refinement.pricelistHelp", { defaultValue: "Required. The price list supplies the currency for this purchase order." }),
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "paymentTermId",
          name: "paymentTermId",
          type: "select",
          label: t("purchasing.forms.newPurchaseOrder.fields.paymentTermId"),
          width: "1/2",
          options: [{ value: "", label: "—" }],
        },
      ],
    },
    {
      id: "po-schedule",
      title: t("purchasing.forms.refinement.delivery", { defaultValue: "Expected delivery" }),
      fields: [
        {
          id: "datePlanned",
          name: "datePlanned",
          type: "date",
          label: t("purchasing.forms.newPurchaseOrder.fields.datePlanned"),
          description: t("purchasing.forms.refinement.datePlannedHelp", { defaultValue: "Expected delivery date for the order." }),
          width: "1/2",
        },
      ],
    },
    {
      id: "po-notes",
      title: t("purchasing.forms.refinement.notes", { defaultValue: "Order notes" }),
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

export const editPurchaseOrderForm = (t: TFunction): FormConfig => ({
  id: "edit-purchase-order",
  title: t("purchasing.forms.editPurchaseOrder.title", {
    defaultValue: "Edit purchase order",
  }),
  description: t("purchasing.forms.editPurchaseOrder.description", {
    defaultValue: "Update draft purchase order header fields.",
  }),
  sections: [
    {
      id: "po-header",
      title: t("purchasing.forms.refinement.vendor", { defaultValue: "Vendor and references" }),
      fields: [
        {
          id: "orderId",
          name: "orderId",
          type: "select",
          label: t("purchasing.forms.editPurchaseOrder.fields.orderId", {
            defaultValue: "Purchase order",
          }),
          required: true,
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("purchasing.forms.newPurchaseOrder.fields.partnerId"),
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "partnerRef",
          name: "partnerRef",
          type: "text",
          label: t("purchasing.forms.newPurchaseOrder.fields.partnerRef"),
          width: "1/2",
        },
        {
          id: "origin",
          name: "origin",
          type: "text",
          label: t("purchasing.forms.newPurchaseOrder.fields.origin"),
          width: "1/2",
        },
      ],
    },
    {
      id: "po-schedule",
      title: t("purchasing.forms.refinement.deliveryPayment", { defaultValue: "Delivery and payment" }),
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
          type: "select",
          label: t("purchasing.forms.newPurchaseOrder.fields.paymentTermId"),
          width: "1/2",
          options: [{ value: "", label: "—" }],
        },
      ],
    },
    {
      id: "po-notes",
      title: t("purchasing.forms.refinement.notes", { defaultValue: "Order notes" }),
      description: t("purchasing.forms.refinement.editHelp", { defaultValue: "Blank fields keep their current values." }),
      fields: [
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("purchasing.forms.newPurchaseOrder.fields.notes"),
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
  submitLabel: t("purchasing.forms.refinement.saveRequest", { defaultValue: "Save purchase request" }),
  sections: [
    {
      id: "req-general",
      title: t("purchasing.forms.refinement.request", { defaultValue: "Purchase request" }),
      fields: [
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("purchasing.forms.newPurchaseRequisition.fields.description"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.descriptionPlaceholder"),
          width: "full",
        },
        {
          id: "vendorId",
          name: "vendorId",
          type: "select",
          label: t("purchasing.forms.newPurchaseRequisition.fields.vendorId"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.vendorPlaceholder"),
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "departmentId",
          name: "departmentId",
          type: "select",
          label: t("purchasing.forms.newPurchaseRequisition.fields.departmentId"),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.departmentPlaceholder"),
          width: "1/2",
          searchable: true,
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
      ],
    },
    {
      id: "req-line",
      title: t("purchasing.forms.refinement.requestedItem", { defaultValue: "Requested item and quantity" }),
      fields: [
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("purchasing.forms.newPurchaseRequisition.fields.productId", {
            defaultValue: "Product",
          }),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.productPlaceholder", {
            defaultValue: "Select product",
          }),
          width: "1/2",
          required: true,
          searchable: true,
          options: emptySelect,
        },
        {
          id: "uomId",
          name: "uomId",
          type: "select",
          label: t("purchasing.forms.newPurchaseRequisition.fields.uomId", {
            defaultValue: "UoM",
          }),
          placeholder: t("purchasing.forms.newPurchaseRequisition.fields.uomPlaceholder", {
            defaultValue: "Select UoM",
          }),
          width: "1/4",
          required: true,
          searchable: true,
          options: emptySelect,
        },
        {
          id: "quantity",
          name: "quantity",
          type: "quantity",
          validation: { min: 0.0001 },
          label: t("purchasing.forms.newPurchaseRequisition.fields.quantity", {
            defaultValue: "Quantity",
          }),
          width: "1/4",
          required: true,
        },
      ],
    },
    {
      id: "req-dates",
      title: t("purchasing.forms.refinement.requestDates", { defaultValue: "Request dates" }),
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
          searchable: true,
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
          searchable: true,
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
          searchable: true,
          options: emptySelect,
        },
        {
          id: "quantity",
          name: "quantity",
          type: "quantity",
          label: t("purchasing.forms.addPurchaseOrderLine.fields.quantity"),
          required: true,
          width: "1/2",
        },
        {
          id: "priceUnit",
          name: "priceUnit",
          type: "money",
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
          searchable: true,
          options: emptySelect,
        },
        {
          id: "qty",
          name: "qty",
          type: "quantity",
          label: t("purchasing.forms.receivePurchaseOrderLine.fields.qty"),
          required: true,
          width: "1/2",
        },
        {
          id: "lotId",
          name: "lotId",
          type: "text",
          inputMode: "numeric",
          label: t("purchasing.forms.refinement.lotReference", { defaultValue: "Lot / serial record reference" }),
          description: t("purchasing.forms.refinement.lotHelp", { defaultValue: "For tracked products, enter the existing lot or serial record reference. Leave blank for untracked items." }),
          required: false,
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
          searchable: true,
          options: emptySelect,
        },
        {
          id: "qty",
          name: "qty",
          type: "quantity",
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
          searchable: true,
          options: emptySelect,
        },
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.productId"),
          placeholder: t("purchasing.forms.editPurchaseOrderLine.fields.productPlaceholder"),
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "uomId",
          name: "uomId",
          type: "select",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.uomId"),
          placeholder: t("purchasing.forms.editPurchaseOrderLine.fields.uomPlaceholder"),
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "quantity",
          name: "quantity",
          type: "quantity",
          label: t("purchasing.forms.editPurchaseOrderLine.fields.quantity"),
          required: true,
          width: "1/2",
        },
        {
          id: "priceUnit",
          name: "priceUnit",
          type: "money",
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
          searchable: true,
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
          type: "select",
          label: t("purchasing.forms.newPartnerBank.fields.currencyId"),
          width: "1/2",
          searchable: true,
          options: emptySelect,
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
          searchable: true,
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

const splitMethodOptions = (t: TFunction) => [
  { value: "Equal", label: t("purchasing.forms.landedCostLine.splitMethods.Equal") },
  { value: "ByQuantity", label: t("purchasing.forms.landedCostLine.splitMethods.ByQuantity") },
  { value: "ByCurrentCost", label: t("purchasing.forms.landedCostLine.splitMethods.ByCurrentCost") },
  { value: "ByWeight", label: t("purchasing.forms.landedCostLine.splitMethods.ByWeight") },
  { value: "ByVolume", label: t("purchasing.forms.landedCostLine.splitMethods.ByVolume") },
]

export const newLandedCostForm = (t: TFunction): FormConfig => ({
  id: "new-landed-cost",
  title: t("purchasing.forms.newLandedCost.title"),
  description: t("purchasing.forms.newLandedCost.description"),
  sections: [
    {
      id: "lc-main",
      title: t("purchasing.forms.newLandedCost.sections.main"),
      fields: [
        {
          id: "pickingId",
          name: "pickingId",
          type: "select",
          label: t("purchasing.forms.newLandedCost.fields.pickingId"),
          placeholder: t("purchasing.forms.newLandedCost.fields.pickingPlaceholder"),
          required: true,
          width: "full",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "targetMove",
          name: "targetMove",
          type: "select",
          label: t("purchasing.forms.newLandedCost.fields.targetMove"),
          required: true,
          width: "1/2",
          defaultValue: "receipt",
          options: [
            { value: "receipt", label: t("purchasing.forms.newLandedCost.targetMoves.receipt") },
            { value: "posted", label: t("purchasing.forms.newLandedCost.targetMoves.posted") },
          ],
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("purchasing.forms.newLandedCost.fields.currencyId"),
          required: true,
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "amountTotal",
          name: "amountTotal",
          type: "money",
          label: t("purchasing.forms.newLandedCost.fields.amountTotal"),
          required: true,
          width: "1/2",
        },
        {
          id: "date",
          name: "date",
          type: "date",
          label: t("purchasing.forms.newLandedCost.fields.date"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("purchasing.forms.newLandedCost.fields.description"),
          placeholder: t("purchasing.forms.newLandedCost.fields.descriptionPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const editLandedCostForm = (t: TFunction): FormConfig => ({
  id: "edit-landed-cost",
  title: t("purchasing.forms.editLandedCost.title"),
  description: t("purchasing.forms.editLandedCost.description"),
  sections: [
    {
      id: "elc-main",
      title: t("purchasing.forms.editLandedCost.sections.main"),
      fields: [
        {
          id: "landedCostId",
          name: "landedCostId",
          type: "select",
          label: t("purchasing.forms.editLandedCost.fields.landedCostId"),
          placeholder: t("purchasing.forms.editLandedCost.fields.landedCostPlaceholder"),
          required: true,
          width: "full",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "targetMove",
          name: "targetMove",
          type: "select",
          label: t("purchasing.forms.editLandedCost.fields.targetMove"),
          width: "1/2",
          options: [
            { value: "", label: t("purchasing.forms.editLandedCost.fields.noChange") },
            { value: "receipt", label: t("purchasing.forms.newLandedCost.targetMoves.receipt") },
            { value: "posted", label: t("purchasing.forms.newLandedCost.targetMoves.posted") },
          ],
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("purchasing.forms.editLandedCost.fields.currencyId"),
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "amountTotal",
          name: "amountTotal",
          type: "money",
          label: t("purchasing.forms.editLandedCost.fields.amountTotal"),
          width: "1/2",
        },
        {
          id: "date",
          name: "date",
          type: "date",
          label: t("purchasing.forms.editLandedCost.fields.date"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("purchasing.forms.editLandedCost.fields.description"),
          width: "full",
        },
      ],
    },
  ],
})

export const addLandedCostLineForm = (t: TFunction): FormConfig => ({
  id: "add-landed-cost-line",
  title: t("purchasing.forms.landedCostLine.addTitle"),
  description: t("purchasing.forms.landedCostLine.addDescription"),
  sections: [
    {
      id: "lcl-header",
      title: t("purchasing.forms.landedCostLine.sections.landedCost"),
      fields: [
        {
          id: "landedCostId",
          name: "landedCostId",
          type: "select",
          label: t("purchasing.forms.landedCostLine.fields.landedCostId"),
          placeholder: t("purchasing.forms.landedCostLine.fields.landedCostPlaceholder"),
          required: true,
          width: "full",
          searchable: true,
          options: emptySelect,
        },
      ],
    },
    {
      id: "lcl-line",
      title: t("purchasing.forms.landedCostLine.sections.line"),
      fields: [
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("purchasing.forms.landedCostLine.fields.productId"),
          placeholder: t("purchasing.forms.landedCostLine.fields.productPlaceholder"),
          required: true,
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("purchasing.forms.landedCostLine.fields.currencyId"),
          required: true,
          width: "1/2",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "priceUnit",
          name: "priceUnit",
          type: "money",
          label: t("purchasing.forms.landedCostLine.fields.priceUnit"),
          required: true,
          width: "1/2",
        },
        {
          id: "splitMethod",
          name: "splitMethod",
          type: "select",
          label: t("purchasing.forms.landedCostLine.fields.splitMethod"),
          required: true,
          width: "1/2",
          defaultValue: "Equal",
          options: splitMethodOptions(t),
        },
      ],
    },
  ],
})

export const removeLandedCostLineForm = (t: TFunction): FormConfig => ({
  id: "remove-landed-cost-line",
  title: t("purchasing.forms.landedCostLine.removeTitle"),
  description: t("purchasing.forms.landedCostLine.removeDescription"),
  sections: [
    {
      id: "rlcl-line",
      title: t("purchasing.forms.landedCostLine.sections.remove"),
      fields: [
        {
          id: "lineId",
          name: "lineId",
          type: "select",
          label: t("purchasing.forms.landedCostLine.fields.lineId"),
          placeholder: t("purchasing.forms.landedCostLine.fields.lineIdPlaceholder"),
          required: true,
          width: "full",
          searchable: true,
          options: emptySelect,
        },
      ],
    },
  ],
})

export const newSupplierIntakeForm = (t: TFunction): FormConfig => ({
  id: "new-supplier-intake",
  title: t("purchasing.forms.newSupplierIntake.title"),
  description: t("purchasing.forms.newSupplierIntake.description"),
  sections: [
    {
      id: "si-company",
      title: t("purchasing.forms.newSupplierIntake.sections.company"),
      fields: [
        {
          id: "companyName",
          name: "companyName",
          type: "text",
          label: t("purchasing.forms.newSupplierIntake.fields.companyName"),
          required: true,
          width: "1/2",
        },
        {
          id: "contactName",
          name: "contactName",
          type: "text",
          label: t("purchasing.forms.newSupplierIntake.fields.contactName"),
          required: true,
          width: "1/2",
        },
        {
          id: "email",
          name: "email",
          type: "email",
          label: t("purchasing.forms.newSupplierIntake.fields.email"),
          required: true,
          width: "1/2",
        },
        {
          id: "phone",
          name: "phone",
          type: "tel",
          label: t("purchasing.forms.newSupplierIntake.fields.phone"),
          width: "1/2",
        },
        {
          id: "industry",
          name: "industry",
          type: "text",
          label: t("purchasing.forms.newSupplierIntake.fields.industry"),
          width: "1/2",
        },
        {
          id: "website",
          name: "website",
          type: "url",
          label: t("purchasing.forms.newSupplierIntake.fields.website"),
          width: "1/2",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("purchasing.forms.newSupplierIntake.fields.notes"),
          width: "full",
        },
      ],
    },
  ],
})

export const reviewSupplierIntakeForm = (t: TFunction): FormConfig => ({
  id: "review-supplier-intake",
  title: t("purchasing.forms.reviewSupplierIntake.title"),
  description: t("purchasing.forms.reviewSupplierIntake.description"),
  sections: [
    {
      id: "rsi-main",
      title: t("purchasing.forms.reviewSupplierIntake.sections.main"),
      fields: [
        {
          id: "intakeId",
          name: "intakeId",
          type: "select",
          label: t("purchasing.forms.reviewSupplierIntake.fields.intakeId"),
          placeholder: t("purchasing.forms.reviewSupplierIntake.fields.intakePlaceholder"),
          required: true,
          width: "full",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "reviewerNotes",
          name: "reviewerNotes",
          type: "textarea",
          label: t("purchasing.forms.reviewSupplierIntake.fields.reviewerNotes"),
          placeholder: t("purchasing.forms.reviewSupplierIntake.fields.reviewerNotesPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const editSupplierIntakeForm = (t: TFunction): FormConfig => ({
  id: "edit-supplier-intake",
  title: t("purchasing.forms.editSupplierIntake.title"),
  description: t("purchasing.forms.editSupplierIntake.description"),
  sections: [
    {
      id: "esi-main",
      title: t("purchasing.forms.editSupplierIntake.sections.main"),
      fields: [
        {
          id: "intakeId",
          name: "intakeId",
          type: "select",
          label: t("purchasing.forms.editSupplierIntake.fields.intakeId"),
          placeholder: t("purchasing.forms.editSupplierIntake.fields.intakePlaceholder"),
          required: true,
          width: "full",
          searchable: true,
          options: emptySelect,
        },
        {
          id: "companyName",
          name: "companyName",
          type: "text",
          label: t("purchasing.forms.editSupplierIntake.fields.companyName"),
          width: "1/2",
        },
        {
          id: "contactName",
          name: "contactName",
          type: "text",
          label: t("purchasing.forms.editSupplierIntake.fields.contactName"),
          width: "1/2",
        },
        {
          id: "email",
          name: "email",
          type: "email",
          label: t("purchasing.forms.editSupplierIntake.fields.email"),
          width: "1/2",
        },
        {
          id: "phone",
          name: "phone",
          type: "tel",
          label: t("purchasing.forms.editSupplierIntake.fields.phone"),
          width: "1/2",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("purchasing.forms.editSupplierIntake.fields.notes"),
          width: "full",
        },
      ],
    },
  ],
})

export const createBillFromPurchaseOrderForm = (t: TFunction): FormConfig => ({
  id: "create-bill-from-purchase-order",
  title: t("purchasing.forms.createBillFromOrder.title"),
  description: t("purchasing.forms.createBillFromOrder.description"),
  submitLabel: t("purchasing.forms.refinement.createDraftBill", { defaultValue: "Create draft bill" }),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "bill-details",
      title: t("purchasing.forms.refinement.billDetails", { defaultValue: "Bill date and adjustments" }),
      description: t("purchasing.forms.refinement.billDetailsHelp", { defaultValue: "Creates a draft vendor bill for this purchase order. Review the date, tax and discount before creating it." }),
      fields: [
        {
          id: "invoiceDate",
          name: "invoiceDate",
          type: "date",
          label: t("purchasing.forms.createBillFromOrder.fields.invoiceDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "taxId",
          name: "taxId",
          type: "select",
          label: t("purchasing.forms.createBillFromOrder.fields.taxId"),
          description: t("purchasing.forms.createBillFromOrder.fields.taxHint"),
          width: "1/2",
          searchable: true,
          options: [],
        },
        {
          id: "discount",
          name: "discount",
          type: "number",
          label: t("purchasing.forms.createBillFromOrder.fields.discount"),
          defaultValue: 0,
          min: 0,
          max: 100,
          width: "1/2",
        },
      ],
    },
    {
      id: "accounting",
      title: t("purchasing.forms.refinement.billAccounts", { defaultValue: "Purchase journal and accounts" }),
      description: t("purchasing.forms.refinement.billAccountsHelp", { defaultValue: "Review the journal, expense account and vendor payable account. Required choices stay visible." }),
      fields: [
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("purchasing.forms.createBillFromOrder.fields.journalId"),
          required: true,
          width: "1/2",
          searchable: true,
          options: [],
        },
        {
          id: "defaultExpenseAccountId",
          name: "defaultExpenseAccountId",
          type: "select",
          label: t("purchasing.forms.createBillFromOrder.fields.defaultExpenseAccountId"),
          required: true,
          width: "1/2",
          searchable: true,
          options: [],
        },
        {
          id: "payableAccountId",
          name: "payableAccountId",
          type: "select",
          label: t("purchasing.forms.createBillFromOrder.fields.payableAccountId"),
          required: true,
          width: "1/2",
          searchable: true,
          options: [],
        },
      ],
    },
    {
      id: "bill-notes",
      title: t("purchasing.forms.refinement.billNotes", { defaultValue: "Bill notes and ledger description" }),
      fields: [
        {
          id: "narration",
          name: "narration",
          type: "textarea",
          label: t("purchasing.forms.createBillFromOrder.fields.narration"),
          placeholder: t("purchasing.forms.createBillFromOrder.fields.narrationPlaceholder"),
          width: "full",
          rows: 3,
        },
        {
          id: "payableLineName",
          name: "payableLineName",
          type: "text",
          label: t("purchasing.forms.createBillFromOrder.fields.payableLineName"),
          width: "full",
        },
      ],
    },
    {
      id: "ledger-options",
      title: t("purchasing.forms.refinement.ledgerOptions", { defaultValue: "Specialist ledger line options" }),
      description: t("purchasing.forms.refinement.ledgerOptionsHelp", { defaultValue: "These settings affect payable line visibility and reconciliation. Keep the existing values unless your accountant requests a change." }),
      fields: [
        {
          id: "expenseBlocked",
          name: "expenseBlocked",
          type: "checkbox",
          label: t("purchasing.forms.createBillFromOrder.fields.expenseBlocked"),
          defaultValue: false,
        },
        {
          id: "payableExcludeFromInvoiceTab",
          name: "payableExcludeFromInvoiceTab",
          type: "checkbox",
          label: t("purchasing.forms.createBillFromOrder.fields.payableExcludeFromInvoiceTab"),
          defaultValue: true,
        },
        {
          id: "payableBlocked",
          name: "payableBlocked",
          type: "checkbox",
          label: t("purchasing.forms.createBillFromOrder.fields.payableBlocked"),
          defaultValue: false,
        },
      ],
    },
  ],
})

export const purchasingFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-purchase-order": newPurchaseOrderForm(t),
  "edit-purchase-order": editPurchaseOrderForm(t),
  "new-purchase-requisition": newPurchaseRequisitionForm(t),
  "add-purchase-order-line": addPurchaseOrderLineForm(t),
  "receive-purchase-order-line": receivePurchaseOrderLineForm(t),
  "invoice-purchase-order-line": invoicePurchaseOrderLineForm(t),
  "edit-purchase-order-line": editPurchaseOrderLineForm(t),
  "new-partner-bank": newPartnerBankForm(t),
  "edit-partner-bank": editPartnerBankForm(t),
  "new-landed-cost": newLandedCostForm(t),
  "edit-landed-cost": editLandedCostForm(t),
  "add-landed-cost-line": addLandedCostLineForm(t),
  "remove-landed-cost-line": removeLandedCostLineForm(t),
  "new-supplier-intake": newSupplierIntakeForm(t),
  "review-supplier-intake": reviewSupplierIntakeForm(t),
  "edit-supplier-intake": editSupplierIntakeForm(t),
  "create-bill-from-purchase-order": createBillFromPurchaseOrderForm(t),
})
