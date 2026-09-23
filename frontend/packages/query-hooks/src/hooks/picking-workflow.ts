import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  PICKING_TRANSITION_AFFECTS,
  assignPickingAction,
  cancelPickingAction,
  confirmPickingAction,
  observePartialValidatedPicking,
  observePickingState,
  observeValidatedPicking,
  pickingBackorderIds,
  packPickingAction,
  partialValidatePickingAction,
  validatePickingAction,
  WorkflowError,
  type RowValueMap,
  type TransitionSpec,
  type ValidatePickingWithQuantitiesInput,
} from "@lumiere/erp-workflows"

import {
  assignStockPickingCommand,
  cancelStockPickingCommand,
  confirmStockPickingCommand,
  packStockPickingCommand,
  stockPickingsQueryOptions,
  validateStockPickingCommand,
  validateStockPickingWithQuantitiesCommand,
} from "./inventory/stock-operations"
import { useWorkflowRunner, type WorkflowSurfaceCallbacks } from "./workflow"

type PartialValidateRunInput = ValidatePickingWithQuantitiesInput & {
  backorderIdsBefore: string[]
}

export interface PickingWorkflowLabels {
  confirm: string
  assign: string
  validate: string
  partialValidate: string
  pack: string
  cancel: string
}

/**
 * `inventory.picking` record workflow: the transitions every surface that operates a picking
 * (Sales fulfillment, Inventory transfers) runs through the shared completion path.
 */
export function usePickingWorkflow(
  organizationId: bigint,
  companyId: bigint,
  labels: PickingWorkflowLabels,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const specs = useMemo(() => {
    const transition = (
      id: string,
      command: (pickingId: string) => Promise<void>,
      extra: Pick<TransitionSpec<string>, "observe"> = {},
    ): TransitionSpec<string> => ({ id, command, affects: PICKING_TRANSITION_AFFECTS, ...extra })

    // A backorder is a new picking, so a validation reads pickings back to link it.
    const observeValidation = async (pickingId: string) =>
      observeValidatedPicking(
        pickingId,
        (await qc.fetchQuery({ ...stockPickingsQueryOptions(organizationId), staleTime: 0 })) as unknown as RowValueMap[],
      )

    const partialValidate: TransitionSpec<PartialValidateRunInput> = {
      id: "inventory.picking.partial-validate",
      command: (input) =>
        validateStockPickingWithQuantitiesCommand(companyId, {
          pickingId: input.pickingId,
          shortMoves: input.shortMoves,
          createBackorder: input.createBackorder,
        }),
      affects: PICKING_TRANSITION_AFFECTS,
      observe: async ({ pickingId, backorderIdsBefore }) =>
        observePartialValidatedPicking(
          pickingId,
          backorderIdsBefore,
          (await qc.fetchQuery({
            ...stockPickingsQueryOptions(organizationId),
            staleTime: 0,
          })) as unknown as RowValueMap[],
        ),
    }

    return {
      confirm: transition(
        "inventory.picking.confirm",
        (id) => confirmStockPickingCommand(companyId, id),
        {
          observe: async (id) =>
            observePickingState(
              id,
              "confirmed",
              (await qc.fetchQuery({
                ...stockPickingsQueryOptions(organizationId),
                staleTime: 0,
              })) as unknown as RowValueMap[],
            ),
        },
      ),
      assign: transition(
        "inventory.picking.assign",
        (id) => assignStockPickingCommand(companyId, id),
        {
          observe: async (id) =>
            observePickingState(
              id,
              "assigned",
              (await qc.fetchQuery({
                ...stockPickingsQueryOptions(organizationId),
                staleTime: 0,
              })) as unknown as RowValueMap[],
            ),
        },
      ),
      validate: transition("inventory.picking.validate", (id) => validateStockPickingCommand(companyId, id), {
        observe: observeValidation,
      }),
      pack: transition("inventory.picking.pack", (id) =>
        packStockPickingCommand(companyId, {
          pickingId: BigInt(id),
          packagingMaterialId: undefined,
          name: undefined,
          metadata: undefined,
        }),
      ),
      cancel: transition("inventory.picking.cancel", (id) => cancelStockPickingCommand(companyId, id)),
      partialValidate,
    }
  }, [qc, organizationId, companyId])

  const actions = useMemo(() => {
    const byId =
      (id: string, spec: TransitionSpec<string>) =>
      (pickingId: string, context?: { navigateToNext?: boolean }) =>
        runner.run(`${id}:${pickingId}`, spec, pickingId, {
          navigateToNext: context?.navigateToNext,
        })
    return {
      confirm: confirmPickingAction({ label: labels.confirm, execute: byId("inventory.picking.confirm", specs.confirm) }),
      assign: assignPickingAction({ label: labels.assign, execute: byId("inventory.picking.assign", specs.assign) }),
      validate: validatePickingAction({ label: labels.validate, execute: byId("inventory.picking.validate", specs.validate) }),
      pack: packPickingAction({ label: labels.pack, execute: byId("inventory.picking.pack", specs.pack) }),
      cancel: cancelPickingAction({ label: labels.cancel, execute: byId("inventory.picking.cancel", specs.cancel) }),
      partialValidate: partialValidatePickingAction({
        label: labels.partialValidate,
        execute: async (input, context) => {
          const pickings = (await qc.fetchQuery({
            ...stockPickingsQueryOptions(organizationId),
            staleTime: 0,
          })) as unknown as RowValueMap[]
          const backorderIdsBefore = pickingBackorderIds(input.pickingId, pickings)
          if (!backorderIdsBefore) {
            throw new WorkflowError(
              "validation",
              "Picking is unavailable for backorder readback",
            )
          }
          const runInput: PartialValidateRunInput = {
            ...input,
            backorderIdsBefore,
          }
          return runner.run(
            `inventory.picking.partial-validate:${input.pickingId}`,
            specs.partialValidate,
            runInput,
            { navigateToNext: context?.navigateToNext },
          )
        },
      }),
    }
  }, [
    labels.confirm,
    labels.assign,
    labels.validate,
    labels.pack,
    labels.cancel,
    labels.partialValidate,
    runner,
    specs,
    qc,
    organizationId,
  ])

  return { ...actions, isRunning: runner.isRunning, isPending: runner.isPending }
}
