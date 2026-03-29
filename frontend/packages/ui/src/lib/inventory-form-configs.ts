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

export const newStockLocationForm = (t: TFunction): FormConfig => ({
  id: "new-stock-location",
  title: t("inventory.forms.newStockLocation.title"),
  description: t("inventory.forms.newStockLocation.description"),
  sections: [
    {
      id: "loc-main",
      title: t("inventory.forms.newStockLocation.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("inventory.forms.newStockLocation.fields.name"),
          placeholder: t("inventory.forms.newStockLocation.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "usage",
          name: "usage",
          type: "select",
          label: t("inventory.forms.newStockLocation.fields.usage"),
          required: true,
          width: "1/2",
          options: [
            { value: "internal", label: t("inventory.stockLocations.states.internal") },
            { value: "customer", label: t("inventory.stockLocations.states.customer") },
            { value: "supplier", label: t("inventory.stockLocations.states.supplier") },
            { value: "inventory", label: t("inventory.stockLocations.states.inventory") },
            { value: "transit", label: t("inventory.stockLocations.states.transit") },
            { value: "view", label: t("inventory.stockLocations.states.view") },
          ],
        },
        {
          id: "parentLocationId",
          name: "parentLocationId",
          type: "select",
          label: t("inventory.forms.newStockLocation.fields.parentLocationId"),
          width: "1/2",
          options: [{ value: "", label: t("inventory.forms.newStockLocation.fields.parentNone") }],
        },
        {
          id: "barcode",
          name: "barcode",
          type: "text",
          label: t("inventory.forms.newStockLocation.fields.barcode"),
          width: "full",
        },
      ],
    },
  ],
})

