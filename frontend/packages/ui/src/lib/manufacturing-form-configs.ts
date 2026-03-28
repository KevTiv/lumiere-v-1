import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newManufacturingOrderForm = (t: TFunction): FormConfig => ({
  id: "new-manufacturing-order",
  title: t("manufacturing.forms.newManufacturingOrder.title"),
  description: t("manufacturing.forms.newManufacturingOrder.description"),
  sections: [
    {
      id: "mo-product",
      title: t("manufacturing.forms.newManufacturingOrder.sections.product"),
      fields: [
        {
          type: "select",
          name: "productId",
          id: "productId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.productId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.productIdPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          type: "number",
          name: "productQty",
          id: "productQty",
          label: t("manufacturing.forms.newManufacturingOrder.fields.productQty"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.productQtyPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          type: "select",
          name: "bomId",
          id: "bomId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.bomId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.bomIdPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
      ],
    },
    {
      id: "mo-routing",
      title: t("manufacturing.forms.newManufacturingOrder.sections.routing"),
      fields: [
        {
          type: "select",
          name: "warehouseId",
          id: "warehouseId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.warehouseId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.warehousePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          type: "select",
          name: "pickingTypeId",
          id: "pickingTypeId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.pickingTypeId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.pickingTypePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          type: "select",
          name: "locationSrcId",
          id: "locationSrcId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.locationSrcId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.locationPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          type: "select",
          name: "locationDestId",
          id: "locationDestId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.locationDestId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.locationPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
      ],
    },
    {
      id: "mo-schedule",
      title: t("manufacturing.forms.newManufacturingOrder.sections.scheduling"),
      fields: [
        {
          type: "date",
          name: "datePlannedStart",
          id: "datePlannedStart",
          label: t("manufacturing.forms.newManufacturingOrder.fields.datePlannedStart"),
          required: true,
          width: "1/2",
        },
        {
          type: "date",
          name: "datePlannedFinished",
          id: "datePlannedFinished",
          label: t("manufacturing.forms.newManufacturingOrder.fields.datePlannedFinished"),
          width: "1/2",
        },
      ],
    },
    {
      id: "mo-misc",
      title: t("manufacturing.forms.newManufacturingOrder.sections.other"),
      fields: [
        {
          type: "text",
          name: "origin",
          id: "origin",
          label: t("manufacturing.forms.newManufacturingOrder.fields.origin"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.originPlaceholder"),
          width: "1/2",
        },
        {
          type: "number",
          name: "routingId",
          id: "routingId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.routingId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.routingIdPlaceholder"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newBomForm = (t: TFunction): FormConfig => ({
  id: "new-bom",
  title: t("manufacturing.forms.newBom.title"),
  description: t("manufacturing.forms.newBom.description"),
  sections: [
    {
      id: "bom-product",
      title: t("manufacturing.forms.newBom.sections.product"),
      fields: [
        {
          type: "select",
          name: "productTmplId",
          id: "productTmplId",
          label: t("manufacturing.forms.newBom.fields.productTmplId"),
          placeholder: t("manufacturing.forms.newBom.fields.productTmplIdPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          type: "number",
          name: "productQty",
          id: "productQty",
          label: t("manufacturing.forms.newBom.fields.productQty"),
          placeholder: t("manufacturing.forms.newBom.fields.productQtyPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          type: "select",
          name: "type",
          id: "type",
          label: t("manufacturing.forms.newBom.fields.type"),
          required: true,
          width: "1/2",
          options: [
            { value: "Normal", label: t("manufacturing.forms.newBom.fields.options.Normal") },
            { value: "Phantom", label: t("manufacturing.forms.newBom.fields.options.Phantom") },
            { value: "Kit", label: t("manufacturing.forms.newBom.fields.options.Kit") },
            { value: "Subcontracting", label: t("manufacturing.forms.newBom.fields.options.Subcontracting") },
          ],
        },
        {
          type: "number",
          name: "routingId",
          id: "routingId",
          label: t("manufacturing.forms.newBom.fields.routingId"),
          placeholder: t("manufacturing.forms.newBom.fields.routingIdPlaceholder"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newWorkcenterForm = (t: TFunction): FormConfig => ({
  id: "new-workcenter",
  title: t("manufacturing.forms.newWorkcenter.title"),
  description: t("manufacturing.forms.newWorkcenter.description"),
  sections: [
    {
      id: "wc-general",
      title: t("manufacturing.forms.newWorkcenter.sections.general"),
      fields: [
        {
          type: "text",
          name: "name",
          id: "name",
          label: t("manufacturing.forms.newWorkcenter.fields.name"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          type: "text",
          name: "code",
          id: "code",
          label: t("manufacturing.forms.newWorkcenter.fields.code"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.codePlaceholder"),
          width: "1/2",
        },
        {
          type: "number",
          name: "capacity",
          id: "capacity",
          label: t("manufacturing.forms.newWorkcenter.fields.capacity"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.capacityPlaceholder"),
          width: "1/3",
        },
        {
          type: "number",
          name: "timeEfficiency",
          id: "timeEfficiency",
          label: t("manufacturing.forms.newWorkcenter.fields.timeEfficiency"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.timeEfficiencyPlaceholder"),
          width: "1/3",
        },
        {
          type: "number",
          name: "oeeTarget",
          id: "oeeTarget",
          label: t("manufacturing.forms.newWorkcenter.fields.oeeTarget"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.oeeTargetPlaceholder"),
          width: "1/3",
        },
      ],
    },
  ],
})

export const manufacturingFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-manufacturing-order": newManufacturingOrderForm(t),
  "new-bom": newBomForm(t),
  "new-workcenter": newWorkcenterForm(t),
})
