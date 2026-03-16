import type { FormConfig } from "./form-types"

export const newPurchaseOrderForm: FormConfig = {
  id: "new-purchase-order",
  title: "New Purchase Order",
  description: "Create a new request for quotation or purchase order",
  sections: [
    {
      id: "po-vendor",
      title: "Vendor",
      fields: [
        {
          type: "number",
          name: "partnerId",
          label: "Vendor",
          placeholder: "Vendor ID",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "currencyId",
          label: "Currency",
          placeholder: "Currency ID",
          required: true,
          width: "half",
        },
        {
          type: "text",
          name: "origin",
          label: "Source Document",
          placeholder: "e.g. SO-0042",
          width: "half",
        },
        {
          type: "text",
          name: "partnerRef",
          label: "Vendor Reference",
          placeholder: "Vendor's order number",
          width: "half",
        },
      ],
    },
    {
      id: "po-schedule",
      title: "Schedule",
      fields: [
        {
          type: "date",
          name: "datePlanned",
          label: "Expected Delivery",
          width: "half",
        },
        {
          type: "number",
          name: "paymentTermId",
          label: "Payment Terms",
          placeholder: "Payment term ID",
          width: "half",
        },
      ],
    },
    {
      id: "po-notes",
      title: "Additional Info",
      fields: [
        {
          type: "textarea",
          name: "notes",
          label: "Notes",
          placeholder: "Internal notes for this order…",
          width: "full",
        },
      ],
    },
  ],
}

export const newPurchaseRequisitionForm: FormConfig = {
  id: "new-purchase-requisition",
  title: "New Purchase Agreement",
  description: "Create a blanket order or purchase agreement",
  sections: [
    {
      id: "req-general",
      title: "General",
      fields: [
        {
          type: "number",
          name: "vendorId",
          label: "Vendor",
          placeholder: "Vendor ID",
          width: "half",
        },
        {
          type: "text",
          name: "origin",
          label: "Source Document",
          placeholder: "e.g. RFQ-0001",
          width: "half",
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
          placeholder: "Describe the agreement…",
          width: "full",
        },
      ],
    },
    {
      id: "req-dates",
      title: "Dates",
      fields: [
        {
          type: "date",
          name: "orderingDate",
          label: "Ordering Date",
          width: "third",
        },
        {
          type: "date",
          name: "scheduleDate",
          label: "Delivery Date",
          width: "third",
        },
        {
          type: "date",
          name: "dateEnd",
          label: "Agreement Deadline",
          width: "third",
        },
      ],
    },
  ],
}
