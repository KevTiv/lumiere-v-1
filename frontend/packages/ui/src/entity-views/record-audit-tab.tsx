"use client";

import { LegacyRecordAuditTab } from "./legacy-record-audit-tab";
import { RecordBusinessHistory, type RecordBusinessHistoryProps } from "./record-business-history";

/** Compatibility export for existing record hosts; reads are scoped and paginated. */
export function RecordAuditTab(props: RecordBusinessHistoryProps) {
  if (["project_project", "mrp_production", "pos_session"].includes(props.tableName)) {
    return <LegacyRecordAuditTab tableName={props.tableName} recordId={props.recordId} className={props.className} />;
  }
  return <RecordBusinessHistory {...props} />;
}
