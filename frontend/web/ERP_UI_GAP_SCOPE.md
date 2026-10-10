# ERP UI gap scope

Scope for the planned passes on PR #151: records the web app never shows, and mutation hooks no screen calls. Counted on `claude/ui-polish-pass-1` (2026-10-06); rerun the counts before starting a pass, because the numbers move as other PRs merge.

## How this was counted

- **Unread tables:** public, non-scheduled `#[table]`s in `spacetimedb/src` that no web code reads, either through a subscription descriptor (`packages/stdb/src/generated/org-subscription-descriptors.ts`), an `/api/query/<resource>` key in `crates/stdb-auth/assets/resource_registry.json`, or by name.
- **Unused hooks:** mutation hooks exported from `packages/query-hooks/src` that no screen imports, directly or through another hook or a `*Mutations` bundle a screen uses.
- **Reached another way:** the hook's reducer is still called from a screen, an `erp-workflows` runner, or an `erp-shared` helper. The `*_UI_REDUCERS` coverage-tracker lists are excluded, because naming a reducer there does not make it callable.

## Summary

| | Count |
|---|---|
| Public tables | 389 |
| Public tables never read by the web app | 89 (about 55 user-facing) |
| Mutation hooks | 802 |
| Mutation hooks no screen uses | 114 |
| … whose reducer has no UI at all | **90** |
| … whose reducer a screen reaches another way (duplicate hooks) | 24 |

## A. Records to show (read side)

A create form for a record the user can never list is a dead end, so each write below needs its list first.

| Area | Tables | UI to build | Pass |
|---|---|---|---|
| Accounting | `profit_loss_line`, `balance_sheet_line`, `cash_flow_line` | Financial statements in Reports with drill-down to journal items | 11 |
| Accounting | `bank_statement_import_line`, `tax_deadline_reminder`, `consolidation_company_rate` | Lines on the bank statement record; reminders on the tax deadline; rates in Consolidation | 11 |
| HR | `hr_leave_allocation`, `hr_offboarding_checklist`, `hr_statutory_id` | Allocations tab beside Leaves; offboarding checklist and statutory IDs on the employee record | 11 |
| POS | `pos_order`, `pos_order_line`, `pos_payment` | Order history with lines and payments, and reprint/refund from it | 11 |
| Inventory | `product_attribute`, `product_attribute_line`, `product_attribute_value` | Attributes and variants on the product record | 11 |
| Inventory | `product_supplier_info`, `product_packaging` | Vendor price lists and packagings on the product record; unblocks the ID-only forms noted in #151 | 11 |
| Inventory | `stock_move_line` | Detailed operations (lot/serial, from/to location) on the transfer record | 11 |
| Inventory | `stock_count_sheet`, `stock_inventory_line`, `inventory_close`, `inventory_close_line` | Count sheets and inventory close under Adjustments | 11 |
| Inventory | `quality_point`, `quality_alert_reason`, `stock_reorder_group` | Configuration lists | 11 / 12 |
| Sales | `sale_order_option`, `sale_promotion`, `sale_contract`, `sale_cpq_constraint` | Optional products on the order; promotions and contracts lists; CPQ rules in configuration | 11 |
| Sales | `sale_commission_plan`, `sale_commission_plan_split` | Commission plans list (today they can be created by prompt but never seen) | 11 |
| Sales / Accounting | `account_fiscal_position`, `account_fiscal_position_tax`, `account_incoterm` | Configuration lists, and pickers on orders and invoices | 13 |
| Settings | `document_sequence`, `uom_cat`, `uom_conversion` | Document numbering; units of measure | 13 |
| Settings | `google_drive_connection`, `whatsapp_business_account` | Integrations page | 13 |
| Expenses | `hr_expense_policy`, `hr_expense_advance_application`, `hr_expense_allocation` | Policies in configuration; advances and allocations on the expense report | 11 |
| Documents | `document_signature_request`, `document_legal_hold`, `document_external_ref` | Signature requests and legal holds on the document record | 11 |
| Reports | `generated_owner_report`, `scheduled_report_run` | Report history and scheduled-run log | 11 |
| Other | `project_task_stage`, `helpdesk_team_member`, `mrp_loss_category`, `stock_landed_cost_allocation`, `import_job_record`, `bom_explosion_result` | Task stages (kanban columns); team members; loss categories; landed cost split on the cost record; import history; BOM explosion result | 11 / 12 |

