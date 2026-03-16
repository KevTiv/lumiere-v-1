import type { FormConfig } from "./form-types"

export const newProductForm: FormConfig = {
  id: "new-product",
  title: "New Product",
  description: "Add a product to the catalog",
  sections: [
    {
      id: "product-identity",
      title: "Identity",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Product Name",
          placeholder: "e.g. Widget Pro",
          required: true,
          width: "full",
        },
        {
          id: "defaultCode",
          type: "text",
          label: "Internal Reference (SKU)",
          placeholder: "WGT-001",
          width: "1/2",
        },
        {
          id: "type",
          type: "select",
          label: "Product Type",
          required: true,
          width: "1/2",
          options: [
            { value: "product", label: "Storable Product" },
            { value: "consu", label: "Consumable" },
            { value: "service", label: "Service" },
          ],
        },
      ],
    },
    {
      id: "product-pricing",
      title: "Pricing",
      fields: [
        {
          id: "standardPrice",
          type: "number",
          label: "Cost",
          placeholder: "0.00",
          width: "1/2",
        },
        {
          id: "saleOk",
          type: "checkbox",
          label: "Can be Sold",
          width: "1/2",
        },
        {
          id: "purchaseOk",
          type: "checkbox",
          label: "Can be Purchased",
          width: "1/2",
        },
      ],
    },
  ],
}

export const newTransferForm: FormConfig = {
  id: "new-transfer",
  title: "New Transfer",
  description: "Create a stock movement",
  sections: [
    {
      id: "transfer-info",
      title: "Transfer Details",
      fields: [
        {
          id: "pickingTypeId",
          type: "number",
          label: "Operation Type ID",
          required: true,
          width: "1/2",
        },
        {
          id: "locationId",
          type: "number",
          label: "Source Location ID",
          required: true,
          width: "1/2",
        },
        {
          id: "locationDestId",
          type: "number",
          label: "Destination Location ID",
          required: true,
          width: "1/2",
        },
        {
          id: "scheduledDate",
          type: "date",
          label: "Scheduled Date",
          width: "1/2",
        },
        {
          id: "origin",
          type: "text",
          label: "Source Document",
          placeholder: "SO-001",
          width: "full",
        },
      ],
    },
  ],
}

export const newInventoryAdjustmentForm: FormConfig = {
  id: "new-inventory-adjustment",
  title: "New Inventory Adjustment",
  description: "Start a physical inventory count",
  sections: [
    {
      id: "adj-info",
      title: "Adjustment Details",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Reference",
          placeholder: "INV/2026/001",
          required: true,
          width: "1/2",
        },
        {
          id: "date",
          type: "date",
          label: "Inventory Date",
          width: "1/2",
        },
      ],
    },
  ],
}

export const inventoryFormConfigs: Record<string, FormConfig> = {
  "new-product": newProductForm,
  "new-transfer": newTransferForm,
  "new-inventory-adjustment": newInventoryAdjustmentForm,
}
