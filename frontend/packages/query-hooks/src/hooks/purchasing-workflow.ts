import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { CreateBillFromPurchaseOrderParams } from "@lumiere/stdb/types"
import {
  APPLY_LANDED_COST_AFFECTS,
  AWARD_RFQ_BID_AFFECTS,
  CANCEL_PURCHASE_ORDER_AFFECTS,
  CONFIRM_PURCHASE_ORDER_AFFECTS,
  CONFIRM_PURCHASE_RETURN_AFFECTS,
  CONVERT_REQUISITION_AFFECTS,
  CREATE_BILL_FROM_PURCHASE_ORDER_AFFECTS,
  LANDED_COST_DRAFT_AFFECTS,
  POST_LANDED_COST_AFFECTS,
  RECEIVE_PO_LINE_AFFECTS,
  RELEASE_BLANKET_AFFECTS,
  REQUISITION_TRANSITION_AFFECTS,
  SEND_PURCHASE_ORDER_AFFECTS,
  SUPPLIER_INTAKE_TRANSITION_AFFECTS,
  VENDOR_CREDIT_FROM_RETURN_AFFECTS,
  WorkflowError,
  applyLandedCostAction,
  approveRequisitionAction,
  approveSupplierIntakeAction,
  awardRfqBidAction,
  cancelLandedCostAction,
  cancelPurchaseOrderAction,
  cancelRequisitionAction,
  closeRequisitionAction,
  computeLandedCostAction,
  confirmPurchaseOrderAction,
  confirmPurchaseReturnAction,
  convertRequisitionAction,
  createBillFromPurchaseOrderAction,
  createVendorCreditFromReturnAction,
  holdSupplierIntakeAction,
  observeAwardedRfq,
  observeBlanketRelease,
  observeConfirmedPurchaseOrder,
  observeConfirmedPurchaseReturn,
  observeConvertedRequisition,
  observeCreatedBill,
  purchaseOrderInvoiceIds,
  landedCostWorkflow,
  purchaseOrderWorkflow,
  purchaseRequisitionWorkflow,
  recordRef,
  supplierIntakeWorkflow,
  requisitionPurchaseIds,
  observeReceivedLine,
  observeReturnVendorCredit,
  observeSameRecord,
  observeSentPurchaseOrder,
  postLandedCostAction,
  receivePurchaseLineAction,
  resolveOpenReceiptTarget,
  rejectSupplierIntakeAction,
  releaseBlanketAction,
  reviewSupplierIntakeAction,
  sendPurchaseOrderAction,
  stateIs,
  submitRequisitionAction,
  type AnyWorkflowAction,
  type ApproveSupplierIntakeInput,
  type AwardRfqBidInput,
  type CreateBillFromPurchaseOrderInput,
  type CreateVendorCreditInput,
  type ObservedTransition,
  type ReceiptTarget,
  type ReceivePurchaseLineInput,
  type ReleaseBlanketInput,
  type ReviewSupplierIntakeInput,
  type RowValueMap,
  type SupplierIntakeReasonInput,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import { fetchQueryList } from "../http"
import { stockMovesQueryOptions } from "./inventory/stock-operations"
import {
  applyLandedCostsCommand,
  approvePurchaseRequisitionCommand,
  approveSupplierIntakeCommand,
  awardPurchaseRfqBidCommand,
  cancelLandedCostCommand,
  cancelPurchaseOrderCommand,
  cancelPurchaseRequisitionCommand,
  closePurchaseRequisitionCommand,
  computeLandedCostsCommand,
  confirmPurchaseOrderCommand,
  confirmPurchaseReturnCommand,
  convertPurchaseRequisitionToPoCommand,
  createBillFromPurchaseOrderCommand,
  createVendorCreditFromPurchaseReturnCommand,
  holdSupplierIntakeCommand,
  postLandedCostsCommand,
  purchaseOrdersQueryOptions,
  purchaseRequisitionsQueryOptions,
  purchaseReturnsQueryOptions,
  purchaseRfqsQueryOptions,
  receivePurchaseOrderLineCommand,
  rejectSupplierIntakeCommand,
  releaseBlanketToPoCommand,
  reviewSupplierIntakeCommand,
  sendPurchaseOrderCommand,
  submitPurchaseRequisitionCommand,
  type VendorCreditFromReturnParams,
} from "./purchasing"
import type { ReleaseBlanketToPoParams } from "./purchasing"
import { useWorkflowRunner, type WorkflowSurfaceCallbacks } from "./workflow"

export interface PurchasingWorkflowLabels {
  submitRequisition: string
  approveRequisition: string
  convertRequisition: string
  closeRequisition: string
  cancelRequisition: string
  sendOrder: string
  confirmOrder: string
  cancelOrder: string
  createBill: string
  receiveLine: string
  awardBid: string
  reviewIntake: string
  approveIntake: string
  holdIntake: string
  rejectIntake: string
  /** Reasons recorded when hold/reject run from a table row rather than a form. */
  holdIntakeReason: string
  rejectIntakeReason: string
  computeLandedCost: string
  postLandedCost: string
  applyLandedCost: string
  cancelLandedCost: string
  confirmReturn: string
  createVendorCredit: string
  releaseBlanket: string
}

type BillInput = CreateBillFromPurchaseOrderInput<CreateBillFromPurchaseOrderParams>
type BillRunInput = BillInput & { invoiceIdsBefore: string[] }
type ConvertRunInput = { requisitionId: string; purchaseIdsBefore: string[] }
type ReceiveRunInput = ReceivePurchaseLineInput & { receiptTarget?: ReceiptTarget }
type VendorCreditInput = CreateVendorCreditInput<VendorCreditFromReturnParams>
type ReleaseInput = ReleaseBlanketInput<ReleaseBlanketToPoParams>

type Readback<TInput> =
  | { observe(input: TInput): Promise<ObservedTransition> }
  | { noReadback: string }

/** Pins a spec's input type to the workflow action's (commands accept wider scalar ids). */
const typed = <TInput,>(spec: TransitionSpec<TInput>) => spec

const companyRequired = (what: string) => new WorkflowError("validation", `companyId is required to ${what}`)

/**
 * Procure-to-pay record workflows: requisition → RFQ award → PO → receipt → vendor bill, plus
 * supplier intake, landed costs, purchase returns and blanket releases. Actions bind generated
 * commands and run through the shared completion path. The vendor bill and credit post and pay
 * through the accounting invoice workflow.
 */
export function usePurchasingWorkflow(
  organizationId: bigint,
  companyId: bigint | undefined,
  labels: PurchasingWorkflowLabels,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const specs = useMemo(() => {
    const fresh = <T,>(options: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; staleTime: number }) =>
      qc.fetchQuery({ ...options, staleTime: 0 }) as Promise<T>
    const orders = () => fresh<RowValueMap[]>(purchaseOrdersQueryOptions(organizationId))
    const requisitions = () => fresh<RowValueMap[]>(purchaseRequisitionsQueryOptions(organizationId))
    const requireCompany = (what: string) => {
      if (companyId == null || companyId === 0n) throw companyRequired(what)
      return companyId
    }

    const idSpec = (
      id: string,
      command: (id: string) => Promise<void>,
      affects: readonly string[],
      readback: Readback<string>,
    ): TransitionSpec<string> => ({ id, command, affects, ...readback })

    /** In-place transitions: the same record must read back in `state`. */
    const sameRecordIn =
      (workflow: { resource: string; module: string }, rows: () => Promise<RowValueMap[]>, state: string) =>
      async (id: string | bigint | number) =>
        observeSameRecord(recordRef(workflow.resource, id, workflow.module), await rows(), stateIs(state))
    const requisitionIn = (state: string) => sameRecordIn(purchaseRequisitionWorkflow, requisitions, state)
    const orderIn = (state: string) => sameRecordIn(purchaseOrderWorkflow, orders, state)
    const intakes = () => fetchQueryList("/api/query/supplier-intakes", "Failed to read supplier intakes")
    const intakeIn = (state: string) => sameRecordIn(supplierIntakeWorkflow, intakes, state)
    const landedCosts = () => fetchQueryList("/api/query/landed-costs", "Failed to read landed costs")
    const landedCostIn = (state: string) => sameRecordIn(landedCostWorkflow, landedCosts, state)

    return {
      submitRequisition: idSpec("purchasing.requisition.submit", submitPurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS, {
        observe: requisitionIn("InProgress"),
      }),
      approveRequisition: idSpec("purchasing.requisition.approve", approvePurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS, {
        observe: requisitionIn("Approved"),
      }),
      closeRequisition: idSpec("purchasing.requisition.close", closePurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS, {
        observe: requisitionIn("Closed"),
      }),
      cancelRequisition: idSpec("purchasing.requisition.cancel", cancelPurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS, {
        observe: requisitionIn("Cancelled"),
      }),
      convertRequisition: typed<ConvertRunInput>({
        id: "purchasing.requisition.convert",
        command: ({ requisitionId }) => convertPurchaseRequisitionToPoCommand(companyId, requisitionId),
        affects: CONVERT_REQUISITION_AFFECTS,
        observe: async ({ requisitionId, purchaseIdsBefore }) =>
          observeConvertedRequisition(requisitionId, purchaseIdsBefore, await requisitions()),
      }),

      sendOrder: idSpec("purchasing.order.send", sendPurchaseOrderCommand, SEND_PURCHASE_ORDER_AFFECTS, {
        observe: async (id) => observeSentPurchaseOrder(id, await orders()),
      }),
      confirmOrder: idSpec(
        "purchasing.order.confirm",
        confirmPurchaseOrderCommand,
        CONFIRM_PURCHASE_ORDER_AFFECTS,
        { observe: async (id) => observeConfirmedPurchaseOrder(id, await orders()) },
      ),
      cancelOrder: idSpec("purchasing.order.cancel", cancelPurchaseOrderCommand, CANCEL_PURCHASE_ORDER_AFFECTS, {
        observe: orderIn("Cancelled"),
      }),

      createBill: typed<BillRunInput>({
        id: "purchasing.order.create-bill",
        command: (input) =>
          createBillFromPurchaseOrderCommand({
            orderId: input.orderId,
            params: input.params,
          }),
        affects: CREATE_BILL_FROM_PURCHASE_ORDER_AFFECTS,
        observe: async ({ orderId, invoiceIdsBefore }) =>
          observeCreatedBill(orderId, invoiceIdsBefore, await orders()),
      }),

      receiveLine: typed<ReceiveRunInput>({
        id: "purchasing.line.receive",
        command: (input) =>
          receivePurchaseOrderLineCommand({
            lineId: input.lineId,
            qty: input.qty,
            lotId: input.lotId,
          }),
        affects: RECEIVE_PO_LINE_AFFECTS,
        observe: async ({ lineId, receiptTarget }) =>
          observeReceivedLine(
            lineId,
            receiptTarget,
            await fresh<RowValueMap[]>(stockMovesQueryOptions(organizationId)),
          ),
      }),

      awardBid: typed<AwardRfqBidInput>({
        id: "purchasing.rfq.award",
        command: (input) => awardPurchaseRfqBidCommand(requireCompany("award an RFQ bid"), input),
        affects: AWARD_RFQ_BID_AFFECTS,
        observe: async ({ rfqId }) => {
          const [rfqs, currentOrders] = await Promise.all([
            fresh<RowValueMap[]>(purchaseRfqsQueryOptions(organizationId)),
            orders(),
          ])
          return observeAwardedRfq(rfqId, rfqs, currentOrders)
        },
      }),

      reviewIntake: typed<ReviewSupplierIntakeInput>({
        id: "purchasing.supplier-intake.review",
        command: reviewSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
        observe: ({ intakeId }) => intakeIn("UnderReview")(intakeId),
      }),
      approveIntake: typed<ApproveSupplierIntakeInput>({
        id: "purchasing.supplier-intake.approve",
        command: approveSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
        observe: ({ intakeId }) => intakeIn("Approved")(intakeId),
      }),
      holdIntake: typed<SupplierIntakeReasonInput>({
        id: "purchasing.supplier-intake.hold",
        command: holdSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
        observe: ({ intakeId }) => intakeIn("OnHold")(intakeId),
      }),
      rejectIntake: typed<SupplierIntakeReasonInput>({
        id: "purchasing.supplier-intake.reject",
        command: rejectSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
        observe: ({ intakeId }) => intakeIn("Rejected")(intakeId),
      }),

      computeLandedCost: idSpec("purchasing.landed-cost.compute", computeLandedCostsCommand, LANDED_COST_DRAFT_AFFECTS, {
        noReadback: "Idempotent recompute of draft cost lines: an unchanged allocation is a valid result.",
      }),
      postLandedCost: idSpec("purchasing.landed-cost.post", postLandedCostsCommand, POST_LANDED_COST_AFFECTS, {
        observe: landedCostIn("Posted"),
      }),
      applyLandedCost: idSpec(
        "purchasing.landed-cost.apply",
        (id) => applyLandedCostsCommand(companyId, id),
        APPLY_LANDED_COST_AFFECTS,
        {
          noReadback:
            "The committed stock_landed_cost_application row is the exact effect but is not exposed through /api/query yet.",
        },
      ),
      cancelLandedCost: idSpec("purchasing.landed-cost.cancel", cancelLandedCostCommand, LANDED_COST_DRAFT_AFFECTS, {
        observe: landedCostIn("Cancelled"),
      }),

      confirmReturn: idSpec(
        "purchasing.return.confirm",
        (id) => confirmPurchaseReturnCommand(requireCompany("confirm a purchase return"), id),
        CONFIRM_PURCHASE_RETURN_AFFECTS,
        {
          observe: async (id) =>
            observeConfirmedPurchaseReturn(id, await fresh<RowValueMap[]>(purchaseReturnsQueryOptions(organizationId))),
        },
      ),
      createVendorCredit: typed<VendorCreditInput>({
        id: "purchasing.return.create-vendor-credit",
        command: (input) =>
          createVendorCreditFromPurchaseReturnCommand(requireCompany("create a vendor credit"), input),
        affects: VENDOR_CREDIT_FROM_RETURN_AFFECTS,
        observe: async ({ purchaseReturnId }) =>
          observeReturnVendorCredit(purchaseReturnId, await fresh<RowValueMap[]>(purchaseReturnsQueryOptions(organizationId))),
      }),

      releaseBlanket: typed<ReleaseInput>({
        id: "purchasing.blanket.release",
        command: (input) => releaseBlanketToPoCommand(requireCompany("release a blanket order"), input),
        affects: RELEASE_BLANKET_AFFECTS,
        observe: async ({ blanketOrderId, params }) => {
          const [releases, currentOrders] = await Promise.all([
            fetchQueryList("/api/query/purchase-blanket-releases", "Failed to read blanket release"),
            orders(),
          ])
          return observeBlanketRelease(blanketOrderId, params.idempotencyKey, releases, currentOrders)
        },
      }),
    }
  }, [qc, organizationId, companyId])

  const actions = useMemo(() => {
    /** Runs `spec` for one input under a per-input single-flight key. */
    const bind =
      <TInput,>(spec: TransitionSpec<TInput>, key: (input: TInput) => string) =>
      (input: TInput, context?: { navigateToNext?: boolean }) =>
        runner.run(`${spec.id}:${key(input)}`, spec, input, { navigateToNext: context?.navigateToNext })
    const byId = (spec: TransitionSpec<string>) => bind(spec, (id) => id)
    /** Row dispatch reviews without notes; the review form dispatches its collected notes. */
    const reviewIntake = reviewSupplierIntakeAction({
      label: labels.reviewIntake,
      execute: bind(specs.reviewIntake, (i) => i.intakeId),
    })

    return {
      reviewIntake,
      requisition: [
        submitRequisitionAction({ label: labels.submitRequisition, execute: byId(specs.submitRequisition) }),
        approveRequisitionAction({ label: labels.approveRequisition, execute: byId(specs.approveRequisition) }),
        convertRequisitionAction({
          label: labels.convertRequisition,
          execute: async (requisitionId, context) => {
            const purchaseIdsBefore = requisitionPurchaseIds(
              requisitionId,
              (await qc.fetchQuery({ ...purchaseRequisitionsQueryOptions(organizationId), staleTime: 0 })) as RowValueMap[],
            )
            if (!purchaseIdsBefore) {
              throw new WorkflowError("validation", "Requisition is unavailable for purchase order readback")
            }
            return runner.run(
              `${specs.convertRequisition.id}:${requisitionId}`,
              specs.convertRequisition,
              { requisitionId, purchaseIdsBefore },
              { navigateToNext: context?.navigateToNext },
            )
          },
        }),
        closeRequisitionAction({ label: labels.closeRequisition, execute: byId(specs.closeRequisition) }),
        cancelRequisitionAction({ label: labels.cancelRequisition, execute: byId(specs.cancelRequisition) }),
      ] as Array<AnyWorkflowAction<RowValueMap>>,
      order: [
        sendPurchaseOrderAction({ label: labels.sendOrder, execute: byId(specs.sendOrder) }),
        confirmPurchaseOrderAction({ label: labels.confirmOrder, execute: byId(specs.confirmOrder) }),
        cancelPurchaseOrderAction({ label: labels.cancelOrder, execute: byId(specs.cancelOrder) }),
      ] as Array<AnyWorkflowAction<RowValueMap>>,
      supplierIntake: [
        reviewIntake,
        approveSupplierIntakeAction({ label: labels.approveIntake, execute: bind(specs.approveIntake, (i) => i.intakeId) }),
        holdSupplierIntakeAction({
          label: labels.holdIntake,
          defaultReason: labels.holdIntakeReason,
          execute: bind(specs.holdIntake, (i) => i.intakeId),
        }),
        rejectSupplierIntakeAction({
          label: labels.rejectIntake,
          defaultReason: labels.rejectIntakeReason,
          execute: bind(specs.rejectIntake, (i) => i.intakeId),
        }),
      ] as Array<AnyWorkflowAction<RowValueMap>>,
      landedCost: [
        computeLandedCostAction({ label: labels.computeLandedCost, execute: byId(specs.computeLandedCost) }),
        postLandedCostAction({ label: labels.postLandedCost, execute: byId(specs.postLandedCost) }),
        applyLandedCostAction({ label: labels.applyLandedCost, execute: byId(specs.applyLandedCost) }),
        cancelLandedCostAction({ label: labels.cancelLandedCost, execute: byId(specs.cancelLandedCost) }),
      ] as Array<AnyWorkflowAction<RowValueMap>>,
      purchaseReturn: [
        confirmPurchaseReturnAction({ label: labels.confirmReturn, execute: byId(specs.confirmReturn) }),
      ] as Array<AnyWorkflowAction<RowValueMap>>,
      /** Form-backed or row-dispatched-with-a-form actions: the surface collects input, then calls `execute`. */
      createBill: createBillFromPurchaseOrderAction<CreateBillFromPurchaseOrderParams>({
        label: labels.createBill,
        execute: async (input, context) => {
          const currentOrders = (await qc.fetchQuery({
            ...purchaseOrdersQueryOptions(organizationId),
            staleTime: 0,
          })) as RowValueMap[]
          const invoiceIdsBefore = purchaseOrderInvoiceIds(input.orderId, currentOrders)
          if (!invoiceIdsBefore) {
            throw new WorkflowError("validation", "Purchase order is unavailable for bill readback")
          }
          const runInput: BillRunInput = { ...input, invoiceIdsBefore }
          return runner.run(
            `${specs.createBill.id}:${input.orderId}`,
            specs.createBill,
            runInput,
            { navigateToNext: context?.navigateToNext },
          )
        },
      }),
      /** Row dispatch receives the full open quantity; capture exact receipt identity before dispatch. */
      receiveLine: receivePurchaseLineAction({
        label: labels.receiveLine,
        execute: async (input, context) => {
          const moves = (await qc.fetchQuery({
            ...stockMovesQueryOptions(organizationId),
            staleTime: 0,
          })) as RowValueMap[]
          const receiptTarget = resolveOpenReceiptTarget(input.lineId, moves)
          const runInput: ReceiveRunInput = { ...input, receiptTarget }
          return runner.run(
            `${specs.receiveLine.id}:${input.lineId}`,
            specs.receiveLine,
            runInput,
            { navigateToNext: context?.navigateToNext },
          )
        },
      }),
      awardBid: awardRfqBidAction({ label: labels.awardBid, execute: bind(specs.awardBid, (i) => i.rfqId) }),
      createVendorCredit: createVendorCreditFromReturnAction<VendorCreditFromReturnParams>({
        label: labels.createVendorCredit,
        execute: bind(specs.createVendorCredit, (i) => i.purchaseReturnId),
      }),
      releaseBlanket: releaseBlanketAction<ReleaseBlanketToPoParams>({
        label: labels.releaseBlanket,
        execute: bind(specs.releaseBlanket, (i) => i.blanketOrderId),
      }),
    }
  }, [labels, runner, specs, qc, organizationId])

  return {
    requisitionActions: actions.requisition,
    orderActions: actions.order,
    supplierIntakeActions: actions.supplierIntake,
    reviewIntake: actions.reviewIntake,
    landedCostActions: actions.landedCost,
    purchaseReturnActions: actions.purchaseReturn,
    createBill: actions.createBill,
    receiveLine: actions.receiveLine,
    awardBid: actions.awardBid,
    createVendorCredit: actions.createVendorCredit,
    releaseBlanket: actions.releaseBlanket,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