**Not user-facing; decide before building anything:**
- 16 AI tables (`ai_decision_*`, `ai_skill_certification_*`, `ai_run_review`, `ai_model_profile`, …). Some may belong in an AI admin screen.
- Internal tables:
  - schema migrations, queue jobs and workers
  - cold-tier identity
  - organization reconstruction
  - presence
  - `search_embedding`
  - `*_integration_intent`
  - `hr_payroll_export_intent`
- Audit and admin tables: `hr_pii_access_log`, `inventory_audit_run` and `inventory_audit_violation`, country-pack definitions and defaults, `workflow_migration_instance_result`.

## B. Actions to wire (write side): 90 hooks with no UI

What each kind of row means:
- **Record action:** a button on the record header, visible only when the record's state allows it (the Pass 5 pattern). For sale orders, purchase orders, invoices and transfers these land with Passes 5 and 8; the rest land in Pass 11.
- **Create / Edit form:** a `useFormDialog` form using record pickers (Pass 6), never ID fields.
- **Delete/archive:** an action with the table's confirm dialog.
- **Operations button:** goes in the module's Operations tab.
- **Check:** confirm whether a person should trigger this, or whether it is system-only, before building UI.

Every new action uses the Pass 4 behaviour: awaited, pending state, errors shown, all selected rows handled.

