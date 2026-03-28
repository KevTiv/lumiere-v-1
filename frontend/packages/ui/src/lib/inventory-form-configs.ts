import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

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
          name: "name",
          type: "text",
          label: t("inventory.forms.newProduct.fields.name"),
          placeholder: t("inventory.forms.newProduct.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "defaultCode",
          name: "defaultCode",
          type: "text",
          label: t("inventory.forms.newProduct.fields.defaultCode"),
          placeholder: t("inventory.forms.newProduct.fields.defaultCodePlaceholder"),
          width: "1/2",
        },
        {
          id: "type",
          name: "type",
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
      id: "product-classification",
      title: t("inventory.forms.newProduct.sections.classification"),
      fields: [
        {
          id: "categId",
          name: "categId",
          type: "select",
          label: t("inventory.forms.newProduct.fields.categId"),
          placeholder: t("inventory.forms.newProduct.fields.categIdPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "uomId",
          name: "uomId",
          type: "select",
          label: t("inventory.forms.newProduct.fields.uomId"),
          placeholder: t("inventory.forms.newProduct.fields.uomIdPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "uomPoId",
          name: "uomPoId",
          type: "select",
          label: t("inventory.forms.newProduct.fields.uomPoId"),
          placeholder: t("inventory.forms.newProduct.fields.uomPoPlaceholder"),
          required: false,
          width: "1/2",
          options: emptySelect,
        },
      ],
    },
    {
      id: "product-pricing",
      title: t("inventory.forms.newProduct.sections.pricing"),
      fields: [
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("inventory.forms.newProduct.fields.pricelistId"),
          placeholder: t("inventory.forms.newProduct.fields.pricelistPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "standardPrice",
          name: "standardPrice",
          type: "number",
          label: t("inventory.forms.newProduct.fields.standardPrice"),
          placeholder: t("inventory.forms.newProduct.fields.standardPricePlaceholder"),
          width: "1/2",
        },
        {
          id: "saleOk",
          name: "saleOk",
          type: "checkbox",
          label: t("inventory.forms.newProduct.fields.saleOk"),
          width: "1/2",
        },
        {
          id: "purchaseOk",
          name: "purchaseOk",
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
          name: "pickingTypeId",
          type: "select",
          label: t("inventory.forms.newTransfer.fields.pickingTypeId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "locationId",
          name: "locationId",
          type: "select",
          label: t("inventory.forms.newTransfer.fields.locationId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "locationDestId",
          name: "locationDestId",
          type: "select",
          label: t("inventory.forms.newTransfer.fields.locationDestId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "scheduledDate",
          name: "scheduledDate",
          type: "date",
          label: t("inventory.forms.newTransfer.fields.scheduledDate"),
          width: "1/2",
        },
        {
          id: "origin",
          name: "origin",
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
          name: "name",
          type: "text",
          label: t("inventory.forms.newInventoryAdjustment.fields.name"),
          placeholder: t("inventory.forms.newInventoryAdjustment.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "date",
          name: "date",
          type: "date",
          label: t("inventory.forms.newInventoryAdjustment.fields.date"),
          width: "1/2",
        },
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("inventory.forms.newInventoryAdjustment.fields.productId"),
          placeholder: t("inventory.forms.newInventoryAdjustment.fields.productPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "locationId",
          name: "locationId",
          type: "select",
          label: t("inventory.forms.newInventoryAdjustment.fields.locationId"),
          placeholder: t("inventory.forms.newInventoryAdjustment.fields.locationPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "inventoryQuantity",
          name: "inventoryQuantity",
          type: "number",
          label: t("inventory.forms.newInventoryAdjustment.fields.inventoryQuantity"),
          required: true,
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
