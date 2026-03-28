import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newSaleOrderForm = (t: TFunction): FormConfig => ({
  id: "new-sale-order",
  title: t("sales.forms.newSaleOrder.title"),
  description: t("sales.forms.newSaleOrder.description"),
  sections: [
    {
      id: "so-customer",
      title: t("sales.forms.newSaleOrder.sections.customer"),
      fields: [
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("sales.forms.newSaleOrder.fields.partnerId"),
          placeholder: t("sales.forms.newSaleOrder.fields.partnerPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "clientOrderRef",
          name: "clientOrderRef",
          type: "text",
          label: t("sales.forms.newSaleOrder.fields.clientOrderRef"),
          placeholder: t("sales.forms.newSaleOrder.fields.clientOrderRefPlaceholder"),
          width: "1/2",
        },
      ],
    },
    {
      id: "so-order",
      title: t("sales.forms.newSaleOrder.sections.orderDetails"),
      fields: [
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("sales.forms.newSaleOrder.fields.pricelistId"),
          placeholder: t("sales.forms.newSaleOrder.fields.pricelistPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "warehouseId",
          name: "warehouseId",
          type: "select",
          label: t("sales.forms.newSaleOrder.fields.warehouseId"),
          placeholder: t("sales.forms.newSaleOrder.fields.warehousePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "paymentTermId",
          name: "paymentTermId",
          type: "number",
          label: t("sales.forms.newSaleOrder.fields.paymentTermId"),
          placeholder: t("sales.forms.newSaleOrder.fields.paymentTermPlaceholder"),
          width: "1/2",
        },
        {
          id: "validityDate",
          name: "validityDate",
          type: "date",
          label: t("sales.forms.newSaleOrder.fields.validityDate"),
          width: "1/2",
        },
        {
          id: "commitmentDate",
          name: "commitmentDate",
          type: "date",
          label: t("sales.forms.newSaleOrder.fields.commitmentDate"),
          width: "1/2",
        },
      ],
    },
    {
      id: "so-notes",
      title: t("sales.forms.newSaleOrder.sections.notes"),
      fields: [
        {
          id: "note",
          name: "note",
          type: "textarea",
          label: t("sales.forms.newSaleOrder.fields.note"),
          placeholder: t("sales.forms.newSaleOrder.fields.notePlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const newPricelistForm = (t: TFunction): FormConfig => ({
  id: "new-pricelist",
  title: t("sales.forms.newPricelist.title"),
  description: t("sales.forms.newPricelist.description"),
  sections: [
    {
      id: "pl-info",
      title: t("sales.forms.newPricelist.sections.pricelistDetails"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("sales.forms.newPricelist.fields.name"),
          placeholder: t("sales.forms.newPricelist.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "number",
          label: t("sales.forms.newPricelist.fields.currencyId"),
          placeholder: t("sales.forms.newPricelist.fields.currencyPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "discountPolicy",
          name: "discountPolicy",
          type: "select",
          label: t("sales.forms.newPricelist.fields.discountPolicy"),
          width: "1/2",
          options: [
            { value: "WithoutDiscount", label: t("sales.forms.newPricelist.fields.options.WithoutDiscount") },
            { value: "WithDiscount", label: t("sales.forms.newPricelist.fields.options.WithDiscount") },
          ],
        },
      ],
    },
  ],
})

export const salesFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-sale-order": newSaleOrderForm(t),
  "new-pricelist": newPricelistForm(t),
})