| Screen | Hook | Reducer | UI to build |
|---|---|---|---|
| Purchasing | `useAddPurchaseRequisitionLine` | `add_purchase_requisition_line` | Create form |
| Purchasing | `useCreateBillFromPurchaseOrder` | `create_bill_from_purchase_order` | Create form |
| Purchasing | `useCreateVendorCreditFromPurchaseReturn` | `create_vendor_credit_from_purchase_return` | Create form |
| Purchasing | `useComputeLandedCosts` | `compute_landed_costs` | Operations button |
| Purchasing | `useApprovePurchaseRequisition` | `approve_purchase_requisition` | Record action |
| Purchasing | `useApproveSupplierIntake` | `approve_supplier_intake` | Record action |
| Purchasing | `useCancelPurchaseOrder` | `cancel_purchase_order` | Record action |
| Purchasing | `useCancelPurchaseRequisition` | `cancel_purchase_requisition` | Record action |
| Purchasing | `useClosePurchaseRequisition` | `close_purchase_requisition` | Record action |
| Purchasing | `useConvertPurchaseRequisitionToPo` | `convert_purchase_requisition_to_po` | Record action |
| Purchasing | `usePostLandedCosts` | `post_landed_costs` | Record action |
| Purchasing | `useRejectSupplierIntake` | `reject_supplier_intake` | Record action |
| Purchasing | `useSendPurchaseOrder` | `send_purchase_order` | Record action |
| Purchasing | `useSubmitPurchaseRequisition` | `submit_purchase_requisition` | Record action |
| Inventory | `useCreatePackagingMaterial` | `create_packaging_material` | Create form |
| Inventory | `useExecuteCrossDock` | `execute_cross_dock` | Operations button |
| Inventory | `useExecuteDirectedPutaway` | `execute_directed_putaway` | Operations button |
| Inventory | `useRunCartonization` | `run_cartonization` | Operations button |
| Inventory | `useCreateInventoryIntegrationIntent` | `create_inventory_integration_intent` | Check: may be system-only |
| Inventory | `useRecordInventoryIntegrationResult` | `record_inventory_integration_result` | Check: may be system-only |
| Inventory | `useActivateConsignmentAgreement` | `activate_consignment_agreement` | Record action |
| Inventory | `useAssignStockPicking` | `assign_stock_picking` | Record action |
| Inventory | `useCancelStockPicking` | `cancel_stock_picking` | Record action |
| Inventory | `useConfirmStockPackage` | `confirm_stock_package` | Record action |
| Inventory | `useConfirmStockPicking` | `confirm_stock_picking` | Record action |
| Inventory | `useMoveStockItem3D` | `move_stock_item3_d` | Record action |
| Inventory | `useReceiveConsignmentStock` | `receive_consignment_stock` | Record action |
| Accounting › Taxes | `useCreateAccountTaxGroup` | `create_account_tax_group` | Create form |
| Accounting › Taxes | `useCreateTaxDeadline` | `create_tax_deadline` | Create form |
| Accounting › Taxes | `useCreateTaxJurisdiction` | `create_tax_jurisdiction` | Create form |
| Accounting › Taxes | `useCreateTaxSchedule` | `create_tax_schedule` | Create form |
| Accounting › Taxes | `useDeleteTaxDeadline` | `delete_tax_deadline` | Delete/archive (confirm) |
| Accounting › Taxes | `useUpdateAccountTax` | `update_account_tax` | Edit form |
| Accounting › Taxes | `useUpdateAccountTaxGroup` | `update_account_tax_group` | Edit form |
| Accounting › Taxes | `useUpdateTaxDeadline` | `update_tax_deadline` | Edit form |
| Accounting › Taxes | `useUpdateTaxJurisdiction` | `update_tax_jurisdiction` | Edit form |
| Accounting › Taxes | `useUpdateTaxSchedule` | `update_tax_schedule` | Edit form |
| Accounting › Taxes | `useCompleteTaxDeadline` | `complete_tax_deadline` | Record action |
| Workflows | `useAddWorkflowActivity` | `add_workflow_activity` | Create form |
| Workflows | `useAddWorkflowTransition` | `add_workflow_transition` | Create form |
| Workflows | `useSetWorkflowActive` | `set_workflow_active` | Edit form |
| Workflows | `useSetWorkitemException` | `set_workitem_exception` | Edit form |
| Workflows | `useCancelWorkflowInstance` | `cancel_workflow_instance` | Record action |
| Workflows | `useStartWorkflow` | `start_workflow` | Record action |
| CRM | `useArchiveContactCategory` | `archive_contact_category` | Delete/archive (confirm) |
| CRM | `useRemoveContactCategories` | `remove_contact_categories` | Delete/archive (confirm) |
| CRM | `useUpdateLeadAddress` | `update_lead_address` | Edit form |
| CRM | `useUpdateLeadDetails` | `update_lead_details` | Edit form |
| CRM | `useUpdateLeadRevenue` | `update_lead_revenue` | Edit form |
| Documents | `useCreateDocumentSignatureRequest` | `create_document_signature_request` | Create form |
| Documents | `useDeleteKnowledgeCategory` | `delete_knowledge_category` | Delete/archive (confirm) |
| Documents | `useRemoveArticleMember` | `remove_article_member` | Delete/archive (confirm) |
| Documents | `useUpdateKnowledgeCategory` | `update_knowledge_category` | Edit form |
| Documents | `useScheduleDocumentRetentionPurge` | `schedule_document_retention_purge` | Operations button |
| Proposals | `useCreateProposalTemplate` | `create_proposal_template` | Create form |
| Proposals | `useUpsertProposalProcurementScore` | `upsert_proposal_procurement_score` | Edit form |
| Proposals | `useConvertProposalToProject` | `convert_proposal_to_project` | Record action |
| Proposals | `useRecordProposalBidDecision` | `record_proposal_bid_decision` | Record action |
| Proposals | `useResolveProposalSectionConflict` | `resolve_proposal_section_conflict` | Record action |
| Sales | `useCreateCreditNoteFromReturnOrder` | `create_credit_note_from_return_order` | Create form |
| Sales | `useComputeSoTotals` | `compute_sale_order_totals` | Operations button |
| Sales | `useCancelReturnOrder` | `cancel_return_order` | Record action |
| Sales | `useConfirmReturnOrder` | `confirm_return_order` | Record action |
| Sales | `useConfirmSaleOrder` | `confirm_sale_order` | Record action |
| Subscriptions | `useCreateSubscriptionBundle` | `create_subscription_bundle` | Create form |
| Subscriptions | `useUpdateSubscriptionPlan` | `update_subscription_plan` | Edit form |
| Subscriptions | `useCreateSubscriptionPaymentIntent` | `create_subscription_payment_intent` | Check: may be system-only |
| Subscriptions | `useActivateSubscriptionPlan` | `activate_subscription_plan` | Record action |
| Subscriptions | `useDeactivateSubscriptionPlan` | `deactivate_subscription_plan` | Record action |
| Helpdesk | `useImportHelpdeskSlaCsv` | `import_helpdesk_sla_csv` | CSV import |
| Helpdesk | `useImportHelpdeskStageCsv` | `import_helpdesk_stage_csv` | CSV import |
| Helpdesk | `useImportHelpdeskTeamCsv` | `import_helpdesk_team_csv` | CSV import |
| AI Skills | `useUpsertAiSkill` | `upsert_ai_skill` | Edit form |
| AI Skills | `useRunAiSkill` | `run_ai_skill` | Operations button |
| Accounting › Bank statements | `useCreateAccountBankStatement` | `create_account_bank_statement` | Create form |
| Accounting › Bank statements | `useUpdateAccountBankStatement` | `update_account_bank_statement` | Edit form |
| Accounting › Fixed assets | `useCreateAccountAsset` | `create_account_asset` | Create form |
| Accounting › Fixed assets | `useUpdateAccountAsset` | `update_account_asset` | Edit form |
| Accounting › Payments | `usePostAccountPayment` | `post_account_payment` | Record action |
| Accounting › Payments | `useReconcilePaymentWithInvoice` | `reconcile_payment_with_invoice` | Record action |
| Inventory › Inventory close | `useCreateInventoryClose` | `create_inventory_close` | Create form |
| Inventory › Inventory close | `useRunInventoryClose` | `run_inventory_close` | Operations button |
| Accounting › Chart of accounts | `useUpdateAccountAccount` | `update_account_account` | Edit form |
| Accounting › Consolidation | `useSetConsolidationCompanyRate` | `set_consolidation_company_rate` | Edit form |
| Approvals | `useCreateApprovalRule` | `create_approval_rule` | Create form |
| Expenses | `useApplyExpenseIntegrationIntent` | `apply_expense_integration_intent` | Check: may be system-only |
| HR | `useCreateWorkSchedule` | `create_work_schedule` | Create form |
| Messages | `usePostInternalNote` | `post_internal_note` | Record action |
| Settings | `useCreateOrganization` | `create_organization` | Create form |
| Settings › AI | `useUpdateAiReducerAllowlist` | `update_ai_reducer_allowlist` | Edit form |

