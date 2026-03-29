import type { TFunction } from "i18next"
import type { FormConfig, RadioField } from "./form-types"

function moActionRadioOptions(t: TFunction, state: string): RadioField["options"] {
  const o: RadioField["options"] = [
    {
      value: "check_availability",
      label: t("manufacturing.rowActions.checkAvailability"),
    },
  ]
  if (state === "Draft") {
    o.push({ value: "confirm", label: t("manufacturing.rowActions.confirm") })
  }
  if (state === "Confirmed" || state === "Planned") {
    o.push({ value: "start", label: t("manufacturing.rowActions.start") })
  }
  if (state === "Progress" || state === "InProgress" || state === "ToClose") {
    o.push({ value: "produce", label: t("manufacturing.rowActions.recordOutput") })
    o.push({ value: "consume", label: t("manufacturing.rowActions.consumeMaterials") })
    o.push({ value: "finish", label: t("manufacturing.rowActions.finish") })
    o.push({
      value: "create_workorder",
      label: t("manufacturing.rowActions.addWorkorder"),
    })
  }
  if (state !== "Done" && state !== "Cancelled") {
    o.push({ value: "cancel", label: t("manufacturing.rowActions.cancel") })
  }
  return o
}

export interface ManufacturingOrderRowFormParams {
  recordId: string
  state: string
  defaultProduceQty: number
  workcenterOptions: Array<{ value: string; label: string; disabled?: boolean }>
}