export const newWarehouseForm = (t: TFunction): FormConfig => ({
  id: "new-warehouse",
  title: t("inventory.forms.newWarehouse.title"),
  description: t("inventory.forms.newWarehouse.description"),
  sections: [
    {
      id: "wh-identity",
      title: t("inventory.forms.newWarehouse.sections.identity"),
      fields: [
        {
          id: "templateWarehouseId",
          name: "templateWarehouseId",
          type: "select",
          label: t("inventory.forms.newWarehouse.fields.templateWarehouseId"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("inventory.forms.newWarehouse.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("inventory.forms.newWarehouse.fields.code"),
          required: true,
          width: "1/2",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("inventory.forms.newWarehouse.fields.sequence"),
          width: "1/2",
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("inventory.forms.newWarehouse.fields.active"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const editWarehouseForm = (t: TFunction): FormConfig => ({
  id: "edit-warehouse",
  title: t("inventory.forms.editWarehouse.title"),
  description: t("inventory.forms.editWarehouse.description"),
  sections: [
    {
      id: "wh-edit",
      title: t("inventory.forms.editWarehouse.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("inventory.forms.editWarehouse.fields.name"),
          width: "1/2",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("inventory.forms.editWarehouse.fields.code"),
          width: "1/2",
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("inventory.forms.editWarehouse.fields.active"),
          width: "1/2",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("inventory.forms.editWarehouse.fields.sequence"),
          width: "1/2",
        },
        {
          id: "receptionSteps",
          name: "receptionSteps",
          type: "text",
          label: t("inventory.forms.editWarehouse.fields.receptionSteps"),
          width: "full",
        },
        {
          id: "deliverySteps",
          name: "deliverySteps",
          type: "text",
          label: t("inventory.forms.editWarehouse.fields.deliverySteps"),
          width: "full",
        },
        {
          id: "manufactureSteps",
          name: "manufactureSteps",
          type: "text",
          label: t("inventory.forms.editWarehouse.fields.manufactureSteps"),
          width: "full",
        },
        {
          id: "crossdock",
          name: "crossdock",
          type: "checkbox",
          label: t("inventory.forms.editWarehouse.fields.crossdock"),
          width: "1/2",
        },
        {
          id: "buyToResupply",
          name: "buyToResupply",
          type: "checkbox",
          label: t("inventory.forms.editWarehouse.fields.buyToResupply"),
          width: "1/2",
        },
        {
          id: "manufactureToResupply",
          name: "manufactureToResupply",
          type: "checkbox",
          label: t("inventory.forms.editWarehouse.fields.manufactureToResupply"),
          width: "1/2",
        },
        {
          id: "metadata",
          name: "metadata",
          type: "textarea",
          label: t("inventory.forms.editWarehouse.fields.metadata"),
          width: "full",
        },
      ],
    },
  ],
})

export const editProductForm = (t: TFunction): FormConfig => ({
  id: "edit-product",
  title: t("inventory.forms.editProduct.title"),
  description: t("inventory.forms.editProduct.description"),
  sections: [
    {
      id: "edit-product-main",
      title: t("inventory.forms.editProduct.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("inventory.forms.editProduct.fields.name"),
          width: "full",
        },
        {
          id: "defaultCode",
          name: "defaultCode",
          type: "text",
          label: t("inventory.forms.editProduct.fields.defaultCode"),
          width: "1/2",
        },
        {
          id: "standardPrice",
          name: "standardPrice",
          type: "number",
          label: t("inventory.forms.editProduct.fields.standardPrice"),
          width: "1/2",
        },
        {
          id: "listPrice",
          name: "listPrice",
          type: "number",
          label: t("inventory.forms.editProduct.fields.listPrice"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("inventory.forms.editProduct.fields.description"),
          width: "full",
        },
        {
          id: "saleOk",
          name: "saleOk",
          type: "checkbox",
          label: t("inventory.forms.editProduct.fields.saleOk"),
          width: "1/2",
        },
        {
          id: "purchaseOk",
          name: "purchaseOk",
          type: "checkbox",
          label: t("inventory.forms.editProduct.fields.purchaseOk"),
          width: "1/2",
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("inventory.forms.editProduct.fields.active"),
          width: "1/2",
        },
        {
          id: "isPublished",
          name: "isPublished",
          type: "checkbox",
          label: t("inventory.forms.editProduct.fields.isPublished"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const assignUserToPickingForm = (t: TFunction): FormConfig => ({
  id: "assign-user-picking",
  title: t("inventory.forms.assignUserToPicking.title"),
  description: t("inventory.forms.assignUserToPicking.description"),
  sections: [
    {
      id: "assign-user",
      title: t("inventory.forms.assignUserToPicking.sections.main"),
      fields: [
        {
          id: "userIdentity",
          name: "userIdentity",
          type: "select",
          label: t("inventory.forms.assignUserToPicking.fields.userIdentity"),
          required: false,
          width: "full",
          options: emptySelect,
        },
      ],
    },
  ],
})

export const newProductVariantForm = (t: TFunction): FormConfig => ({
  id: "new-product-variant",
  title: t("inventory.forms.newProductVariant.title"),
  description: t("inventory.forms.newProductVariant.description"),
  sections: [
    {
      id: "variant-main",
      title: t("inventory.forms.newProductVariant.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("inventory.forms.newProductVariant.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "standardPrice",
          name: "standardPrice",
          type: "number",
          label: t("inventory.forms.newProductVariant.fields.standardPrice"),
          required: true,
          width: "1/2",
        },
        {
          id: "lstPrice",
          name: "lstPrice",
          type: "number",
          label: t("inventory.forms.newProductVariant.fields.lstPrice"),
          required: true,
          width: "1/2",
        },
        {
          id: "defaultCode",
          name: "defaultCode",
          type: "text",
          label: t("inventory.forms.newProductVariant.fields.defaultCode"),
          width: "1/2",
        },
        {
          id: "barcode",
          name: "barcode",
          type: "text",
          label: t("inventory.forms.newProductVariant.fields.barcode"),
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
  "new-stock-location": newStockLocationForm(t),
  "new-warehouse": newWarehouseForm(t),
  "edit-warehouse": editWarehouseForm(t),
  "edit-product": editProductForm(t),
  "new-product-variant": newProductVariantForm(t),
  "assign-user-picking": assignUserToPickingForm(t),
})
