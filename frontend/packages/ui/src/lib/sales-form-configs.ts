import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

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
          type: "number",
          label: t("sales.forms.newSaleOrder.fields.partnerId"),
          placeholder: t("sales.forms.newSaleOrder.fields.partnerPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "clientOrderRef",
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
          type: "number",
          label: t("sales.forms.newSaleOrder.fields.pricelistId"),
          placeholder: t("sales.forms.newSaleOrder.fields.pricelistPlaceholder"),
          width: "1/2",
        },
        {
          id: "paymentTermId",
          type: "number",
          label: t("sales.forms.newSaleOrder.fields.paymentTermId"),
          placeholder: t("sales.forms.newSaleOrder.fields.paymentTermPlaceholder"),
          width: "1/2",
        },
        {
          id: "validityDate",
          type: "date",
          label: t("sales.forms.newSaleOrder.fields.validityDate"),
          width: "1/2",
        },
        {
          id: "commitmentDate",
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
          type: "text",
          label: t("sales.forms.newPricelist.fields.name"),
          placeholder: t("sales.forms.newPricelist.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "currencyId",
          type: "number",
          label: t("sales.forms.newPricelist.fields.currencyId"),
          placeholder: t("sales.forms.newPricelist.fields.currencyPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "discountPolicy",
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
