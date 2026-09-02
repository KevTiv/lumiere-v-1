import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  camelToSnakeIdentifier,
  encodeOptionalString,
  encodeOptionalTimestamp,
  encodeReducerCallArgs,
  encodeTaggedUnitEnum,
  stdbParamsToJson,
} from "./stdb-params-json"

describe("stdbParamsToJson", () => {
  it("converts top-level camelCase keys to snake_case", () => {
    assert.deepEqual(
      stdbParamsToJson({ contactName: "Ada", partnerId: 1n }),
      { contact_name: "Ada", partner_id: 1 },
    )
  })

  it("wraps Option fields when structName is provided", () => {
    const out = stdbParamsToJson(
      { contactName: "Ada", email: undefined, partnerId: 1n },
      "CreateLeadParams",
    )
    assert.deepEqual(out.contact_name, { some: "Ada" })
    assert.deepEqual(out.partner_id, { some: 1 })
    assert.deepEqual(out.email, { none: [] })
    assert.deepEqual(out.phone, { none: [] })
  })

  it("emits explicit none for every missing Option field in a struct", () => {
    const out = stdbParamsToJson(
      {
        name: "Smoke Lead",
        priority: "Medium",
        state: "new",
        expectedRevenue: 1000,
        probability: 0,
        tagIds: [],
        contactName: "Ada",
        email: "ada@example.test",
      },
      "CreateLeadParams",
    )
    assert.deepEqual(out.phone, { none: [] })
    assert.deepEqual(out.mobile, { none: [] })
    assert.deepEqual(out.company_name, { none: [] })
    assert.deepEqual(out.email, { some: "ada@example.test" })
  })

  it("encodes Option<u64> zero as none for struct fields", () => {
    const out = stdbParamsToJson({ companyId: 0n }, "CreateContactParams")
    assert.deepEqual(out.company_id, { none: [] })
    assert.deepEqual(out.phone, { none: [] })
  })

  it("encodeReducerCallArgs SATS-encodes the trailing params object", () => {
    const encoded = encodeReducerCallArgs("create_lead", [
      1,
      { name: "L", contactName: "L", email: "a@b.test", tagIds: [] },
    ])
    assert.equal(encoded[0], 1)
    const params = encoded[1] as Record<string, unknown>
    assert.equal(params.name, "L")
    assert.deepEqual(params.contact_name, { some: "L" })
    assert.deepEqual(params.email, { some: "a@b.test" })
    assert.deepEqual(params.tag_ids, [])
    assert.deepEqual(params.phone, { none: [] })
    assert.deepEqual(params.stage_id, { none: [] })
  })

  it("encodeReducerCallArgs SATS-encodes convert_lead_to_customer params", () => {
    const encoded = encodeReducerCallArgs("convert_lead_to_customer", [
      1,
      42,
      {
        createContact: true,
        createOpportunity: true,
        opportunityStageId: 7,
      },
    ])
    assert.equal(encoded[0], 1)
    assert.equal(encoded[1], 42)
    const params = encoded[2] as Record<string, unknown>
    assert.equal(params.create_contact, true)
    assert.equal(params.create_opportunity, true)
    assert.deepEqual(params.opportunity_stage_id, { some: 7 })
    assert.deepEqual(params.company_id, { none: [] })
    assert.deepEqual(params.contact_type, { none: [] })
    assert.deepEqual(params.metadata, { none: [] })
  })

  it("encodeReducerCallArgs snake_cases convert_opportunity_to_sale_order params", () => {
    const encoded = encodeReducerCallArgs("convert_opportunity_to_sale_order", [
      99,
      { pricelistId: 3, warehouseId: 5 },
    ])
    assert.equal(encoded[0], 99)
    const params = encoded[1] as Record<string, unknown>
    assert.equal(params.pricelist_id, 3)
    assert.equal(params.warehouse_id, 5)
  })

  it("encodeReducerCallArgs SATS-encodes create_sale_order params without camelCase companyId", () => {
    const encoded = encodeReducerCallArgs("create_sale_order", [
      1,
      {
        company_id: 28,
        partner_id: 2,
        partner_invoice_id: 2,
        partner_shipping_id: 2,
        pricelist_id: 1,
        currency_id: 1,
        warehouse_id: 1,
        order_lines: [],
        origin: "perm-so",
      },
    ])
    const params = encoded[1] as Record<string, unknown>
    assert.deepEqual(params.company_id, { some: 28 })
    assert.deepEqual(params.proposal_id, { none: [] })
    assert.deepEqual(params.order_lines, [])
    assert.equal("companyId" in params, false)
  })

  it("encodeReducerCallArgs SATS-encodes nested return order line Option fields", () => {
    const encoded = encodeReducerCallArgs("create_return_order", [
      1,
      28,
      {
        partnerId: 5n,
        saleOrderId: 8n,
        returnReason: "defective",
        lines: [
          {
            productId: 3n,
            productUom: 1n,
            productUomQty: 1,
            priceUnit: 1200,
            toRefund: true,
          },
        ],
      },
    ])
    const params = encoded[2] as Record<string, unknown>
    const line = (params.lines as Record<string, unknown>[])[0]
    assert.deepEqual(params.sale_order_id, { some: 8 })
    assert.deepEqual(params.return_reason, { some: "defective" })
    assert.deepEqual(line.sale_order_line_id, { none: [] })
    assert.equal(line.product_id, 3)
  })

  it("encodeReducerCallArgs SATS-encodes CreateCreditNoteFromReturnOrderParams metadata", () => {
    const encoded = encodeReducerCallArgs("create_credit_note_from_return_order", [
      1,
      28,
      9,
      {
        journalId: 2n,
        defaultIncomeAccountId: 3n,
        receivableLine: {
          accountId: 4n,
          debit: 100,
          credit: 0,
          name: "Receivable",
        },
        incomeLine: {
          accountId: 5n,
          debit: 0,
          credit: 100,
          name: "Income",
        },
      },
    ])
    const params = encoded[3] as Record<string, unknown>
    assert.deepEqual(params.metadata, { none: [] })
  })

  it("encodeReducerCallArgs encodes CreateProposalParams struct for create_proposal", () => {
    const encoded = encodeReducerCallArgs("create_proposal", [
      1,
      2,
      {
        title: "Title",
        clientName: "Client",
        currencyId: 1,
        value: 5000,
        deadline: null,
        description: null,
        templateId: null,
        partnerId: null,
        documentFolderId: null,
        metadata: null,
      },
    ])
    const params = encoded[2] as Record<string, unknown>
    assert.equal(params.title, "Title")
    assert.equal(params.client_name, "Client")
    assert.equal(params.currency_id, 1)
    assert.deepEqual(params.deadline, { none: [] })
    assert.deepEqual(params.description, { none: [] })
    assert.deepEqual(params.template_id, { none: [] })
    assert.deepEqual(params.partner_id, { none: [] })
    assert.deepEqual(params.document_folder_id, { none: [] })
    assert.deepEqual(params.metadata, { none: [] })
  })

  it("encodeReducerCallArgs SATS-encodes flat Option args for update_payment_term", () => {
    const encoded = encodeReducerCallArgs("update_payment_term", [
      1,
      42,
      null,
      null,
      false,
    ])
    assert.deepEqual(encoded[2], { none: [] })
    assert.deepEqual(encoded[3], { none: [] })
    assert.deepEqual(encoded[4], { some: false })
  })

  it("encodeOptionalString treats empty string as none", () => {
    assert.deepEqual(encodeOptionalString(""), { none: [] })
    assert.deepEqual(encodeOptionalString("notes"), { some: "notes" })
  })

  it("encodeOptionalTimestamp encodes Date values for SpacetimeDB HTTP", () => {
    const d = new Date("2026-01-15T12:00:00.000Z")
    const encoded = encodeOptionalTimestamp(d)
    assert.ok(encoded && typeof encoded === "object" && "some" in encoded)
    const ts = (encoded as { some: Record<string, unknown> }).some
    assert.equal(
      ts.__timestamp_micros_since_unix_epoch__,
      Number(BigInt(d.getTime()) * 1000n),
    )
  })

  it("encodes timestamps for SpacetimeDB HTTP", () => {
    assert.deepEqual(
      stdbParamsToJson({
        dateFrom: { microsSinceUnixEpoch: 1_700_000_000_000_000n },
      }),
      {
        date_from: { __timestamp_micros_since_unix_epoch__: 1_700_000_000_000_000 },
      },
    )
  })

  it("wraps present optional timestamps using SATS Option JSON", () => {
    assert.deepEqual(
      stdbParamsToJson(
        {
          date: { microsSinceUnixEpoch: 1_700_000_000_000_000n },
        },
        "CreatePaymentParams",
      ).date,
      {
        some: {
          __timestamp_micros_since_unix_epoch__: 1_700_000_000_000_000,
        },
      },
    )
  })

  it("encodeReducerCallArgs SATS-encodes update_sale_order params", () => {
    const encoded = encodeReducerCallArgs("update_sale_order", [
      42,
      { clientOrderRef: "SO-UPDATED" },
    ])
    assert.equal(encoded[0], 42)
    const params = encoded[1] as Record<string, unknown>
    assert.deepEqual(params.client_order_ref, { some: "SO-UPDATED" })
    assert.deepEqual(params.note, { none: [] })
  })

  it("encodes tagged unit enums as SATS sum JSON", () => {
    assert.deepEqual(
      stdbParamsToJson({ discountPolicy: { tag: "WithDiscount" } }),
      { discount_policy: { withDiscount: [] } },
    )
  })

  it("encodes CreateEmployeeParams enums and option fields through reducer calls", () => {
    const encoded = encodeReducerCallArgs("create_employee", [
      7,
      {
        companyId: 11,
        employmentType: { tag: "FullTime" },
        name: "Ada Lovelace",
        isActive: true,
      },
    ])
    const params = encoded[1] as Record<string, unknown>
    assert.deepEqual(params.company_id, { some: 11 })
    assert.equal(params.name, "Ada Lovelace")
    assert.deepEqual(params.employment_type, { fullTime: [] })
    assert.equal(params.is_active, true)
    assert.deepEqual(params.job_id, { none: [] })
    assert.deepEqual(params.metadata, { none: [] })
  })

  it("encodes CreateTaskParams state enums and option fields through reducer calls", () => {
    const encoded = encodeReducerCallArgs("create_task", [
      7,
      {
        companyId: 11,
        state: { tag: "InProgress" },
        name: "Prepare shipment",
      },
    ])
    const params = encoded[1] as Record<string, unknown>
    assert.deepEqual(params.company_id, { some: 11 })
    assert.deepEqual(params.state, { inProgress: [] })
    assert.equal(params.name, "Prepare shipment")
    assert.deepEqual(params.project_id, { none: [] })
    assert.deepEqual(params.metadata, { none: [] })
  })

  it("encodes tagged payload enums and optional analytics/AI fields", () => {
    const widget = encodeReducerCallArgs("create_dashboard_widget", [
      1,
      { name: "KPI", widgetType: { tag: "Kpi" }, model: "sale_order", fields: [] },
    ])[1] as Record<string, unknown>
    assert.deepEqual(widget.widget_type, { kpi: [] })
    assert.deepEqual(widget.metadata, { none: [] })

    const insight = encodeReducerCallArgs("create_ai_insight", [
      1,
      { tag: "High" },
      { severity: { tag: "High" }, title: "Alert", description: "Details" },
    ])[2] as Record<string, unknown>
    assert.deepEqual(insight.severity, { high: [] })
    assert.deepEqual(insight.metadata, { none: [] })
  })

  it("encodes publish_form_configuration and its nested form structs", () => {
    const encoded = encodeReducerCallArgs("publish_form_configuration", [
      7,
      {
        moduleId: "crm",
        formId: "new-lead",
        name: "New Lead",
        description: "Create a lead",
        isSystemDefault: true,
        fields: [
          {
            fieldId: "lead_source",
            name: "lead_source",
            label: "Lead Source",
            fieldType: { tag: "Select" },
            options: [{ value: "website", label: "Website", color: "blue" }],
            validation: { required: true, minLength: 1 },
            aiSuggestions: [],
            order: 1,
            isSystem: true,
            isEnabled: true,
            showInList: true,
            width: { tag: "Half" },
          },
        ],
        roleConfigs: [],
        replaceMissingFields: false,
      },
    ])

    const params = encoded[1] as Record<string, unknown>
    assert.deepEqual(params.description, { some: "Create a lead" })
    assert.deepEqual(params.expected_updated_at_micros, { none: [] })
    const field = (params.fields as Record<string, unknown>[])[0]
    assert.deepEqual(field.field_type, { select: [] })
    assert.deepEqual(field.description, { none: [] })
    assert.deepEqual(field.visibility_json, { none: [] })
    assert.deepEqual(field.width, { half: [] })
    assert.deepEqual(field.validation, {
      required: true,
      min_length: { some: 1 },
      max_length: { none: [] },
      min: { none: [] },
      max: { none: [] },
      pattern: { none: [] },
      message: { none: [] },
    })
    assert.deepEqual(field.options, [
      { value: "website", label: "Website", color: { some: "blue" }, icon: { none: [] } },
    ])
  })

  it("encodes set_record_custom_field_values and its nested entries", () => {
    const encoded = encodeReducerCallArgs("set_record_custom_field_values", [
      7,
      19,
      {
        model: "lead",
        recordId: 41n,
        entries: [{ fieldKey: "custom:region", valueJson: '"north"' }],
      },
    ])

    assert.deepEqual(encoded[2], {
      model: "lead",
      record_id: 41,
      entries: [{ field_key: "custom:region", value_json: '"north"' }],
    })
  })

  it("converts nested object keys recursively", () => {
    assert.deepEqual(
      stdbParamsToJson({
        autoPost: true,
        lineIds: [{ productId: 2, taxIds: [1, 2] }],
      }),
      {
        auto_post: true,
        line_ids: [{ product_id: 2, tax_ids: [1, 2] }],
      },
    )
  })

  it("emits explicit none for CreatePaymentTermParams option fields", () => {
    const out = stdbParamsToJson({ name: "Net 30" }, "CreatePaymentTermParams")
    assert.equal(out.name, "Net 30")
    assert.deepEqual(out.note, { none: [] })
  })

  it("wraps Option<TicketPriority> on UpdateTicketParams", () => {
    const out = stdbParamsToJson(
      { name: "Updated", priority: { tag: "High" } },
      "UpdateTicketParams",
    )
    assert.deepEqual(out.name, { some: "Updated" })
    assert.deepEqual(out.priority, { some: { high: [] } })
    assert.deepEqual(out.description, { none: [] })
    assert.deepEqual(out.stage_id, { none: [] })
  })

  it("leaves already snake_case keys unchanged", () => {
    assert.deepEqual(stdbParamsToJson({ company_id: 7, active: false }), {
      company_id: 7,
      active: false,
    })
  })
})

