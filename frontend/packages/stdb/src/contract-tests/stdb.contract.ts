/**
 * Compile-only — generic stdb BFF helpers use generated named inputs.
 */
import {
  SESSION_OPERATION_DESCRIPTORS,
  type SessionOperationName,
} from "@lumiere/contracts/generated/operation-descriptors";

import {
  stdbBffCallUrl,
  stdbBffCommandPost,
  stdbCommandContract,
} from "../commands/stdb-http";

void stdbBffCallUrl("confirm_sales_order");
void stdbBffCommandPost("confirm_sales_order", { companyId: 1n, orderId: 2n });
void stdbCommandContract("confirm_sales_order");

// Documents and workflows rely on these reducers being present in both the
// released session descriptor and generated named input map.
void stdbBffCommandPost("release_document_legal_hold", {
  holdId: 3n,
  params: { metadata: undefined },
});
void stdbBffCommandPost("request_workflow_subject_snapshot", {
  companyId: 4n,
  params: {
    subjectModel: "sale_order",
    subjectId: 5n,
    workflowVersionId: 6n,
  },
});
void SESSION_OPERATION_DESCRIPTORS.release_document_legal_hold.contractOperationId;
void SESSION_OPERATION_DESCRIPTORS.request_workflow_subject_snapshot.contractOperationId;

const sessionOperation: SessionOperationName = "confirm_sales_order";
void SESSION_OPERATION_DESCRIPTORS[sessionOperation];
void SESSION_OPERATION_DESCRIPTORS[sessionOperation].contractOperationId;

// @ts-expect-error denied operations are absent from the session descriptor.
void stdbBffCallUrl("apply_global_migrations");

// @ts-expect-error unknown reducer names are rejected.
void stdbBffCommandPost("confirm_sale_order", { companyId: 1n, orderId: 2n });
