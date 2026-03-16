import type { FormConfig } from "./form-types"

export const newSaleOrderForm: FormConfig = {
  id: "new-sale-order",
  title: "New Sales Order",
  description: "Create a new sales order",
  sections: [
    {
      id: "so-customer",
      title: "Customer",
      fields: [
        {
          id: "partnerId",
          type: "number",
          label: "Customer ID",
          placeholder: "Partner ID",
          required: true,
          width: "1/2",
        },
        {
          id: "clientOrderRef",
          type: "text",
          label: "Customer Reference",
          placeholder: "PO-12345",
          width: "1/2",
        },
      ],
    },
    {
      id: "so-order",
      title: "Order Details",
      fields: [
        {
          id: "pricelistId",
          type: "number",
          label: "Pricelist ID",
          placeholder: "Pricelist",
          width: "1/2",
        },
        {
          id: "paymentTermId",
          type: "number",
          label: "Payment Terms ID",
          placeholder: "Payment Terms",
          width: "1/2",
        },
        {
          id: "validityDate",
          type: "date",
          label: "Expiration Date",
          width: "1/2",
        },
        {
          id: "commitmentDate",
          type: "date",
          label: "Delivery Date",
          width: "1/2",
        },
      ],
    },
    {
      id: "so-notes",
      title: "Notes",
      fields: [
        {
          id: "note",
          type: "textarea",
          label: "Terms & Notes",
          placeholder: "Internal notes or customer-facing terms",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const newPricelistForm: FormConfig = {
  id: "new-pricelist",
  title: "New Pricelist",
  description: "Create a pricing list for customers",
  sections: [
    {
      id: "pl-info",
      title: "Pricelist Details",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Name",
          placeholder: "e.g. Wholesale EUR",
          required: true,
          width: "1/2",
        },
        {
          id: "currencyId",
          type: "number",
          label: "Currency ID",
          placeholder: "Currency",
          required: true,
          width: "1/2",
        },
        {
          id: "discountPolicy",
          type: "select",
          label: "Discount Policy",
          width: "1/2",
          options: [
            { value: "WithoutDiscount", label: "Without Discount" },
            { value: "WithDiscount", label: "With Discount" },
          ],
        },
      ],
    },
  ],
}

export const salesFormConfigs: Record<string, FormConfig> = {
  "new-sale-order": newSaleOrderForm,
  "new-pricelist": newPricelistForm,
}
