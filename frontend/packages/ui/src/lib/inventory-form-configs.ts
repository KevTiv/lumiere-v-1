import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newProductForm = (t: TFunction): FormConfig => ({
  id: "new-product",
  title: t("inventory.forms.newProduct.title"),
  description: t("inventory.forms.newProduct.description"),
  sections: [
    {
      id: "product-identity",
      title: t("inventory.forms.newProduct.sections.identity"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("inventory.forms.newProduct.fields.name"),
          placeholder: t("inventory.forms.newProduct.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "defaultCode",
          type: "text",
          label: t("inventory.forms.newProduct.fields.defaultCode"),
          placeholder: t("inventory.forms.newProduct.fields.defaultCodePlaceholder"),
          width: "1/2",
        },
        {
          id: "type",
          type: "select",
          label: t("inventory.forms.newProduct.fields.type"),
          required: true,
          width: "1/2",
          options: [
            { value: "product", label: t("inventory.forms.newProduct.fields.options.product") },
            { value: "consu", label: t("inventory.forms.newProduct.fields.options.consu") },
            { value: "service", label: t("inventory.forms.newProduct.fields.options.service") },
          ],
        },
      ],
    },
    {
      id: "product-pricing",
      title: t("inventory.forms.newProduct.sections.pricing"),
      fields: [
        {
          id: "standardPrice",
          type: "number",
          label: t("inventory.forms.newProduct.fields.standardPrice"),
          placeholder: t("inventory.forms.newProduct.fields.standardPricePlaceholder"),
          width: "1/2",
        },
        {
          id: "saleOk",
          type: "checkbox",
          label: t("inventory.forms.newProduct.fields.saleOk"),
          width: "1/2",
        },
        {
          id: "purchaseOk",
          type: "checkbox",
          label: t("inventory.forms.newProduct.fields.purchaseOk"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newTransferForm = (t: TFunction): FormConfig => ({
  id: "new-transfer",
  title: t("inventory.forms.newTransfer.title"),
  description: t("inventory.forms.newTransfer.description"),
  sections: [
    {
      id: "transfer-info",
      title: t("inventory.forms.newTransfer.sections.transferDetails"),
      fields: [
        {
          id: "pickingTypeId",
          type: "number",
          label: t("inventory.forms.newTransfer.fields.pickingTypeId"),
          required: true,
          width: "1/2",
        },
        {
          id: "locationId",
          type: "number",
          label: t("inventory.forms.newTransfer.fields.locationId"),
          required: true,
          width: "1/2",
        },
        {
          id: "locationDestId",
          type: "number",
          label: t("inventory.forms.newTransfer.fields.locationDestId"),
          required: true,
          width: "1/2",
        },
        {
          id: "scheduledDate",
          type: "date",
          label: t("inventory.forms.newTransfer.fields.scheduledDate"),
          width: "1/2",
        },
        {
          id: "origin",
          type: "text",
          label: t("inventory.forms.newTransfer.fields.origin"),
          placeholder: t("inventory.forms.newTransfer.fields.originPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const newInventoryAdjustmentForm = (t: TFunction): FormConfig => ({
  id: "new-inventory-adjustment",
  title: t("inventory.forms.newInventoryAdjustment.title"),
  description: t("inventory.forms.newInventoryAdjustment.description"),
  sections: [
    {
      id: "adj-info",
      title: t("inventory.forms.newInventoryAdjustment.sections.adjustmentDetails"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("inventory.forms.newInventoryAdjustment.fields.name"),
          placeholder: t("inventory.forms.newInventoryAdjustment.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "date",
          type: "date",
          label: t("inventory.forms.newInventoryAdjustment.fields.date"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const inventoryFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-product": newProductForm(t),
  "new-transfer": newTransferForm(t),
  "new-inventory-adjustment": newInventoryAdjustmentForm(t),
})
