import type { FormConfig } from "@lumiere/ui"
import type { TFunction } from "i18next"

export const getNewOrderForm = (t: TFunction): FormConfig => ({
  id: "new-order",
  title: t("demo.forms.newOrder.title"),
  description: t("demo.forms.newOrder.description"),
  submitLabel: t("demo.forms.newOrder.submit"),
  cancelLabel: t("demo.forms.newOrder.cancel"),
  showReset: true,
  sections: [
    {
      id: "customer-info",
      title: t("demo.forms.newOrder.sections.customerInfo"),
      fields: [
        {
          id: "customer-name",
          name: "customerName",
          type: "text",
          label: t("demo.forms.newOrder.fields.customerName"),
          placeholder: t("demo.forms.newOrder.fields.customerPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "customer-email",
          name: "customerEmail",
          type: "email",
          label: t("demo.forms.newOrder.fields.email"),
          placeholder: t("demo.forms.newOrder.fields.emailPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "customer-phone",
          name: "customerPhone",
          type: "tel",
          label: t("demo.forms.newOrder.fields.phone"),
          placeholder: t("demo.forms.newOrder.fields.phonePlaceholder"),
          width: "1/2",
        },
        {
          id: "customer-company",
          name: "customerCompany",
          type: "text",
          label: t("demo.forms.newOrder.fields.company"),
          placeholder: t("demo.forms.newOrder.fields.companyPlaceholder"),
          width: "1/2",
        },
      ],
    },
    {
      id: "order-details",
      title: t("demo.forms.newOrder.sections.orderDetails"),
      fields: [
        {
          id: "product",
          name: "product",
          type: "select",
          label: t("demo.forms.newOrder.fields.product"),
          placeholder: t("demo.forms.newOrder.fields.productPlaceholder"),
          required: true,
          width: "1/2",
          options: [
            { value: "enterprise", label: t("demo.forms.newOrder.options.products.enterprise") },
            { value: "professional", label: t("demo.forms.newOrder.options.products.professional") },
            { value: "starter", label: t("demo.forms.newOrder.options.products.starter") },
            { value: "addon-a", label: t("demo.forms.newOrder.options.products.addonA") },
            { value: "support", label: t("demo.forms.newOrder.options.products.support") },
          ],
        },
        {
          id: "quantity",
          name: "quantity",
          type: "number",
          label: t("demo.forms.newOrder.fields.quantity"),
          placeholder: "1",
          required: true,
          width: "1/4",
          defaultValue: 1,
          validation: { min: 1, max: 100 },
        },
        {
          id: "priority",
          name: "priority",
          type: "select",
          label: t("demo.forms.newOrder.fields.priority"),
          width: "1/4",
          defaultValue: "normal",
          options: [
            { value: "low", label: t("demo.forms.newOrder.options.priority.low") },
            { value: "normal", label: t("demo.forms.newOrder.options.priority.normal") },
            { value: "high", label: t("demo.forms.newOrder.options.priority.high") },
            { value: "urgent", label: t("demo.forms.newOrder.options.priority.urgent") },
          ],
        },
        {
          id: "billing-cycle",
          name: "billingCycle",
          type: "radio",
          label: t("demo.forms.newOrder.fields.billingCycle"),
          width: "full",
          defaultValue: "monthly",
          options: [
            { value: "monthly", label: t("demo.forms.newOrder.options.billing.monthly") },
            { value: "quarterly", label: t("demo.forms.newOrder.options.billing.quarterly") },
            { value: "annual", label: t("demo.forms.newOrder.options.billing.annual") },
          ],
          layout: "horizontal",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("demo.forms.newOrder.fields.orderNotes"),
          placeholder: t("demo.forms.newOrder.fields.notesPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
    {
      id: "options",
      title: t("demo.forms.newOrder.sections.options"),
      fields: [
        {
          id: "express-shipping",
          name: "expressShipping",
          type: "switch",
          label: t("demo.forms.newOrder.fields.expressShipping"),
          width: "1/2",
        },
        {
          id: "gift-wrap",
          name: "giftWrap",
          type: "switch",
          label: t("demo.forms.newOrder.fields.giftWrap"),
          width: "1/2",
        },
        {
          id: "terms",
          name: "termsAccepted",
          type: "checkbox",
          label: t("demo.forms.newOrder.fields.terms"),
          required: true,
          width: "full",
        },
        {
          id: "newsletter",
          name: "newsletter",
          type: "checkbox",
          label: t("demo.forms.newOrder.fields.newsletter"),
          width: "full",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const getNewCustomerForm = (t: TFunction): FormConfig => ({
  id: "new-customer",
  title: t("demo.forms.newCustomer.title"),
  description: t("demo.forms.newCustomer.description"),
  submitLabel: t("demo.forms.newCustomer.submit"),
  cancelLabel: t("demo.forms.newCustomer.cancel"),
  sections: [
    {
      id: "basic-info",
      title: t("demo.forms.newCustomer.sections.basicInfo"),
      fields: [
        {
          id: "first-name",
          name: "firstName",
          type: "text",
          label: t("demo.forms.newCustomer.fields.firstName"),
          placeholder: t("demo.forms.newCustomer.fields.firstPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "last-name",
          name: "lastName",
          type: "text",
          label: t("demo.forms.newCustomer.fields.lastName"),
          placeholder: t("demo.forms.newCustomer.fields.lastPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "email",
          name: "email",
          type: "email",
          label: t("demo.forms.newCustomer.fields.email"),
          placeholder: t("demo.forms.newCustomer.fields.emailPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "phone",
          name: "phone",
          type: "tel",
          label: t("demo.forms.newCustomer.fields.phone"),
          placeholder: t("demo.forms.newCustomer.fields.phonePlaceholder"),
          width: "1/2",
        },
      ],
    },
    {
      id: "company-info",
      title: t("demo.forms.newCustomer.sections.companyInfo"),
      fields: [
        {
          id: "company",
          name: "company",
          type: "text",
          label: t("demo.forms.newCustomer.fields.company"),
          placeholder: t("demo.forms.newCustomer.fields.companyPlaceholder"),
          width: "1/2",
        },
        {
          id: "industry",
          name: "industry",
          type: "select",
          label: t("demo.forms.newCustomer.fields.industry"),
          width: "1/2",
          options: [
            { value: "tech", label: t("demo.forms.newCustomer.options.industry.tech") },
            { value: "finance", label: t("demo.forms.newCustomer.options.industry.finance") },
            { value: "healthcare", label: t("demo.forms.newCustomer.options.industry.healthcare") },
            { value: "retail", label: t("demo.forms.newCustomer.options.industry.retail") },
            { value: "manufacturing", label: t("demo.forms.newCustomer.options.industry.manufacturing") },
            { value: "other", label: t("demo.forms.newCustomer.options.industry.other") },
          ],
        },
        {
          id: "website",
          name: "website",
          type: "url",
          label: t("demo.forms.newCustomer.fields.website"),
          placeholder: t("demo.forms.newCustomer.fields.websitePlaceholder"),
          width: "full",
        },
      ],
    },
    {
      id: "preferences",
      title: t("demo.forms.newCustomer.sections.preferences"),
      fields: [
        {
          id: "contact-method",
          name: "contactMethod",
          type: "radio",
          label: t("demo.forms.newCustomer.fields.contactMethod"),
          width: "full",
          defaultValue: "email",
          options: [
            { value: "email", label: t("demo.forms.newCustomer.options.contactMethod.email") },
            { value: "phone", label: t("demo.forms.newCustomer.options.contactMethod.phone") },
            { value: "sms", label: t("demo.forms.newCustomer.options.contactMethod.sms") },
          ],
          layout: "horizontal",
        },
        {
          id: "marketing",
          name: "marketingConsent",
          type: "switch",
          label: t("demo.forms.newCustomer.fields.marketing"),
          width: "full",
        },
      ],
    },
  ],
})

export const getReportForm = (t: TFunction): FormConfig => ({
  id: "generate-report",
  title: t("demo.forms.generateReport.title"),
  description: t("demo.forms.generateReport.description"),
  submitLabel: t("demo.forms.generateReport.submit"),
  cancelLabel: t("demo.forms.generateReport.cancel"),
  sections: [
    {
      id: "report-config",
      fields: [
        {
          id: "report-type",
          name: "reportType",
          type: "select",
          label: t("demo.forms.generateReport.fields.reportType"),
          required: true,
          width: "1/2",
          options: [
            { value: "sales", label: t("demo.forms.generateReport.options.reportTypes.sales") },
            { value: "inventory", label: t("demo.forms.generateReport.options.reportTypes.inventory") },
            { value: "customers", label: t("demo.forms.generateReport.options.reportTypes.customers") },
            { value: "financial", label: t("demo.forms.generateReport.options.reportTypes.financial") },
          ],
        },
        {
          id: "format",
          name: "format",
          type: "select",
          label: t("demo.forms.generateReport.fields.format"),
          required: true,
          width: "1/2",
          defaultValue: "pdf",
          options: [
            { value: "pdf", label: t("demo.forms.generateReport.options.formats.pdf") },
            { value: "excel", label: t("demo.forms.generateReport.options.formats.excel") },
            { value: "csv", label: t("demo.forms.generateReport.options.formats.csv") },
          ],
        },
        {
          id: "date-from",
          name: "dateFrom",
          type: "date",
          label: t("demo.forms.generateReport.fields.fromDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "date-to",
          name: "dateTo",
          type: "date",
          label: t("demo.forms.generateReport.fields.toDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "include-charts",
          name: "includeCharts",
          type: "switch",
          label: t("demo.forms.generateReport.fields.includeCharts"),
          width: "1/2",
          defaultValue: true,
        },
        {
          id: "include-summary",
          name: "includeSummary",
          type: "switch",
          label: t("demo.forms.generateReport.fields.includeSummary"),
          width: "1/2",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const getFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-order": getNewOrderForm(t),
  "new-customer": getNewCustomerForm(t),
  "generate-report": getReportForm(t),
})

// Backward compatibility exports
import { i18n } from "@lumiere/i18n"
export const newOrderForm = getNewOrderForm(i18n.t.bind(i18n))
export const newCustomerForm = getNewCustomerForm(i18n.t.bind(i18n))
export const reportForm = getReportForm(i18n.t.bind(i18n))
export const formConfigs: Record<string, FormConfig> = {
  "new-order": newOrderForm,
  "new-customer": newCustomerForm,
  "generate-report": reportForm,
}