#### Duplicate hooks (reducer already reached another way)

| Hook | Reducer |
|---|---|
| `useAcceptSaleOrderQuotation` | `accept_sale_order_quotation` |
| `useApplyLandedCosts` | `apply_landed_costs` |
| `useCancelLandedCost` | `cancel_landed_cost` |
| `useCancelSaleOrder` | `cancel_sale_order` |
| `useConfirmPurchaseOrder` | `confirm_purchase_order` |
| `useConfirmPurchaseReturn` | `confirm_purchase_return` |
| `useCreateExchangeOrderFromReturn` | `create_exchange_order_from_return` |
| `useCreateInvoiceFromSaleOrder` | `create_invoice_from_sale_order` |
| `useCreateReturnOrder` | `create_return_order` |
| `useCreateSaleOrderLine` | `create_sale_order_line` |
| `useCreateSupplierIntake` | `submit_supplier_intake` |
| `useDeleteSaleOrderLine` | `delete_sale_order_line` |
| `useLockSaleOrder` | `lock_sale_order` |
| `usePackStockPicking` | `pack_stock_picking` |
| `usePostInvoice` | `post_invoice` |
| `useReceivePurchaseOrderLine` | `receive_purchase_order_line` |
| `useRegisterPaymentOnInvoice` | `register_payment_on_invoice` |
| `useReleaseBlanketToPo` | `release_blanket_to_po` |
| `useSendSaleOrderQuotation` | `send_sale_order_quotation` |
| `useUnlockSaleOrder` | `unlock_sale_order` |
| `useUpdateContactCategory` | `update_contact_category` |
| `useUpdateSaleOrder` | `update_sale_order` |
| `useUpdateSaleOrderLine` | `update_sale_order_line` |
| `useValidateStockPicking` | `validate_stock_picking` |
The 24 duplicate hooks need no new UI. In Pass 11, either switch the screen to the hook (so cache invalidation lives in one place) or delete the hook. `useUpdateContactCategory` is reached only through a form config; check that the form is rendered before deleting it.

## Rerunning the counts

The scans are not checked in yet. Pass 11 adds them to `scripts/track-reducer-coverage.ts`, whose current UI detection finds only 23 reachable reducers. A pass is done when its rows are gone from a fresh run, or have moved to "Not user-facing" with a reason.