export function manufacturingOrderRowActionForm(
  t: TFunction,
  p: ManufacturingOrderRowFormParams,
): FormConfig {
  const moOptions = moActionRadioOptions(t, p.state)
  const defaultMoAction = moOptions[0]?.value ?? "check_availability"
  const wcOpts =
    p.workcenterOptions.length > 0
      ? p.workcenterOptions
      : [
          {
            value: "",
            label: t("manufacturing.rowActions.selectWorkcenter"),
            disabled: true,
          },
        ]

  return {
    id: `manufacturing-order-row-${p.recordId}`,
    title: t("manufacturing.rowActions.titleOrder"),
    description: t("manufacturing.rowActions.form.moDescription", {
      id: p.recordId,
      state: p.state,
    }),
    size: "lg",
    icon: "Factory",
    submitLabel: t("manufacturing.rowActions.runAction"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "mo-action",
        title: t("manufacturing.rowActions.form.chooseAction"),
        fields: [
          {
            type: "hidden",
            id: "moRecordId",
            name: "moRecordId",
            defaultValue: p.recordId,
          },
          {
            type: "radio",
            id: "moAction",
            name: "moAction",
            label: t("manufacturing.rowActions.form.action"),
            layout: "vertical",
            required: true,
            defaultValue: defaultMoAction,
            options: moOptions,
            width: "full",
          },
        ],
      },
      {
        id: "mo-params",
        title: t("manufacturing.rowActions.form.parameters"),
        description: t("manufacturing.rowActions.form.moParamsHint"),
        columns: 2,
        fields: [
          {
            type: "number",
            id: "produceQty",
            name: "produceQty",
            label: t("manufacturing.rowActions.form.produceQty"),
            defaultValue: p.defaultProduceQty,
            step: 0.0001,
            width: "1/2",
          },
          {
            type: "select",
            id: "woWorkcenterId",
            name: "woWorkcenterId",
            label: t("manufacturing.workOrders.columns.workcenterId"),
            options: wcOpts,
            width: "1/2",
          },
          {
            type: "text",
            id: "woName",
            name: "woName",
            label: t("manufacturing.workOrders.columns.name"),
            defaultValue: "Operation",
            width: "1/2",
          },
          {
            type: "number",
            id: "woDuration",
            name: "woDuration",
            label: t("manufacturing.rowActions.durationExpected"),
            defaultValue: 60,
            width: "1/2",
          },
          {
            type: "number",
            id: "woSequence",
            name: "woSequence",
            label: t("manufacturing.rowActions.sequence"),
            defaultValue: 1,
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export interface ManufacturingBomRowFormParams {
  recordId: string
  defaultProductQty: number
}

export function manufacturingBomRowActionForm(
  t: TFunction,
  p: ManufacturingBomRowFormParams,
): FormConfig {
  return {
    id: `manufacturing-bom-row-${p.recordId}`,
    title: t("manufacturing.rowActions.titleBom"),
    description: t("manufacturing.rowActions.form.bomDescription", { id: p.recordId }),
    size: "md",
    icon: "FileText",
    submitLabel: t("manufacturing.rowActions.runAction"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "bom-action",
        title: t("manufacturing.rowActions.form.chooseAction"),
        fields: [
          {
            type: "hidden",
            id: "bomRecordId",
            name: "bomRecordId",
            defaultValue: p.recordId,
          },
          {
            type: "radio",
            id: "bomAction",
            name: "bomAction",
            label: t("manufacturing.rowActions.form.action"),
            layout: "vertical",
            required: true,
            defaultValue: "update_qty",
            options: [
              { value: "update_qty", label: t("manufacturing.rowActions.saveBomQty") },
              { value: "compute_cost", label: t("manufacturing.rowActions.computeCost") },
              { value: "explode", label: t("manufacturing.rowActions.explodeBom") },
              { value: "delete", label: t("manufacturing.rowActions.deleteBom") },
            ],
            width: "full",
          },
        ],
      },
      {
        id: "bom-params",
        title: t("manufacturing.rowActions.form.parameters"),
        description: t("manufacturing.rowActions.form.bomParamsHint"),
        fields: [
          {
            type: "number",
            id: "bomProductQty",
            name: "bomProductQty",
            label: t("manufacturing.billsOfMaterials.columns.productQty"),
            defaultValue: p.defaultProductQty,
            step: 0.0001,
            width: "1/2",
          },
          {
            type: "checkbox",
            id: "bomDeleteConfirmed",
            name: "bomDeleteConfirmed",
            label: t("manufacturing.rowActions.form.confirmDeleteBom"),
            defaultValue: false,
            width: "full",
          },
        ],
      },
    ],
  }
}

export interface ManufacturingWorkorderRowFormParams {
  recordId: string
  state: string
}

export function manufacturingWorkorderRowActionForm(
  t: TFunction,
  p: ManufacturingWorkorderRowFormParams,
): FormConfig {
  const options: RadioField["options"] = []
  if (p.state === "Pending" || p.state === "Ready") {
    options.push({ value: "start", label: t("manufacturing.rowActions.start") })
  }
  if (p.state === "Progress") {
    options.push({ value: "finish", label: t("manufacturing.rowActions.finish") })
  }
  const defaultWo = options[0]?.value ?? "start"

  return {
    id: `manufacturing-wo-row-${p.recordId}`,
    title: t("manufacturing.rowActions.titleWo"),
    description: t("manufacturing.rowActions.form.woDescription", {
      id: p.recordId,
      state: p.state,
    }),
    size: "md",
    icon: "Wrench",
    submitLabel: t("manufacturing.rowActions.runAction"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "wo-action",
        title: t("manufacturing.rowActions.form.chooseAction"),
        fields: [
          {
            type: "hidden",
            id: "woRecordId",
            name: "woRecordId",
            defaultValue: p.recordId,
          },
          {
            type: "radio",
            id: "woAction",
            name: "woAction",
            label: t("manufacturing.rowActions.form.action"),
            layout: "vertical",
            required: true,
            defaultValue: defaultWo,
            options:
              options.length > 0
                ? options
                : [
                    {
                      value: "_none",
                      label: t("manufacturing.rowActions.form.noActionsAvailable"),
                    },
                  ],
            width: "full",
          },
        ],
      },
    ],
  }
}

export interface ManufacturingWorkcenterRowFormParams {
  recordId: string
  defaultName: string
}

export function manufacturingWorkcenterRowActionForm(
  t: TFunction,
  p: ManufacturingWorkcenterRowFormParams,
): FormConfig {
  return {
    id: `manufacturing-wc-row-${p.recordId}`,
    title: t("manufacturing.rowActions.titleWc"),
    description: t("manufacturing.rowActions.form.wcDescription", { id: p.recordId }),
    size: "lg",
    icon: "Settings",
    submitLabel: t("manufacturing.rowActions.runAction"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "wc-action",
        title: t("manufacturing.rowActions.form.chooseAction"),
        fields: [
          {
            type: "hidden",
            id: "wcRecordId",
            name: "wcRecordId",
            defaultValue: p.recordId,
          },
          {
            type: "radio",
            id: "wcAction",
            name: "wcAction",
            label: t("manufacturing.rowActions.form.action"),
            layout: "vertical",
            required: true,
            defaultValue: "save_name",
            options: [
              { value: "save_name", label: t("manufacturing.rowActions.saveName") },
              { value: "block", label: t("manufacturing.rowActions.block") },
              { value: "unblock", label: t("manufacturing.rowActions.unblock") },
              {
                value: "log_productivity",
                label: t("manufacturing.rowActions.logProductivity"),
              },
            ],
            width: "full",
          },
        ],
      },
      {
        id: "wc-params",
        title: t("manufacturing.rowActions.form.parameters"),
        description: t("manufacturing.rowActions.form.wcParamsHint"),
        columns: 2,
        fields: [
          {
            type: "text",
            id: "wcName",
            name: "wcName",
            label: t("manufacturing.workCenters.columns.name"),
            defaultValue: p.defaultName,
            width: "full",
          },
          {
            type: "text",
            id: "blockReason",
            name: "blockReason",
            label: t("manufacturing.rowActions.blockReasonPlaceholder"),
            width: "full",
          },
          {
            type: "number",
            id: "logWorkorderId",
            name: "logWorkorderId",
            label: t("manufacturing.rowActions.form.workorderId"),
            width: "1/2",
          },
          {
            type: "number",
            id: "logDuration",
            name: "logDuration",
            label: t("manufacturing.rowActions.duration"),
            defaultValue: 1,
            step: 0.0001,
            width: "1/2",
          },
          {
            type: "number",
            id: "logLossId",
            name: "logLossId",
            label: t("manufacturing.rowActions.lossId"),
            defaultValue: 0,
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export type ManufacturingCsvImportKind = "mo" | "bom" | "bom_line" | "workcenter"

export function manufacturingCsvImportForm(
  t: TFunction,
  kind: ManufacturingCsvImportKind,
): FormConfig {
  const titleKey =
    kind === "mo"
      ? "importMoCsvTitle"
      : kind === "bom"
        ? "importBomCsvTitle"
        : kind === "bom_line"
          ? "importBomLineCsvTitle"
          : "importWorkcenterCsvTitle"

  return {
    id: `manufacturing-csv-import-${kind}`,
    title: t(`manufacturing.csvImport.${titleKey}`),
    description: t("manufacturing.csvImport.description"),
    size: "md",
    icon: "Upload",
    submitLabel: t("manufacturing.rowActions.importSubmit"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "csv-file",
        fields: [
          {
            type: "file",
            id: "csvFile",
            name: "csvFile",
            label: t("manufacturing.rowActions.form.csvFile"),
            accept: ".csv,text/csv,text/plain",
            required: true,
            width: "full",
          },
        ],
      },
    ],
  }
}
