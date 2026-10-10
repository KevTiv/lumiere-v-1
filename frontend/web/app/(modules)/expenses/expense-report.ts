import { expenseVariantTag } from '@/lib/expense-state';

type Row = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Where an expense report's page lives. */
export function expenseReportHref(sheet: Row): string | undefined {
  return sheet.id == null ? undefined : `/expenses/reports/${String(sheet.id)}`;
}

/** Draft → submitted → approved → posted → done; a refused report is shown outside the flow. */
export function expenseReportStatusBar(
  sheet: Row,
  t: Translate,
): { steps: Array<{ id: string; label: string }>; current: string; terminal?: { label: string } } {
  const state = expenseVariantTag(sheet.state);
  const label = (key: string, fallback: string) =>
    t(`expenses.expenseReports.filters.state.options.${key}`, { defaultValue: fallback });
  const steps = [
    { id: 'Draft', label: label('Draft', 'Draft') },
    { id: 'Submitted', label: label('Submitted', 'Submitted') },
    { id: 'Approved', label: label('Approved', 'Approved') },
    { id: 'Posted', label: label('Posted', 'Posted') },
    { id: 'Done', label: label('Done', 'Done') },
  ];
  if (state === 'Refused') return { steps, current: '', terminal: { label: label('Refused', 'Refused') } };
  return { steps, current: state };
}

/** The expenses on one report. */
export function expensesOfReport(expenses: ReadonlyArray<Row>, sheetId: string): Row[] {
  return expenses.filter((row) => String(row.sheetId ?? row.sheet_id ?? '') === sheetId);
}

/** The accounting entries a report has produced: its journal entry, reimbursement and rebill. */
export function reportMoveIds(sheet: Row): Array<{ key: 'post' | 'reimbursement' | 'rebill'; id: string }> {
  const pick = (camel: string, snake: string) => {
    const value = sheet[camel] ?? sheet[snake];
    return value != null && value !== '' ? String(value) : undefined;
  };
  const entries: Array<{ key: 'post' | 'reimbursement' | 'rebill'; id: string | undefined }> = [
    { key: 'post', id: pick('accountMoveId', 'account_move_id') },
    { key: 'reimbursement', id: pick('reimbursementMoveId', 'reimbursement_move_id') },
    { key: 'rebill', id: pick('rebillMoveId', 'rebill_move_id') },
  ];
  return entries.filter((entry): entry is { key: 'post' | 'reimbursement' | 'rebill'; id: string } => entry.id != null);
}
