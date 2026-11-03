import type { ChatContext } from "../lib/ai-chat-types"

/** Suggestions prepare editable questions; they never execute an ERP action. */
export const assistantStarters = {
  pageHelp: {
    label: "Explain this page",
    prompt: "Explain what I can do on the current page and where to start.",
    icon: "help-circle",
  },
  nextSteps: {
    label: "Choose my next step",
    prompt: "Help me choose the next useful task in this workspace. Explain any required setup first.",
    icon: "check-square",
  },
  draftHelp: {
    label: "Help prepare a draft",
    prompt: "Walk me through preparing a draft in this workspace, including what I should review before saving.",
    icon: "edit",
  },
  importReview: {
    label: "Understand import review",
    prompt: "Explain how to review and correct imported records on this page, including what needs my confirmation.",
    icon: "check-square",
  },
  sourceHistory: {
    label: "Understand source history",
    prompt: "Explain the difference between saved source history, confirmed source rows and imported business records.",
    icon: "book-open",
  },
  importHelp: {
    label: "Prepare an import",
    prompt: "Help me prepare a CSV or XLSX import. Explain required fields, references and how I can review the result before saving.",
    icon: "file-text",
  },
  companySetup: {
    label: "Check company setup",
    prompt: "Walk me through company setup and explain which settings are required before I start business workflows.",
    icon: "check-square",
  },
  accessHelp: {
    label: "Understand access settings",
    prompt: "Explain the organization access settings on this page and what I should review before changing them. Do not change permissions.",
    icon: "users",
  },
  quotationHelp: {
    label: "Prepare a quotation",
    prompt: "Walk me through preparing a quotation, including customer, price list, currency, validity and delivery details.",
    icon: "file-text",
  },
  pricingHelp: {
    label: "Understand price lists",
    prompt: "Explain how to choose the price list and currency for a quotation and resolve missing setup.",
    icon: "help-circle",
  },
  fulfillmentHelp: {
    label: "Understand order fulfillment",
    prompt: "Explain the steps from a confirmed order to delivery and invoicing, including what needs review.",
    icon: "package",
  },
  stockHelp: {
    label: "Understand stock quantities",
    prompt: "Explain the stock quantities shown here and how on-hand, available and reserved quantities differ.",
    icon: "package",
  },
  productHelp: {
    label: "Prepare a product",
    prompt: "Walk me through product setup, including category, units, pricing and purchase or sales settings.",
    icon: "edit",
  },
  trackingHelp: {
    label: "Understand stock tracking",
    prompt: "Explain how to use locations, lots and serial numbers in this workspace.",
    icon: "book-open",
  },
  invoiceHelp: {
    label: "Review an invoice",
    prompt: "Explain what to review on an invoice or vendor bill before posting it.",
    icon: "file-text",
  },
  paymentHelp: {
    label: "Understand reconciliation",
    prompt: "Walk me through reviewing and reconciling a payment against the correct business records.",
    icon: "check-square",
  },
  reportHelp: {
    label: "Choose a financial report",
    prompt: "Help me choose a financial report and explain the period, currency and source records I should check.",
    icon: "file-text",
  },
  followupHelp: {
    label: "Plan a follow-up",
    prompt: "Help me plan a useful CRM follow-up and explain how to assign and track it.",
    icon: "check-square",
  },
  contactHelp: {
    label: "Prepare a contact",
    prompt: "Walk me through adding or reviewing a contact and its customer or supplier relationship.",
    icon: "users",
  },
  pipelineHelp: {
    label: "Understand the pipeline",
    prompt: "Explain the steps from a new enquiry to a qualified opportunity and the next action to review.",
    icon: "trending-up",
  },
  fileHelp: {
    label: "Find and review a file",
    prompt: "Explain how to find and review files in this workspace and understand their metadata.",
    icon: "file-text",
  },
  templateHelp: {
    label: "Work with a template",
    prompt: "Walk me through choosing and preparing a document template for review.",
    icon: "layout",
  },
  knowledgeHelp: {
    label: "Use saved guides",
    prompt: "Explain how to find, review and use saved guides in this workspace.",
    icon: "book-open",
  },
} as const

type AssistantStarterId = keyof typeof assistantStarters

const defaultStarters = ["pageHelp", "nextSteps", "draftHelp"] as const

const moduleStarters: Readonly<Record<string, readonly AssistantStarterId[]>> = {
  settings: ["companySetup", "importHelp", "accessHelp"],
  sales: ["quotationHelp", "pricingHelp", "fulfillmentHelp"],
  accounting: ["invoiceHelp", "paymentHelp", "reportHelp"],
  crm: ["followupHelp", "contactHelp", "pipelineHelp"],
  inventory: ["stockHelp", "productHelp", "trackingHelp"],
  warehouse: ["stockHelp", "trackingHelp", "productHelp"],
  products: ["productHelp", "stockHelp", "importHelp"],
  documents: ["fileHelp", "templateHelp", "knowledgeHelp"],
  reports: ["reportHelp", "pageHelp", "nextSteps"],
}

export function assistantStarterIds(
  context?: Pick<ChatContext, "module" | "route" | "activeTab">,
): readonly AssistantStarterId[] {
  const module = context?.module ?? context?.route?.split("/")[1]
  if (module === "settings" && context?.activeTab === "imports") {
    return ["importReview", "sourceHistory", "importHelp"]
  }
  return module && Object.hasOwn(moduleStarters, module)
    ? moduleStarters[module]!
    : defaultStarters
}
