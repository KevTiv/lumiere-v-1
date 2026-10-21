import type { FormValues } from "@lumiere/ui/lib/form-types"

/**
 * Explicit form field → mutation payload objects for the reports module.
 * Keeps UI fields visible at the call site and aligned with hook expectations.
 */

export function toCreateFinancialReportPayload(formData: Record<string, unknown>): Record<string, unknown> {
  return {
    name: formData.name,
    reportType: formData.reportType,
    comparisonMode: formData.comparisonMode,
    dateFrom: formData.dateFrom,
    dateTo: formData.dateTo,
    currencyId: formData.currencyId,
    hierarchyLevel: formData.hierarchyLevel,
    targetMove: formData.targetMove,
    showDebitCredit: formData.showDebitCredit,
    showZeroLines: formData.showZeroLines,
    showHierarchy: formData.showHierarchy,
    showPercentage: formData.showPercentage,
  }
}

function reportSourceModel(formData: FormValues): unknown {
  return formData.reportSource === "account.move" ? "account.move" : formData.model
}

export function toCreateReportTemplatePayload(formData: Record<string, unknown>): Record<string, unknown> {
  return {
    name: formData.name,
    model: reportSourceModel(formData),
    reportType: formData.reportType,
    orientation: formData.orientation,
    marginTop: formData.marginTop,
    marginBottom: formData.marginBottom,
    marginLeft: formData.marginLeft,
    marginRight: formData.marginRight,
    headerLine: formData.headerLine,
    footerLine: formData.footerLine,
    attachmentUse: formData.attachmentUse,
    multiCompany: formData.multiCompany,
    isActive: formData.isActive,
    companyId: formData.companyId,
  }
}

export function toCreateScheduledReportPayload(formData: Record<string, unknown>): Record<string, unknown> {
  return {
    name: formData.name,
    reportTemplateId: formData.reportTemplateId,
    model: reportSourceModel(formData),
    frequency: formData.frequency,
    nextRun: formData.nextRun,
    attachmentFormat: formData.attachmentFormat,
    recipients: formData.recipients,
    isActive: formData.isActive,
    companyId: formData.companyId,
  }
}

export function toCreateAnalyticsMetricPayload(formData: Record<string, unknown>): Record<string, unknown> {
  return {
    name: formData.name,
    category: formData.category,
    metricType: formData.metricType,
    model: formData.model,
    field: formData.field,
    aggregation: formData.aggregation,
    timePeriod: formData.timePeriod,
    refreshFrequencyMinutes: formData.refreshFrequencyMinutes,
    targetValue: formData.targetValue,
    isActive: formData.isActive,
    companyId: formData.companyId,
  }
}

import { toCreateTrialBalanceEntryParams } from "@lumiere/erp-shared/reports-create-params"

export function toCreateTrialBalanceEntryPayload(formData: Record<string, unknown>): Record<string, unknown> {
  const params = toCreateTrialBalanceEntryParams(formData)
  if (!params) {
    return {
      reportId: formData.reportId,
      accountId: formData.accountId,
      accountCode: formData.accountCode,
      accountName: formData.accountName,
      openingDebit: formData.openingDebit,
      openingCredit: formData.openingCredit,
      periodDebit: formData.periodDebit,
      periodCredit: formData.periodCredit,
      currencyId: formData.currencyId,
      level: formData.level,
      isLeaf: formData.isLeaf,
    }
  }
  return params as unknown as Record<string, unknown>
}

export function toCreateDashboardPayload(formData: Record<string, unknown>): Record<string, unknown> {
  return {
    name: formData.name,
    description: formData.description,
    isActive: formData.isActive,
    companyId: formData.companyId,
  }
}

export function toCreateDashboardWidgetPayload(formData: Record<string, unknown>): Record<string, unknown> {
  const companyId = String(formData.companyId ?? "").trim()
  return {
    name: formData.name,
    widgetType: formData.widgetType,
    dataSource: formData.dataSource,
    aggregation: formData.aggregation,
    groupBy: formData.groupBy,
    chartType: formData.chartType,
    domain: companyId ? JSON.stringify({ company_id: companyId }) : undefined,
    companyId: formData.companyId,
  }
}

export function toUpdateFinancialReportFormPayload(
  formData: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: formData.name,
    comparisonMode: formData.comparisonMode,
    dateFrom: formData.dateFrom,
    dateTo: formData.dateTo,
    hierarchyLevel: formData.hierarchyLevel,
    targetMove: formData.targetMove,
    showDebitCredit: formData.showDebitCredit,
    showZeroLines: formData.showZeroLines,
    showHierarchy: formData.showHierarchy,
    showPercentage: formData.showPercentage,
    metadata: formData.metadata,
  }
}