describe("encodeTaggedUnitEnum", () => {
  it("lowercases the first character of the tag", () => {
    assert.deepEqual(encodeTaggedUnitEnum({ tag: "Percent" }), { percent: [] })
    assert.deepEqual(encodeTaggedUnitEnum({ tag: "PythonCode" }), { pythonCode: [] })
  })
})

describe("encodeReducerCallArgs grant_permission", () => {
  it("SATS-encodes permission subject and action enums", () => {
    const encoded = encodeReducerCallArgs("grant_permission", [
      1,
      {
        subject: { tag: "Role", value: 42 },
        resource: "account_move",
        action: { tag: "Write" },
        effect: { tag: "Allow" },
      },
    ])
    assert.deepEqual(encoded[1], {
      subject: { role: 42 },
      resource: "account_move",
      action: { write: [] },
      effect: { allow: [] },
    })
  })
})

describe("encodeReducerCallArgs create_saved_report", () => {
  it("emits explicit none for optional saved report fields", () => {
    const encoded = encodeReducerCallArgs("create_saved_report", [
      1,
      2,
      {
        name: "Pivot Smoke",
        model: "trial_balance",
        rowDimension: "accountCode",
        measureField: "closingDebit",
        measureOp: "sum",
        isActive: true,
      },
    ])
    assert.equal(encoded[0], 1)
    assert.equal(encoded[1], 2)
    const params = encoded[2] as Record<string, unknown>
    assert.equal(params.name, "Pivot Smoke")
    assert.deepEqual(params.column_dimension, { none: [] })
    assert.deepEqual(params.filter_json, { none: [] })
    assert.deepEqual(params.metadata, { none: [] })
  })
})

describe("encodeReducerCallArgs claim_workflow_human_task", () => {
  it("emits explicit none for optional acting_for", () => {
    const encoded = encodeReducerCallArgs("claim_workflow_human_task", [
      1,
      {
        companyId: 2,
        taskId: 10,
        expectedRevision: 1,
        actingFor: null,
        idempotencyKey: "claim-1",
        correlationId: "corr-1",
      },
    ])
    assert.equal(encoded[0], 1)
    const params = encoded[1] as Record<string, unknown>
    assert.equal(params.task_id, 10)
    assert.equal(params.expected_revision, 1)
    assert.deepEqual(params.acting_for, { none: [] })
  })
})

describe("camelToSnakeIdentifier", () => {
  it("handles Odoo-style relation suffixes", () => {
    assert.equal(camelToSnakeIdentifier("showLotsM2O"), "show_lots_m2o")
    assert.equal(camelToSnakeIdentifier("partnerM2M"), "partner_m2m")
  })

  it("handles numeric image field suffixes", () => {
    assert.equal(camelToSnakeIdentifier("image1920Url"), "image_1920_url")
    assert.equal(camelToSnakeIdentifier("image128Url"), "image_128_url")
  })
})
