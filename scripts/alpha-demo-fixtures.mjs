// Synthetic, tenant-scoped business examples. No provider/payment execution,
// credential creation, fake audit events, or direct table inserts.
export function alphaDemoFixtures(now = new Date()) {
  const day = offset => new Date(now.getTime() + offset * 86400000).toISOString()
  const fixtures = []
  const add = (key, table, operation, name, params = {}, args = {}, match = { name }) => {
    fixtures.push({ key, table, operation, match, input: { ...args, params: { name, ...params } } })
  }
  const company = { companyId: '@company' }
  const currency = { currencyId: '@currency' }
  const label = text => `[Alpha demo] ${text}`
  const note = 'Synthetic Alpha demo fixture. No live payment, tax filing or external integration.'
  add('countryNL', 'country', 'create_country', 'Netherlands', { iso3: 'NLD', numcode: 528, phoneCode: '31',
    currencyId: '@currency', languageCodes: ['nl', 'en'], isActive: true,
  }, { code: 'NL' }, { code: 'NL' })

  for (const [key, name, vendor] of [['customer', 'Aurora Retail', false], ['customer2', 'Northstar Studio', false],
    ['vendor', 'Beacon Components', true], ['vendor2', 'Cedar Supply', true]]) {
    add(key, 'contact', 'create_contact', label(name), {
      type: 'company', ...company, email: `${key}@example.test`, isCustomer: !vendor, isVendor: vendor,
      customerRank: vendor ? 0 : 1, supplierRank: vendor ? 1 : 0, description: note,
    })
  }
  for (const [i, title, probability] of [[0, 'Qualified', 25], [1, 'Proposal', 60], [2, 'Negotiation', 85], [3, 'Won', 100]]) {
    add(`stage${i}`, 'opp_stage', 'create_opportunity_stage', label(title), { sequence: i + 1, probability, isActive: true, isWon: i === 3 })
  }
  for (let i = 0; i < 4; i++) {
    add(`lead${i}`, 'lead', 'create_lead', label(['Retail expansion', 'Studio equipment', 'Warehouse fit-out', 'Annual service'][i]), {
      state: 'new', priority: String(i % 3), expectedRevenue: [18000, 8500, 24000, 3600][i], probability: 25,
      email: `lead${i}@example.test`, partnerId: i % 2 ? '@customer2' : '@customer', description: note,
    })
    add(`opportunity${i}`, 'opportunity', 'create_opportunity', label(['Aurora rollout', 'Northstar refresh', 'Beacon pilot', 'Service renewal'][i]), {
      ...company, expectedRevenue: [18000, 8500, 12000, 3600][i], probability: [25, 60, 85, 100][i],
      stageId: `@stage${i}`, priority: '1', partnerId: i % 2 ? '@customer2' : '@customer',
      leadId: `@lead${i}`, isWon: i === 3, description: note,
    })
  }

  add('uomCategory', 'uom_cat', 'create_uom_category', label('Units'), { sequence: 1 })
  add('unit', 'uom', 'create_uom', label('Unit'), { categoryId: '@uomCategory', symbol: 'ea', factor: 1, rounding: 1, timesBigger: 1, isReferenceUnit: true, isActive: true })
  add('hoursCategory', 'uom_cat', 'create_uom_category', label('Time'), { sequence: 2 })
  add('hour', 'uom', 'create_uom', label('Hour'), { categoryId: '@hoursCategory', symbol: 'h', factor: 1, rounding: 0.25, timesBigger: 1, isReferenceUnit: true, isActive: true })
  add('productCategory', 'product_category', 'create_product_category', label('Equipment'), { ...company, sequence: 1 })
  for (const [key, name, usage] of [['stock', 'Main stock', 'internal'], ['input', 'Receiving', 'internal'], ['output', 'Dispatch', 'internal'],
    ['production', 'Assembly', 'production'], ['supplier', 'Suppliers', 'supplier'], ['customerLocation', 'Customers', 'customer']]) {
    add(key, 'stock_location', 'create_stock_location', label(name), { usage, locationCategory: usage, active: true, comment: note })
  }
  add('warehouse', 'warehouse', 'create_warehouse', label('Amsterdam warehouse'), {
    code: 'ADEMO', lotStockId: '@stock', whInputStockLocId: '@input', whOutputStockLocId: '@output',
    // These are operation-type codes in the current model, not row references.
    inTypeId: 1, outTypeId: 2, intTypeId: 3, packTypeId: 4, pickTypeId: 5,
    receptionSteps: 'one_step', deliverySteps: 'ship_only', manufactureSteps: 'mrp_one_step', active: true, sequence: 1,
  }, company)
  for (const [key, title, cost, price, type] of [['laptop', 'Workstation', 650, 1100, 'product'], ['monitor', 'Monitor', 120, 220, 'product'],
    ['component', 'Assembly module', 35, 70, 'product'], ['kit', 'Office bundle', 800, 1450, 'product'], ['service', 'Implementation hour', 40, 95, 'service']]) {
    add(key, 'product', 'create_product', label(title), { categId: '@productCategory', type, uomId: type === 'service' ? '@hour' : '@unit',
      uomPoId: type === 'service' ? '@hour' : '@unit', standardPrice: cost, listPrice: price, ...currency,
      defaultCode: `ALPHA-${key.toUpperCase()}`, saleOk: true, purchaseOk: true, description: note,
      warehouseId: '@warehouse', locationId: '@stock', tracking: 'none', costMethod: 'standard', valuation: 'manual_periodic',
    })
    if (type !== 'service') add(`quant-${key}`, 'stock_quant', 'create_stock_quant', undefined, {
      ...company, productId: `@${key}`, locationId: '@stock', quantity: 25, inventoryQuantity: 25,
      inventoryQuantitySet: true, cost, currencyId: '@currency', costMethod: 'standard',
    }, {}, { product_id: `@${key}`, location_id: '@stock' })
  }
  add('pricelist', 'product_pricelist', 'create_pricelist', label('EUR retail'), { ...company, ...currency, discountPolicy: 'WithDiscount' })
  for (let i = 0; i < 3; i++) {
    add(`sale${i}`, 'sale_order', 'create_sale_order', undefined, {
      ...company, ...currency, partnerId: '@customer', partnerInvoiceId: '@customer', partnerShippingId: '@customer',
      pricelistId: '@pricelist', warehouseId: '@warehouse', clientOrderRef: `ALPHA-DEMO-SO-${i + 1}`, note,
    }, {}, { client_order_ref: `ALPHA-DEMO-SO-${i + 1}` })
    for (const [n, product] of ['laptop', 'monitor'].entries()) add(`sale${i}-line${n}`, 'sale_order_line', 'create_sale_order_line', label(`${product} quotation ${i + 1}`), {
      productId: `@${product}`, quantity: i + 1, uomId: '@unit', priceUnit: product === 'laptop' ? 1100 : 220, sequence: n + 1,
    }, { orderId: `@sale${i}` })
  }
  for (let i = 0; i < 2; i++) {
    add(`purchase${i}`, 'purchase_order', 'create_purchase_order', undefined, {
      ...company, ...currency, partnerId: '@vendor', partnerRef: `ALPHA-DEMO-PO-${i + 1}`, notes: note,
    }, {}, { partner_ref: `ALPHA-DEMO-PO-${i + 1}` })
    add(`purchase${i}-line`, 'purchase_order_line', 'add_purchase_order_line', label(`Component procurement ${i + 1}`), {
      productId: '@component', quantity: 50 + i * 25, uomId: '@unit', priceUnit: 35, sequence: 1,
    }, { orderId: `@purchase${i}` }, { order_id: `@purchase${i}`, product_id: '@component' })
  }
  add('workcenter', 'mrp_workcenter', 'create_workcenter', label('Assembly bench'), { ...company, code: 'ALPHA-ASSEMBLY', active: true,
    workingState: 'normal', capacity: 1, oeeTarget: 85, timeEfficiency: 100, defaultTimeEfficiency: 100, defaultOeeTarget: 85, sequence: 1 })
  add('bom', 'mrp_bom', 'create_bom', undefined, { ...company, type: 'Manufacture', productId: '@kit', productQty: 1, productUomId: '@unit',
    readyToProduce: 'all_available', consumption: 'flexible', sequence: 1, warehouseId: '@warehouse',
    lines: [{ productId: '@laptop', productQty: 1, productUomId: '@unit', sequence: 1 }, { productId: '@monitor', productQty: 2, productUomId: '@unit', sequence: 2 }],
  }, {}, { product_id: '@kit' })
  add('manufacturing', 'mrp_production', 'create_manufacturing_order', undefined, { ...company, productId: '@kit', productQty: 3, productUomId: '@unit',
    datePlannedStart: day(2), datePlannedFinished: day(4), locationSrcId: '@stock', locationDestId: '@stock', warehouseId: '@warehouse',
    pickingTypeId: 3, bomId: '@bom', consumption: 'flexible', origin: 'ALPHA-DEMO-MO-1' }, {}, { origin: 'ALPHA-DEMO-MO-1' })

  for (const [key, title] of [['operations', 'Operations'], ['finance', 'Finance'], ['engineering', 'Engineering']]) {
    add(key, 'hr_department', 'create_department', label(title), { ...company, isActive: true, note })
  }
  add('job', 'hr_job_position', 'create_job_position', label('Operations specialist'), { ...company, departmentId: '@operations', expectedEmployees: 3, state: 'open', isActive: true })
  for (let i = 0; i < 4; i++) add(`employee${i}`, 'hr_employee', 'create_employee', label(['Alex Morgan', 'Sam Rivera', 'Robin Park', 'Jamie Ellis'][i]), {
    ...company, departmentId: ['@operations', '@finance', '@engineering', '@operations'][i], jobId: '@job', employmentType: 'FullTime',
    workEmail: `employee${i}@example.test`, employeeNumber: `ALPHA-DEMO-${i + 1}`, workLocation: 'Amsterdam demo office', isActive: true,
  })
  add('leaveType', 'hr_leave_type', 'create_leave_type', label('Annual leave'), { allocationType: 'no', maxLeaves: 25, code: 'ADEMO-LEAVE', isActive: true }, company)
  add('leave', 'hr_leave', 'create_leave_request', label('Demo annual leave request'), { employeeId: '@employee0', leaveTypeId: '@leaveType',
    dateFrom: day(14), dateTo: day(16), numberOfDays: 2, notes: note }, company)
  add('contract', 'hr_contract', 'create_contract', label('Demo employment contract'), { ...company, employeeId: '@employee0', dateStart: day(-30), wage: 3200, ...currency, notes: note })
  add('payrollStructure', 'hr_payroll_structure', 'create_payroll_structure', label('Illustrative payroll — not statutory'), { type: 'employee', isActive: true })
  add('salaryRule', 'hr_salary_rule', 'create_salary_rule', label('Illustrative base salary'), { code: 'ALPHA_BASIC', structureId: '@payrollStructure',
    category: 'BASIC', conditionType: 'always', amountType: 'fixed', amountFix: 3200, sequence: 1, isActive: true })
  add('payslip', 'hr_payslip', 'create_payslip', undefined, { ...company, employeeId: '@employee0', structId: '@payrollStructure', contractId: '@contract',
    dateFrom: day(-28), dateTo: day(-1), basicWage: 3200, notes: `${note} Not a payslip for a real person.` }, {}, { employee_id: '@employee0', struct_id: '@payrollStructure' })

  for (let i = 0; i < 2; i++) {
    add(`project${i}`, 'project_project', 'create_project', label(i ? 'Internal process improvement' : 'Aurora office rollout'), {
      ...company, ...currency, active: true, partnerId: '@customer', description: note, sequence: i + 1,
      allowSubtasks: true, allowTimesheets: true, allowTimesheetTimer: true, allowTaskDependencies: true,
      billType: 'customer_project', pricingType: 'employee_rate', privacyVisibility: 'employees', lastUpdateStatus: 'on_track', ratingStatus: 'stage', ratingStatusPeriod: 'monthly',
    })
    for (let j = 0; j < 3; j++) add(`task${i}-${j}`, 'project_task', 'create_task', label(`${i ? 'Process' : 'Rollout'} — ${['Discovery', 'Implementation', 'Acceptance'][j]}`), {
      ...company, projectId: `@project${i}`, state: 'InProgress', priority: String(j % 2), sequence: j + 1, kanbanState: 'normal',
      description: note, wbsCode: `${i + 1}.${j + 1}`, wbsLevel: 1, plannedHours: 8 + j * 4, remainingHours: 8 + j * 4,
    })
    add(`timesheet${i}`, 'project_timesheet', 'log_timesheet', label(`Discovery hours ${i + 1}`), { ...company, ...currency, projectId: `@project${i}`,
      taskId: `@task${i}-0`, employeeId: '@employee0', date: day(-1), unitAmount: 2.5, encodingUomId: '@hour', employeeCost: 40, sellRate: 95 })
    add(`milestone${i}`, 'project_milestone', 'create_project_milestone', label(`Project ${i + 1} acceptance`), { projectId: `@project${i}`, sequence: 1,
      deadline: day(30), billAmount: 1000, percentComplete: 0, active: true }, company)
  }
  add('expenseSheet', 'expense_sheet', 'create_expense_sheet', label('October travel — draft'), { ...company, ...currency, employeeId: '@employee0', notes: note })
  for (let i = 0; i < 3; i++) add(`expense${i}`, 'hr_expense', 'create_expense', label(['Train to customer', 'Workshop materials', 'Team lunch'][i]), {
    ...company, ...currency, employeeId: '@employee0', date: day(-i - 1), unitAmount: [42, 85, 64][i], quantity: 1,
    lineKind: 'Standard', paymentMode: 'OutOfPocket', description: note, clientRequestId: `alpha-demo-expense-${i}`, projectId: '@project0',
  })

  for (const [key, title, group, type] of [['assetType', 'Receivables', 'Asset', 'receivable'], ['incomeType', 'Sales income', 'Income', 'income'],
    ['expenseType', 'Operating expense', 'Expense', 'expense'], ['payableType', 'Payables', 'Liability', 'payable']]) {
    add(key, 'account_account_type', 'create_account_account_type', label(title), { ...company, internalGroup: group, type, includeInitialBalance: true })
  }
  for (const [key, title, code, type, internalType, group] of [['receivable', 'Trade receivables', 'ADEMO1100', '@assetType', 'Receivable', 'Asset'],
    ['income', 'Equipment revenue', 'ADEMO4000', '@incomeType', 'Income', 'Income'], ['expenseAccount', 'Operating expenses', 'ADEMO6000', '@expenseType', 'Expense', 'Expense'],
    ['payable', 'Trade payables', 'ADEMO2100', '@payableType', 'Payable', 'Liability']]) {
    add(key, 'account_account', 'create_account_account', label(title), { ...company, code, userTypeId: type, internalType, internalGroup: group,
      reconcile: internalType === 'Receivable' || internalType === 'Payable', note })
  }
  add('salesJournal', 'account_journal', 'create_account_journal', label('Sales journal'), { ...company, code: 'ADS', type: 'Sale', active: true, defaultAccountId: '@income' })
  add('purchaseJournal', 'account_journal', 'create_account_journal', label('Purchase journal'), { ...company, code: 'ADP', type: 'Purchase', active: true, defaultAccountId: '@expenseAccount' })
  add('analytic', 'account_analytic_account', 'create_analytic_account', label('Customer rollout cost centre'), { ...company, ...currency, code: 'ALPHA-ROLLOUT', active: true, partnerId: '@customer' })
  add('paymentTerm', 'account_payment_term', 'create_payment_term', label('Net 30'), { note: 'Demonstration payment terms; no collection is scheduled.' })
  for (const [key, journal, type, partner] of [['invoice', '@salesJournal', 'OutInvoice', '@customer'], ['bill', '@purchaseJournal', 'InInvoice', '@vendor']]) {
    add(key, 'account_move', 'create_account_move', label(`Draft ${key}`), { ...company, journalId: journal, moveType: type, date: day(0),
      idempotencyKey: `alpha-demo-${key}-v1`, partnerId: partner, ref: `ALPHA-DEMO-${key.toUpperCase()}`, autoPost: false }, {}, { ref: `ALPHA-DEMO-${key.toUpperCase()}` })
    add(`${key}Line`, 'account_move_line', 'add_account_move_line', label(`${key} equipment line`), { accountId: key === 'invoice' ? '@income' : '@expenseAccount',
      quantity: 2, priceUnit: 220, debit: key === 'bill' ? 440 : 0, credit: key === 'invoice' ? 440 : 0, sequence: 1,
      productId: '@monitor', productUomId: '@unit', partnerId: partner }, { moveId: `@${key}` })
  }

  add('helpdeskTeam', 'helpdesk_team', 'create_helpdesk_team', label('Customer success'), { description: note, isActive: true })
  add('helpdeskStage', 'helpdesk_stage', 'create_helpdesk_stage', label('New'), { teamId: '@helpdeskTeam', sequence: 1, isClosed: false })
  for (let i = 0; i < 2; i++) add(`ticket${i}`, 'helpdesk_ticket', 'create_ticket', label(i ? 'Training request' : 'Monitor setup question'), {
    teamId: '@helpdeskTeam', stageId: '@helpdeskStage', priority: i ? 'Normal' : 'High', partnerId: '@customer', description: note,
  })
  add('knowledge', 'knowledge_article', 'create_knowledge_article', label('Demo workspace guide'), { ...company, body: '<h1>Alpha demonstration</h1><p>Explore linked synthetic records. Draft payroll and invoices are illustrative, not legally valid or externally processed.</p>',
    description: note, internalPermission: 'read', sequence: 1, isPublished: false })
  add('calendar', 'calendar_event', 'create_calendar_event', label('Customer rollout kickoff'), { start: day(1), stop: new Date(now.getTime() + 90000000).toISOString(),
    privacy: 'private', showAs: 'busy', state: 'open', description: note, location: 'Demo meeting room' })
  add('vehicle', 'fleet_vehicle', 'create_fleet_vehicle', label('Service van'), { vehicleType: 'van', licensePlate: 'DEMO-ONLY', driverName: 'Demo driver' }, company)
  add('subscriptionPlan', 'subscription_plan', 'create_subscription_plan', label('Support plan — inactive'), { ...company, ...currency, code: 'ALPHA-DEMO-SUPPORT',
    journalId: '@salesJournal', productId: '@service', billingPeriod: 'monthly', billingPeriodUnit: 1, recurringInvoiceDay: 1,
    paymentMode: 'manual', active: false, trialUnit: 'month', recurringRuleMinUnit: 'month', recurringRuleMaxUnit: 'month', recurringRuleMaxCount: 12,
  })
  add('contactTag', 'contact_tag', 'create_contact_tag', label('Pilot customer'), { description: note, color: 'blue' })
  add('contactCategory', 'contact_category', 'create_contact_category', label('Business customers'), { isActive: true, color: 'blue' })
  add('qualityTeam', 'quality_team', 'create_quality_team', label('Quality assurance'), { description: note, email: 'quality@example.test' })
  add('qualityReason', 'quality_alert_reason', 'create_quality_alert_reason', label('Packaging inspection'), { description: note })
  add('trackedComponent', 'product', 'create_product', label('Lot-tracked module'), { categId: '@productCategory', type: 'product',
    uomId: '@unit', uomPoId: '@unit', standardPrice: 35, listPrice: 70, ...currency, defaultCode: 'ALPHA-LOT-MODULE',
    tracking: 'lot', saleOk: true, purchaseOk: true, description: note,
  })
  add('lot', 'stock_production_lot', 'create_stock_production_lot', label('Component batch OCT26'), { ...company, productId: '@trackedComponent',
    ref: 'ALPHA-DEMO-LOT', note, productQty: 0, locationId: '@stock' })
  add('stockInventory', 'stock_inventory', 'create_stock_inventory', label('Cycle count — draft'), { ...company,
    locationIds: ['@stock'], productIds: ['@laptop', '@monitor'], countedMode: 'all', isStockCheck: true })
  add('stockInventoryLine', 'stock_inventory_line', 'create_stock_inventory_line', undefined, {
    productId: '@laptop', productUomId: '@unit', locationId: '@stock', theoreticalQty: 25, productQty: 25,
    state: 'draft', productTracking: 'none', productType: 'product', isEditable: true,
  }, { inventoryId: '@stockInventory' }, { inventory_id: '@stockInventory', product_id: '@laptop' })
  add('routing', 'mrp_routing_workcenter', 'create_routing_workcenter', label('Assemble office bundle'), { workcenterId: '@workcenter', worksheetType: 'text',
    timeMode: 'manual', timeModeBatch: 1, timeCycleManual: 30, timeCycle: 30, sequence: 1, worksheet: note })
  add('workorder', 'mrp_workorder', 'create_workorder', label('Demo bundle assembly'), { workcenterId: '@workcenter', productionId: '@manufacturing',
    durationExpected: 90, sequence: 1, operationNote: note }, {}, { production_id: '@manufacturing', workcenter_id: '@workcenter' })
  add('applicant', 'hr_applicant', 'create_hr_applicant', label('Taylor Chen — fictional applicant'), { ...company,
    jobPositionId: '@job', email: 'applicant@example.test', stage: 'applied', notes: note })
  add('onboardingTemplate', 'hr_onboarding_template', 'create_onboarding_template', label('New starter checklist'), {
    description: note, active: true, items: [{ title: 'Read the demo workspace guide', sequence: 1, required: true },
      { title: 'Confirm access to assigned modules', sequence: 2, required: true }],
  }, company)
  add('performanceCycle', 'hr_performance_cycle', 'create_performance_cycle', label('Quarterly review — draft'), {
    description: note, startDate: day(0), endDate: day(90), state: 'draft', active: true,
  }, company)
  add('documentFolder', 'doc_folder', 'create_document_folder', label('Demo workspace'), {
    description: note, sequence: 1, residencyRegion: 'eu',
  }, company)
  add('knowledgeCategory', 'kb_category', 'create_knowledge_category', label('Getting started'), { ...company, description: note, sequence: 1 })
  for (const [key, fileName, contentType, content] of [
    ['guideDocument', 'alpha-demo-guide.txt', 'text/plain', 'Alpha demonstration workspace\nAll business records are synthetic.\nDraft invoices/payroll are illustrative only.\nNo external payments, email delivery or AI providers are enabled.\n'],
    ['importExample', 'alpha-demo-contacts.csv', 'text/csv', 'name,type,email,is_customer,is_vendor\nExample import customer,company,import@example.test,true,false\n'],
  ]) {
    add(key, 'document', 'create_document', label(fileName), { fileName, mimetype: contentType,
      fileSize: 1, url: '', checksum: '', folderId: '@documentFolder', description: note, residencyRegion: 'eu',
    }, company)
    fixtures.at(-1).blob = { fileName, contentType, content }
  }
  add('workflow', 'workflow', 'create_workflow', label('Manual purchase review — draft'), {
    workflowKey: 'alpha_demo_purchase_review', model: 'purchase_order', description: note, trigger: 'Manual', schemaVersion: 1,
    snapshotFields: [],
  }, company, { workflow_key: 'alpha_demo_purchase_review' })
  add('dashboard', 'dashboard', 'create_dashboard', label('Operations pulse'), { description: note, isDefault: false, isSystem: false }, company)
  add('widget', 'dashboard_widget', 'create_dashboard_widget', label('Demo quotation pipeline'), { widgetType: 'Kpi', model: 'sale_order',
    fields: ['amount_total'], aggregation: 'sum', positionX: 0, positionY: 0, width: 4, height: 3, isActive: true,
  }, company)
  add('reportTemplate', 'report_template', 'create_report_template', label('Quotation print layout'), { model: 'sale_order', reportType: 'qweb-pdf',
    orientation: 'Portrait', marginTop: 15, marginBottom: 15, marginLeft: 10, marginRight: 10, headerLine: true, footerLine: true,
    isActive: true, description: note, paperFormat: 'A4',
  }, company)
  add('financialReport', 'financial_report', 'create_financial_report', label('Trial balance — draft data only'), { reportType: 'TrialBalance',
    dateFrom: day(-30), dateTo: day(0), ...currency, resultCurrencyId: '@currency', targetMove: 'all', comparisonMode: 'none',
    hierarchyLevel: 3, showZeroLines: true, showHierarchy: true, showDebitCredit: true,
  }, company)
  add('savedReport', 'saved_report', 'create_saved_report', label('Trial balance by account'), { model: 'trial_balance', rowDimension: 'accountCode',
    measureField: 'closingDebit', measureOp: 'sum', isActive: true,
  }, company)
  add('posConfig', 'pos_config', 'create_pos_config', label('Showroom — not activated'), { pickingTypeId: 2, journalId: '@salesJournal',
    ...currency, pricelistId: '@pricelist', warehouseId: '@warehouse', stockLocationId: '@stock', invoiceJournalId: '@salesJournal',
    receiptHeader: 'ALPHA DEMO — no real transactions', moduleConfig: {},
  }, company)
  add('taxGroup', 'account_tax_group', 'create_account_tax_group', label('Illustrative VAT'), { sequence: 1 }, company)
  add('salesTax', 'account_tax', 'create_account_tax', label('Demo VAT 21% — review before use'), { typeTaxUse: 'Sale', amountType: 'Percent', amount: 21,
    active: true, sequence: 1, taxGroupId: '@taxGroup', countryCode: 'NL', isBaseAffected: true,
  }, company)
  const year = now.getUTCFullYear()
  add('fiscalYear', 'account_fiscal_year', 'create_fiscal_year', label(`FY ${year}`), { dateFrom: `${year}-01-01T00:00:00Z`,
    dateTo: `${year}-12-31T23:59:59Z`, type: 'normal', notes: note,
  }, company)
  add('period', 'account_period', 'create_account_period', label(`Demo period ${year}`), { code: `ADEMO${year}`,
    dateFrom: `${year}-01-01T00:00:00Z`, dateTo: `${year}-12-31T23:59:59Z`, fiscalYearId: '@fiscalYear', notes: note,
  }, company)
  add('paymentTermLine', 'account_payment_term_line', 'create_payment_term_line', undefined, { paymentTermId: '@paymentTerm', value: 'Balance',
    days: 30, sequence: 1 }, {}, { payment_term_id: '@paymentTerm', sequence: 1 })
  add('cashType', 'account_account_type', 'create_account_account_type', label('Bank liquidity'), { ...company, type: 'liquidity', internalGroup: 'Asset', includeInitialBalance: true })
  add('bankAccount', 'account_account', 'create_account_account', label('Demo bank ledger'), { ...company, code: 'ADEMO1200', userTypeId: '@cashType',
    internalType: 'Liquidity', internalGroup: 'Asset', reconcile: true, note })
  add('bankJournal', 'account_journal', 'create_account_journal', label('Demo bank journal'), { ...company, code: 'ADB', type: 'Bank', active: true, defaultAccountId: '@bankAccount' })
  add('bankStatement', 'account_bank_statement', 'create_account_bank_statement', label('Unreconciled demo statement'), {
    reference: 'ALPHA-DEMO-BANK', date: day(0), balanceStart: 0, ...currency,
  }, { ...company, journalId: '@bankJournal' })
  add('bankStatementLine', 'account_bank_statement_line', 'create_account_bank_statement_line', undefined, { date: day(-1), amount: 440, amountCurrency: 440,
    ...currency, partnerId: '@customer', amountResidual: 440, transactionType: 'DEMO', isReconciled: false,
  }, { ...company, statementId: '@bankStatement' }, { statement_id: '@bankStatement', amount: 440 })
  return fixtures
}
