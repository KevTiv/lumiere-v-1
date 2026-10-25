// Linked synthetic examples for the modules visible in the Alpha navigation.
// Business states are reached through their permission-checked reducer actions.
export function alphaUiDemoScenarios(now = new Date()) {
  const day = offset => new Date(now.getTime() + offset * 86400000).toISOString()
  const label = value => `[Alpha UI demo] ${value}`
  const note = 'Synthetic Alpha UI example. No real contract, payment, tax filing or external delivery.'
  const fixtures = []
  const add = (key, table, operation, match, input, extra = {}) => fixtures.push({ key, table, operation, match, input, ...extra })
  const named = (key, table, operation, name, params, args = {}, extra = {}) => add(key, table, operation,
    { name }, { ...args, params: { name, ...params } }, extra)
  const step = (operation, input, before, expect) => ({ operation, input, before, expect })
  const state = index => [index, []]
  const prerequisites = [
    ['warehouse', 'warehouse', { code: 'ADEMO' }], ['pricelist', 'product_pricelist', { name: '[Alpha demo] EUR retail' }],
    ['unit', 'uom', { name: '[Alpha demo] Unit' }], ['hour', 'uom', { name: '[Alpha demo] Hour' }],
    ['monitor', 'product', { default_code: 'ALPHA-MONITOR' }], ['service', 'product', { default_code: 'ALPHA-SERVICE' }],
    ['analytic', 'account_analytic_account', { code: 'ALPHA-ROLLOUT' }], ['employee', 'hr_employee', { employee_number: 'ALPHA-DEMO-1' }],
    ['project', 'project_project', { name: '[Alpha demo] Aurora office rollout' }],
    ['paymentTerm', 'account_payment_term', { name: '[Alpha demo] Net 30' }],
    ...['Qualified', 'Proposal', 'Negotiation', 'Won'].map((name, i) => [`stage${i}`, 'opp_stage', { name: `[Alpha demo] ${name}` }]),
    ['saleTax', 'account_tax', { name: '[Alpha UI demo] Sale 0% — synthetic only' }],
    ['purchaseTax', 'account_tax', { name: '[Alpha UI demo] Purchase 0% — synthetic only' }],
    ['followUpType', 'activity_type', { name: 'Follow Up' }],
    ['postedInvoice', 'account_move', { ref: 'ALPHA-UI-INVOICE-1' }],
  ]
  for (const [i, companyName, industry, vendor] of [
    [0, 'Willow Design', 'Design services', false], [1, 'Harbor Labs', 'Research equipment', false],
    [2, 'Pine Office Supply', 'Office equipment', true], [3, 'Summit Training', 'Professional training', true],
  ]) named(`contact${i}`, 'contact', 'create_contact', label(companyName), {
    type: 'company', companyId: '@company', displayName: label(companyName), email: `alpha-ui-${i}@example.test`,
    phone: `+31 20 000 00 0${i}`, website: `https://alpha-ui-${i}.example.test`, street: `${10 + i} Example Lane`,
    city: ['Amsterdam', 'Rotterdam', 'Utrecht', 'Leiden'][i], zip: `${1000 + i} XX`, industry, employeesCount: [18, 65, 24, 12][i],
    isCustomer: !vendor, isVendor: vendor, customerRank: vendor ? 0 : 1, supplierRank: vendor ? 1 : 0,
    assignedUserId: '@actor', salespersonId: '@actor', description: `${note} ${industry}; example address and telephone.`,
  })
  for (const [i, firstName, lastName] of [[0, 'Dana', 'Vale'], [1, 'Riley', 'Stone']]) {
    named(`personUI${i}`, 'contact', 'create_contact', label(`${firstName} ${lastName}`), {
      type: 'person', companyId: '@company', parentId: `@contact${i}`, firstName, lastName,
      email: `alpha-ui-buyer-${i}@example.test`, phone: `+1 202 555 012${i}`, city: i ? 'Rotterdam' : 'Amsterdam',
      assignedUserId: '@actor', description: `${note} Fictional purchasing contact.`,
    })
    named(`completeLeadUI${i}`, 'lead', 'create_lead', label(i ? 'Harbor training enquiry' : 'Willow display leasing enquiry'), {
      contactName: `${firstName} ${lastName}`, companyName: label(i ? 'Harbor Labs' : 'Willow Design'),
      email: `alpha-ui-buyer-${i}@example.test`, phone: `+1 202 555 012${i}`, partnerId: `@contact${i}`,
      state: 'new', priority: '2', expectedRevenue: 5000 + i * 1000, probability: 60, description: note,
    })
    named(`completeOpportunityUI${i}`, 'opportunity', 'create_opportunity', label(i ? 'Harbor training extension' : 'Willow display leasing'), {
      companyId: '@company', companyCurrencyId: '@currency', partnerId: `@contact${i}`, contactId: `@personUI${i}`,
      leadId: `@completeLeadUI${i}`, stageId: '@stage1', expectedRevenue: 5000 + i * 1000, probability: 60, priority: '2',
      userId: '@actor', dateOpen: day(0), dateDeadline: day(14), dateLastStageUpdate: day(0), description: note,
    })
  }
  for (let i = 0; i < 6; i++) {
    named(`leadUI${i}`, 'lead', 'create_lead', label(['Workplace refresh', 'Lab displays', 'Training renewal', 'Design rollout', 'Support extension', 'Pilot assessment'][i]), {
      state: 'new', priority: String(i % 3), expectedRevenue: [14400, 7200, 3600, 21600, 4800, 9500][i], probability: [25, 60, 85, 25, 60, 85][i],
      partnerId: `@contact${i % 2}`, email: `alpha-ui-lead-${i}@example.test`, description: note,
    })
    named(`opportunityUI${i}`, 'opportunity', 'create_opportunity', label(['Willow office refresh', 'Harbor monitor rollout', 'Willow training programme', 'Harbor annual support', 'Willow support renewal', 'Harbor discovery pilot'][i]), {
      companyId: '@company', companyCurrencyId: '@currency', leadId: `@leadUI${i}`, partnerId: `@contact${i % 2}`,
      expectedRevenue: [14400, 7200, 3600, 21600, 4800, 9500][i], probability: i === 4 ? 100 : [25, 60, 85][i % 3],
      stageId: `@stage${i === 4 ? 3 : i % 3}`, priority: String(i % 3), isWon: i === 4, isLost: false,
      dateOpen: day(-10 - i), dateDeadline: day(i === 2 ? -2 : 5 + i * 3), userId: '@actor', description: note,
    })
  }
  for (let i = 0; i < 4; i++) {
    const ref = `ALPHA-UI-SO-${i + 1}`, service = i % 2 === 1
    add(`saleUI${i}`, 'sale_order', 'create_sale_order', { client_order_ref: ref }, { params: {
      companyId: '@company', partnerId: `@contact${i % 2}`, partnerInvoiceId: `@contact${i % 2}`, partnerShippingId: `@contact${i % 2}`,
      pricelistId: '@pricelist', currencyId: '@currency', warehouseId: '@warehouse', clientOrderRef: ref,
      origin: label(service ? 'Support proposal' : 'Office equipment proposal'), note, termsAndConditions: 'Synthetic demonstration order. No delivery or collection is scheduled.',
      paymentTermId: '@paymentTerm', commitmentDate: day(7 + i * 3), expectedDate: day(5 + i * 3), validityDays: 30,
      shippingPolicy: 'direct', pickingPolicy: 'direct', invoicePolicy: 'order', analyticAccountId: '@analytic', userId: '@actor',
    } })
    named(`saleUILine${i}`, 'sale_order_line', 'create_sale_order_line', label(service ? `Support package ${i + 1}` : `Monitor package ${i + 1}`), {
      productId: service ? '@service' : '@monitor', quantity: service ? 12 + i * 4 : 8 + i * 2,
      uomId: service ? '@hour' : '@unit', priceUnit: service ? 95 : 220, discount: i === 2 ? 5 : 0,
      taxIds: ['@saleTax'], sequence: 1,
    }, { orderId: `@saleUI${i}` })
    if (i < 3) add(`saleUIState${i}`, 'sale_order', null, { client_order_ref: ref }, null, { actions: [step(
      i < 2 ? 'confirm_sales_order' : 'send_sale_order_quotation', { companyId: '@company', orderId: `@saleUI${i}` },
      { state: state(0) }, { state: state(i < 2 ? 2 : 1) },
    )] })
  }
  for (let i = 0; i < 3; i++) {
    const ref = `ALPHA-UI-PO-${i + 1}`
    add(`purchaseUI${i}`, 'purchase_order', 'create_purchase_order', { partner_ref: ref }, { params: {
      companyId: '@company', partnerId: `@contact${i % 2 + 2}`, currencyId: '@currency', partnerRef: ref,
      origin: label(`Office rollout phase ${i + 1}`), notes: note, datePlanned: day(i === 0 ? -3 : 8 + i),
      paymentTermId: '@paymentTerm', userId: '@actor',
    } })
    named(`purchaseUILine${i}`, 'purchase_order_line', 'add_purchase_order_line', label(`Display procurement lot ${i + 1}`), {
      productId: '@monitor', quantity: 10 + i * 5, uomId: '@unit', priceUnit: 120, taxIds: ['@purchaseTax'], sequence: 1,
      datePlanned: day(i === 0 ? -3 : 8 + i),
    }, { orderId: `@purchaseUI${i}` })
    fixtures.at(-1).match = { order_id: `@purchaseUI${i}`, product_id: '@monitor' }
    if (i < 2) add(`purchaseUIState${i}`, 'purchase_order', null, { partner_ref: ref }, null, { actions: [step(
      'confirm_purchase_order', { orderId: `@purchaseUI${i}` }, { state: state(0) }, { state: state(3) },
    )] })
  }
  named('supportPlanUI', 'subscription_plan', 'create_subscription_plan', label('Monthly support — manual billing'), {
    companyId: '@company', currencyId: '@currency', code: 'ALPHA-UI-SUPPORT', journalId: '@salesJournal', productId: '@service',
    billingPeriod: 'monthly', billingPeriodUnit: 1, recurringInvoiceDay: 1, paymentMode: 'manual', active: true,
    description: note, trialUnit: 'month', recurringRuleMinUnit: 'month', recurringRuleMaxUnit: 'month', recurringRuleMaxCount: 12,
  })
  for (let i = 0; i < 2; i++) add(`subscriptionUI${i}`, 'subscription', 'create_subscription_from_sale_order', { code: `ALPHA-UI-SUB-${i + 1}` }, { params: {
    companyId: '@company', saleOrderId: `@saleUI${i}`, code: `ALPHA-UI-SUB-${i + 1}`, planId: '@supportPlanUI', dateStart: day(0),
    recurringInvoiceDay: 1, isTrial: false, description: note, recurringRuleType: 'monthly', recurringInterval: 1, paymentMode: 'manual',
    partnerId: `@contact${i}`, partnerInvoiceId: `@contact${i}`, partnerShippingId: `@contact${i}`,
    currencyId: '@currency', pricelistId: '@pricelist', analyticAccountId: '@analytic', health: 'healthy', state: 'draft',
  } }, i === 0 ? { actions: [step('activate_subscription', { companyId: '@company', subscriptionId: '@subscriptionUI0' },
    { state: 'draft' }, { state: 'active' })] } : {})
  for (let i = 0; i < 3; i++) {
    named(`sheetUI${i}`, 'expense_sheet', 'create_expense_sheet', label(['Client visit — ready for review', 'Training workshop — ready for review', 'Office supplies — draft'][i]), {
      companyId: '@company', employeeId: '@employee', currencyId: '@currency', accountingDate: day(-i), notes: note,
    })
    for (let j = 0; j < 2; j++) {
      const key = `${i}-${j}`, amount = [[42, 18.5], [85, 36], [24, 49.9]][i][j]
      add(`receiptUI${key}`, 'hr_expense_receipt', 'create_expense_receipt', { file_name: `alpha-ui-receipt-${key}.txt` }, { params: {
        companyId: '@company', employeeId: '@employee', clientRequestId: `alpha-ui-receipt-${key}`,
      } }, { blob: { fileName: `alpha-ui-receipt-${key}.txt`, contentType: 'text/plain',
        content: `SYNTHETIC RECEIPT — ALPHA UI DEMO\nReference: ALPHA-UI-${key}\nDate: ${day(-i - 1).slice(0, 10)}\nAmount: EUR ${amount.toFixed(2)}\nNo real goods or services were supplied.\n` } })
      named(`expenseUI${key}`, 'hr_expense', 'create_expense', label(`${['Customer visit', 'Workshop', 'Office supplies'][i]} — ${j ? 'Materials' : 'Travel'}`), {
        companyId: '@company', employeeId: '@employee', currencyId: '@currency', date: day(-i - 1), unitAmount: amount, quantity: 1,
        lineKind: 'Standard', paymentMode: 'OutOfPocket', attachmentIds: [`@receiptUI${key}`], accountId: '@expenseAccount',
        analyticAccountId: '@analytic', projectId: '@project', description: note, merchantKey: `alpha-ui-merchant-${i}`,
        clientRequestId: `alpha-ui-expense-${key}`,
      }, {}, { actions: [
        step('update_expense', { expenseId: `@expenseUI${key}`, params: { accountId: '@expenseAccount' } },
          { state: state(0) }, { account_id: [0, '@expenseAccount'] }),
        step('submit_expense', { expenseId: `@expenseUI${key}`, sheetId: `@sheetUI${i}` },
          { state: state(0) }, { state: state(1), sheet_id: [0, `@sheetUI${i}`] }),
      ] })
    }
    if (i < 2) add(`sheetUIState${i}`, 'expense_sheet', null, { name: label(['Client visit — ready for review', 'Training workshop — ready for review'][i]) }, null,
      { actions: [step('submit_expense_sheet', { sheetId: `@sheetUI${i}` }, { state: state(0) }, { state: state(1) })] })
  }
  for (const [i, type] of ['TrialBalance', 'ProfitAndLoss', 'AgedReceivable', 'AgedPayable'].entries()) named(`reportUI${i}`, 'financial_report', 'create_financial_report', label(`${type} — posted demo data`), {
    reportType: type, dateFrom: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), dateTo: day(0),
    currencyId: '@currency', resultCurrencyId: '@currency', targetMove: 'posted', comparisonMode: 'none',
    hierarchyLevel: 3, showZeroLines: true, showHierarchy: true, showDebitCredit: true,
  }, { companyId: '@company' }, { actions: [step('generate_financial_report', { companyId: '@company', reportId: `@reportUI${i}` },
    { state: state(0) }, { state: state(1) })] })
  named('budgetUI', 'crossovered_budget', 'create_crossovered_budget', label('Q4 office rollout budget'), {
    companyId: '@company', description: note, dateFrom: new Date(Date.UTC(now.getUTCFullYear(), 9, 1)).toISOString(),
    dateTo: new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59)).toISOString(),
  })
  add('budgetLineUI', 'crossovered_budget_lines', 'create_budget_line', { general_budget_id: '@budgetUI', analytic_account_id: '@analytic' }, { budgetId: '@budgetUI', params: {
    analyticAccountId: '@analytic', projectId: '@project', dateFrom: new Date(Date.UTC(now.getUTCFullYear(), 9, 1)).toISOString(),
    dateTo: new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59)).toISOString(), plannedAmount: 18000,
  } })
  for (const [i, name, offset] of [[0, 'Willow rollout planning', 1], [1, 'Harbor equipment review', 3], [2, 'Finance Alpha walkthrough', 5], [3, 'Month-end preparation', 7]]) {
    named(`calendarUI${i}`, 'calendar_event', 'create_calendar_event', label(name), {
      start: day(offset), stop: new Date(now.getTime() + offset * 86400000 + 3600000).toISOString(),
      privacy: 'private', showAs: 'busy', state: 'confirmed', partnerIds: [`@contact${i % 2}`], userId: '@actor',
      description: note, location: ['Demo meeting room A', 'Demo workshop', 'Demo finance room', 'Demo meeting room B'][i], color: ['blue', 'green', 'purple', 'orange'][i],
    })
    fixtures.at(-1).actions = [step('update_calendar_event', { eventId: `@calendarUI${i}`, params: { state: 'confirmed' } },
      { state: 'open' }, { state: 'confirmed' })]
  }
  for (const [i, summary, target, offset] of [
    [0, 'Confirm Willow delivery details', { SaleOrder: '@saleUI0' }, 2],
    [1, 'Review late display receipt', { PurchaseOrder: '@purchaseUI0' }, -2],
    [2, 'Review overdue demo invoice', { AccountMove: '@postedInvoice' }, 0],
  ]) add(`followUpUI${i}`, 'activity', 'create_activity', { summary: label(summary) }, { params: {
    activityTypeId: '@followUpType', summary: label(summary), priority: String(i % 2), state: offset < 0 ? 'overdue' : offset === 0 ? 'today' : 'planned',
    auto: false, isSystem: false, isDone: false, note, dateDeadline: day(offset), assignedTo: '@actor', target,
    duration: 30, location: 'Alpha demonstration workspace',
  } })
  for (const [i, name] of ['Order review note', 'Invoice review note'].entries()) named(`messageTemplateUI${i}`, 'message_template', 'create_message_template', label(name), {
    companyId: '@company', key: `alpha_ui_review_${i}`, locale: 'en', subject: label(name),
    bodyTemplate: `${note} Review the linked demonstration record before any external action.`,
    allowedVariables: [], applicableChannels: ['InApp'], retentionClassification: 'internal',
  })
  for (let i = 0; i < 2; i++) {
    add(`sourcingUI${i}`, 'purchase_requisition', 'create_purchase_requisition', { origin: `ALPHA-UI-SOURCING-${i + 1}` }, { params: {
      companyId: '@company', origin: `ALPHA-UI-SOURCING-${i + 1}`, description: `${note} Display supply comparison ${i + 1}.`,
      orderingDate: day(0), dateEnd: day(30), scheduleDate: day(14), vendorId: `@contact${i + 2}`, multipleProduct: true,
    } })
    add(`sourcingLineUI${i}`, 'purchase_requisition_line', 'add_purchase_requisition_line', { requisition_id: `@sourcingUI${i}`, product_id: '@monitor' }, {
      companyId: '@company', requisitionId: `@sourcingUI${i}`, params: { productId: '@monitor', productUom: '@unit', productUomQty: 20 + i * 5,
        name: label(`Display supply comparison ${i + 1}`), sequence: 1 },
    })
    if (i === 0) add('sourcingReviewUI', 'purchase_requisition', null, { origin: 'ALPHA-UI-SOURCING-1' }, null, { actions: [
      step('submit_purchase_requisition', { requisitionId: '@sourcingUI0' }, { state: state(0) }, { state: state(2) }),
    ] })
    // Standalone comparisons remain separate from requests that await an independent approver.
    add(`rfqUI${i}`, 'purchase_rfq', 'create_purchase_rfq', { notes: `${note} ALPHA-UI-RFQ-${i + 1}` }, { companyId: '@company', params: {
      currencyId: '@currency', notes: `${note} ALPHA-UI-RFQ-${i + 1}`,
      lines: [{ productId: '@monitor', productUom: '@unit', productUomQty: 20 + i * 5, name: label('Display supply request'), sequence: 1 }],
    } })
    for (let j = 0; j < 2; j++) add(`rfqBidUI${i}-${j}`, 'purchase_rfq_bid', 'add_purchase_rfq_bid', { rfq_id: `@rfqUI${i}`, partner_id: `@contact${j + 2}` }, {
      companyId: '@company', rfqId: `@rfqUI${i}`, params: { partnerId: `@contact${j + 2}`, currencyId: '@currency', priceUnit: 115 + j * 10,
        notes: `${note} Estimated supply in ${7 + j * 3} days.` },
    })
  }
  for (const [i, qty, price] of [[0, 1, 220], [1, 10, 199]]) add(`priceUI${i}`, 'product_pricelist_item', 'create_pricelist_item', {
    pricelist_id: '@pricelist', product_id: '@monitor', min_quantity: qty,
  }, { params: { pricelistId: '@pricelist', appliedOn: 'Product', computePrice: 'Fixed', productId: '@monitor',
    minQuantity: qty, fixedPrice: price, sequence: 10 + i, dateStart: day(-1), dateEnd: day(90) } })
  for (const group of ['Asset', 'Liability']) named(`financeTypeUI${group}`, 'account_account_type', 'create_account_account_type', label(`${group} — non-trade balances`), {
    companyId: '@company', type: 'other', internalGroup: group, includeInitialBalance: true,
  })
  for (const [key, name, code, group] of [
    ['fixedAssetUI', 'Office equipment asset', 'ADUI1500', 'Asset'], ['depreciationUI', 'Accumulated depreciation', 'ADUI1590', 'Asset'],
    ['prepaidUI', 'Prepaid support', 'ADUI1400', 'Asset'], ['deferredUI', 'Deferred support revenue', 'ADUI2300', 'Liability'],
  ]) named(key, 'account_account', 'create_account_account', label(name), { companyId: '@company', code, userTypeId: `@financeTypeUI${group}`,
    internalType: group, internalGroup: group, note })
  named('generalJournalUI', 'account_journal', 'create_account_journal', label('General adjustments'), {
    companyId: '@company', code: 'ADG', type: 'General', active: true, defaultAccountId: '@fixedAssetUI', currencyId: '@currency',
  })
  named('equipmentAssetUI', 'account_asset', 'create_account_asset', label('Demo office displays — asset register'), {
    idempotencyKey: 'a10f0000000000000000000000000001', code: 'ALPHA-UI-ASSET-1', active: true, assetType: 'Purchase', currencyId: '@currency',
    originalValue: 15000, salvageValue: 600, method: 'Linear', methodNumber: 36, methodPeriod: 1, methodProgressFactor: 30,
    accountAssetId: '@fixedAssetUI', accountDepreciationId: '@depreciationUI', accountDepreciationExpenseId: '@expenseAccount',
    journalId: '@generalJournalUI', acquisitionDate: day(-30), firstDepreciationDate: day(7), accountAnalyticId: '@analytic',
  }, { companyId: '@company' }, { actions: [
    step('confirm_account_asset', { companyId: '@company', assetId: '@equipmentAssetUI' }, { state: state(0) }, { state: state(1) }),
    { ...step('compute_depreciation_board', { companyId: '@company', assetId: '@equipmentAssetUI' },
      { state: state(1), depreciation_board_ids: [] }, { state: state(1) }), expectLengths: { depreciation_board_ids: 36 } },
  ] })
  add('prepaidScheduleUI', 'amortization_schedule', 'create_amortization_schedule', { description: label('Quarterly software support prepayment') }, {
    companyId: '@company', params: { scheduleKind: 'prepaid', description: label('Quarterly software support prepayment'),
      journalId: '@generalJournalUI', balanceSheetAccountId: '@prepaidUI', plAccountId: '@expenseAccount', currencyId: '@currency', totalAmount: 1200,
      startDate: new Date(Date.UTC(now.getUTCFullYear(), 9, 1)).toISOString(), endDate: new Date(Date.UTC(now.getUTCFullYear(), 11, 31)).toISOString(), recognitionPeriod: 'month' },
  })
  add('deferredScheduleUI', 'deferred_revenue_schedule', 'create_deferred_revenue_schedule', { description: label('Annual support — deferred revenue draft') }, {
    companyId: '@company', params: { description: label('Annual support — deferred revenue draft'), journalId: '@generalJournalUI',
      accountId: '@income', deferredAccountId: '@deferredUI', currencyId: '@currency', totalAmount: 2400, recognizedAmount: 0, deferredAmount: 2400,
      startDate: day(0), endDate: day(365), recognitionMethod: 'straight_line', recognitionPeriod: 'month', state: 'draft', notes: note },
  })
  add('priceTierUI', 'subscription_price_tier', 'create_subscription_price_tier', { plan_id: '@supportPlanUI', min_qty: 1 }, { companyId: '@company', params: {
    planId: '@supportPlanUI', productId: '@monitor', sequence: 1, minQty: 1, maxQty: 100, unitPrice: 15, active: true,
  } })
  for (let i = 0; i < 2; i++) add(`usageUI${i}`, 'subscription_usage_event', 'ingest_subscription_usage_event', { source: 'alpha_ui_demo', event_id: `ALPHA-UI-USAGE-${i + 1}` }, {
    companyId: '@company', subscriptionId: '@subscriptionUI0', params: { source: 'alpha_ui_demo', eventId: `ALPHA-UI-USAGE-${i + 1}`,
      quantity: 3 + i * 2, unit: 'unit', productId: '@monitor', occurredAt: day(0) },
  })
  for (const [i, title, offset] of [[0, 'Illustrative month-end review — no filing', 7], [1, 'Illustrative quarterly review — no filing', 21]]) add(`deadlineUI${i}`, 'tax_deadline', 'create_tax_deadline', { title: label(title) }, { params: {
    companyId: '@company', deadlineType: 'Report', title: label(title), description: note, dueDate: day(offset), reminderDaysBefore: [7, 1], autoGenerated: false,
  } })
  named('taxScheduleUI', 'tax_schedule', 'create_tax_schedule', label('Illustrative zero-rate schedule — synthetic only'), {
    description: note, taxIds: ['@saleTax', '@purchaseTax'], isActive: true, effectiveFrom: day(-1), effectiveTo: day(90),
  }, { companyId: '@company' })
  return { fixtureKey: 'alpha-ui-scenarios-v1', prerequisites, fixtures }
}
