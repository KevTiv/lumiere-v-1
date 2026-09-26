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
  observeReceivedLine,
  observeReturnVendorCredit,
  observeSentPurchaseOrder,
  postLandedCostAction,
  receivePurchaseLineAction,
  rejectSupplierIntakeAction,
  releaseBlanketAction,
  reviewSupplierIntakeAction,
  sendPurchaseOrderAction,
  submitRequisitionAction,
  type AnyWorkflowAction,
  type ApproveSupplierIntakeInput,
  type AwardRfqBidInput,
  type CreateBillFromPurchaseOrderInput,
  type CreateVendorCreditInput,
  type ReceivePurchaseLineInput,
  type ReleaseBlanketInput,
  type ReviewSupplierIntakeInput,
  type RowValueMap,
  type SupplierIntakeReasonInput,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

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
type VendorCreditInput = CreateVendorCreditInput<VendorCreditFromReturnParams>
type ReleaseInput = ReleaseBlanketInput<ReleaseBlanketToPoParams>

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
    const requireCompany = (what: string) => {
      if (companyId == null || companyId === 0n) throw companyRequired(what)
      return companyId
    }

    const idSpec = (
      id: string,
      command: (id: string) => Promise<void>,
      affects: readonly string[],
      observe?: TransitionSpec<string>["observe"],
    ): TransitionSpec<string> => ({ id, command, affects, observe })

    return {
      submitRequisition: idSpec("purchasing.requisition.submit", submitPurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS),
      approveRequisition: idSpec("purchasing.requisition.approve", approvePurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS),
      closeRequisition: idSpec("purchasing.requisition.close", closePurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS),
      cancelRequisition: idSpec("purchasing.requisition.cancel", cancelPurchaseRequisitionCommand, REQUISITION_TRANSITION_AFFECTS),
      convertRequisition: idSpec(
        "purchasing.requisition.convert",
        (id) => convertPurchaseRequisitionToPoCommand(companyId, id),
        CONVERT_REQUISITION_AFFECTS,
        async (id) =>
          observeConvertedRequisition(id, await fresh<RowValueMap[]>(purchaseRequisitionsQueryOptions(organizationId))),
      ),

      sendOrder: idSpec("purchasing.order.send", sendPurchaseOrderCommand, SEND_PURCHASE_ORDER_AFFECTS, async (id) =>
        observeSentPurchaseOrder(id, await orders()),
      ),
      confirmOrder: idSpec(
        "purchasing.order.confirm",
        confirmPurchaseOrderCommand,
        CONFIRM_PURCHASE_ORDER_AFFECTS,
        async (id) => observeConfirmedPurchaseOrder(id, await orders()),
      ),
      cancelOrder: idSpec("purchasing.order.cancel", cancelPurchaseOrderCommand, CANCEL_PURCHASE_ORDER_AFFECTS),

      createBill: typed<BillInput>({
        id: "purchasing.order.create-bill",
        command: createBillFromPurchaseOrderCommand,
        affects: CREATE_BILL_FROM_PURCHASE_ORDER_AFFECTS,
        observe: async ({ orderId }) => observeCreatedBill(orderId, await orders()),
      }),

      receiveLine: typed<ReceivePurchaseLineInput>({
        id: "purchasing.line.receive",
        command: receivePurchaseOrderLineCommand,
        affects: RECEIVE_PO_LINE_AFFECTS,
        observe: async ({ lineId }) =>
          observeReceivedLine(lineId, await fresh<RowValueMap[]>(stockMovesQueryOptions(organizationId))),
      }),

      awardBid: typed<AwardRfqBidInput>({
        id: "purchasing.rfq.award",
        command: (input) => awardPurchaseRfqBidCommand(requireCompany("award an RFQ bid"), input),
        affects: AWARD_RFQ_BID_AFFECTS,
        observe: async ({ rfqId }) => observeAwardedRfq(rfqId, await orders()),
      }),

      reviewIntake: typed<ReviewSupplierIntakeInput>({
        id: "purchasing.supplier-intake.review",
        command: reviewSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
      }),
      approveIntake: typed<ApproveSupplierIntakeInput>({
        id: "purchasing.supplier-intake.approve",
        command: approveSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
      }),
      holdIntake: typed<SupplierIntakeReasonInput>({
        id: "purchasing.supplier-intake.hold",
        command: holdSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
      }),
      rejectIntake: typed<SupplierIntakeReasonInput>({
        id: "purchasing.supplier-intake.reject",
        command: rejectSupplierIntakeCommand,
        affects: SUPPLIER_INTAKE_TRANSITION_AFFECTS,
      }),

      computeLandedCost: idSpec("purchasing.landed-cost.compute", computeLandedCostsCommand, LANDED_COST_DRAFT_AFFECTS),
      postLandedCost: idSpec("purchasing.landed-cost.post", postLandedCostsCommand, POST_LANDED_COST_AFFECTS),
      applyLandedCost: idSpec(
        "purchasing.landed-cost.apply",
        (id) => applyLandedCostsCommand(companyId, id),
        APPLY_LANDED_COST_AFFECTS,
      ),
      cancelLandedCost: idSpec("purchasing.landed-cost.cancel", cancelLandedCostCommand, LANDED_COST_DRAFT_AFFECTS),

      confirmReturn: idSpec(
        "purchasing.return.confirm",
        (id) => confirmPurchaseReturnCommand(requireCompany("confirm a purchase return"), id),
        CONFIRM_PURCHASE_RETURN_AFFECTS,
        async (id) =>
          observeConfirmedPurchaseReturn(id, await fresh<RowValueMap[]>(purchaseReturnsQueryOptions(organizationId))),
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
        observe: async ({ blanketOrderId }) => observeBlanketRelease(blanketOrderId, await orders()),
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
        convertRequisitionAction({ label: labels.convertRequisition, execute: byId(specs.convertRequisition) }),
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
        execute: bind(specs.createBill, (i) => i.orderId),
      }),
      /** Row dispatch receives the full open quantity; the receive form dispatches its own quantity/lot. */
      receiveLine: receivePurchaseLineAction({
        label: labels.receiveLine,
        execute: bind(specs.receiveLine, (i) => i.lineId),
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
  }, [labels, runner, specs])

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
