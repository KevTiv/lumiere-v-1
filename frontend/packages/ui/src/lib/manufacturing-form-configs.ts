import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

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
          type: "number",
          name: "productId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.productId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.productIdPlaceholder"),
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "productQty",
          label: t("manufacturing.forms.newManufacturingOrder.fields.productQty"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.productQtyPlaceholder"),
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "bomId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.bomId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.bomIdPlaceholder"),
          width: "half",
        },
        {
          type: "number",
          name: "productUomId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.productUomId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.productUomIdPlaceholder"),
          width: "half",
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
          label: t("manufacturing.forms.newManufacturingOrder.fields.datePlannedStart"),
          required: true,
          width: "half",
        },
        {
          type: "date",
          name: "datePlannedFinished",
          label: t("manufacturing.forms.newManufacturingOrder.fields.datePlannedFinished"),
          width: "half",
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
          label: t("manufacturing.forms.newManufacturingOrder.fields.origin"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.originPlaceholder"),
          width: "half",
        },
        {
          type: "number",
          name: "routingId",
          label: t("manufacturing.forms.newManufacturingOrder.fields.routingId"),
          placeholder: t("manufacturing.forms.newManufacturingOrder.fields.routingIdPlaceholder"),
          width: "half",
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
          type: "number",
          name: "productTmplId",
          label: t("manufacturing.forms.newBom.fields.productTmplId"),
          placeholder: t("manufacturing.forms.newBom.fields.productTmplIdPlaceholder"),
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "productQty",
          label: t("manufacturing.forms.newBom.fields.productQty"),
          placeholder: t("manufacturing.forms.newBom.fields.productQtyPlaceholder"),
          required: true,
          width: "half",
        },
        {
          type: "select",
          name: "type",
          label: t("manufacturing.forms.newBom.fields.type"),
          required: true,
          width: "half",
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
          label: t("manufacturing.forms.newBom.fields.routingId"),
          placeholder: t("manufacturing.forms.newBom.fields.routingIdPlaceholder"),
          width: "half",
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
          label: t("manufacturing.forms.newWorkcenter.fields.name"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.namePlaceholder"),
          required: true,
          width: "half",
        },
        {
          type: "text",
          name: "code",
          label: t("manufacturing.forms.newWorkcenter.fields.code"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.codePlaceholder"),
          width: "half",
        },
        {
          type: "number",
          name: "capacity",
          label: t("manufacturing.forms.newWorkcenter.fields.capacity"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.capacityPlaceholder"),
          width: "third",
        },
        {
          type: "number",
          name: "timeEfficiency",
          label: t("manufacturing.forms.newWorkcenter.fields.timeEfficiency"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.timeEfficiencyPlaceholder"),
          width: "third",
        },
        {
          type: "number",
          name: "oeeTarget",
          label: t("manufacturing.forms.newWorkcenter.fields.oeeTarget"),
          placeholder: t("manufacturing.forms.newWorkcenter.fields.oeeTargetPlaceholder"),
          width: "third",
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
