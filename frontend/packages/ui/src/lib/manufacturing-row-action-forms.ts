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
  if (state === "Progress" || state === "InProgress") {
    o.push({ value: "produce", label: t("manufacturing.rowActions.recordOutput") })
    o.push({ value: "consume", label: t("manufacturing.rowActions.consumeMaterials") })
    o.push({
      value: "create_workorder",
      label: t("manufacturing.rowActions.addWorkorder"),
    })
  }
  if (state === "ToClose") {
    o.push({ value: "consume", label: t("manufacturing.rowActions.consumeMaterials") })
    o.push({ value: "finish", label: t("manufacturing.rowActions.finish") })
  }
  if (state === 'Done') {
    o.push({
      value: 'scrap_output',
      label: t('manufacturing.rowActions.scrapOutput'),
    });
  }
  if (state !== 'Done' && state !== 'Cancelled') {
    o.push({ value: 'cancel', label: t('manufacturing.rowActions.cancel') });
  }
  return o
}

export interface ManufacturingOrderRowFormParams {
  recordId: string;
  state: string;
  defaultProduceQty: number;
  workcenterOptions: Array<{
    value: string;
    label: string;
    disabled?: boolean;
  }>;
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
            width: '1/2',
            visibleWhen: { field: 'moAction', equals: 'produce' },
          },
          {
            // The accepted default location read omits the scrap designation.
            // Explicit identity is validated by the canonical scrap reducer.
            type: 'number',
            id: 'scrapLocationId',
            name: 'scrapLocationId',
            label: t('manufacturing.rowActions.form.scrapLocation'),
            min: 1,
            step: 1,
            width: '1/2',
            visibleWhen: { field: 'moAction', equals: 'scrap_output' },
          },
          {
            type: 'number',
            id: 'scrapQuantity',
            name: 'scrapQuantity',
            label: t('manufacturing.rowActions.form.scrapQuantity'),
            defaultValue: 1,
            step: 0.0001,
            width: '1/2',
            visibleWhen: { field: 'moAction', equals: 'scrap_output' },
          },
          {
            type: "select",
            id: "woWorkcenterId",
            name: "woWorkcenterId",
            label: t("manufacturing.workOrders.columns.workcenterId"),
            options: wcOpts,
            width: '1/2',
            visibleWhen: { field: 'moAction', equals: 'create_workorder' },
          },
          {
            type: 'text',
            id: 'woName',
            name: 'woName',
            label: t('manufacturing.workOrders.columns.name'),
            defaultValue: 'Operation',
            width: '1/2',
            visibleWhen: { field: 'moAction', equals: 'create_workorder' },
          },
          {
            type: "number",
            id: "woDuration",
            name: "woDuration",
            label: t("manufacturing.rowActions.durationExpected"),
            defaultValue: 60,
            width: '1/2',
            visibleWhen: { field: 'moAction', equals: 'create_workorder' },
          },
          {
            type: "number",
            id: "woSequence",
            name: "woSequence",
            label: t("manufacturing.rowActions.sequence"),
            defaultValue: 1,
            width: '1/2',
            visibleWhen: { field: 'moAction', equals: 'create_workorder' },
          },
        ],
      },
    ],
  }
}

export interface ManufacturingBomRowFormParams {
  recordId: string;
  defaultProductQty: number;
  productOptions: Array<{ value: string; label: string; disabled?: boolean }>;
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
              {
                value: 'update_qty',
                label: t('manufacturing.rowActions.saveBomQty'),
              },
              {
                value: 'compute_cost',
                label: t('manufacturing.rowActions.computeCost'),
              },
              {
                value: 'explode',
                label: t('manufacturing.rowActions.explodeBom'),
              },
              {
                value: 'add_byproduct',
                label: t('manufacturing.rowActions.addByproduct'),
              },
              {
                value: 'delete',
                label: t('manufacturing.rowActions.deleteBom'),
              },
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
            width: '1/2',
            visibleWhen: { field: 'bomAction', equals: 'update_qty' },
          },
          {
            type: 'select',
            id: 'byproductProductId',
            name: 'byproductProductId',
            label: t('manufacturing.rowActions.form.byproductProduct'),
            options: p.productOptions,
            width: '1/2',
            visibleWhen: { field: 'bomAction', equals: 'add_byproduct' },
          },
          {
            type: 'number',
            id: 'byproductUomId',
            name: 'byproductUomId',
            label: t('manufacturing.rowActions.form.byproductUom'),
            width: '1/2',
            visibleWhen: { field: 'bomAction', equals: 'add_byproduct' },
          },
          {
            type: 'number',
            id: 'byproductQuantity',
            name: 'byproductQuantity',
            label: t('manufacturing.rowActions.form.byproductQuantity'),
            defaultValue: 1,
            step: 0.0001,
            width: '1/2',
            visibleWhen: { field: 'bomAction', equals: 'add_byproduct' },
          },
          {
            type: 'number',
            id: 'byproductCostShare',
            name: 'byproductCostShare',
            label: t('manufacturing.rowActions.form.byproductCostShare'),
            defaultValue: 0,
            min: 0,
            max: 100,
            width: '1/2',
            visibleWhen: { field: 'bomAction', equals: 'add_byproduct' },
          },
          {
            type: "checkbox",
            id: "bomDeleteConfirmed",
            name: "bomDeleteConfirmed",
            label: t("manufacturing.rowActions.form.confirmDeleteBom"),
            defaultValue: false,
            width: 'full',
            visibleWhen: { field: 'bomAction', equals: 'delete' },
          },
        ],
      },
    ],
  }
}

export interface ManufacturingWorkorderRowFormParams {
  recordId: string;
  state: string;
  workcenterId: string;
  qualityCheckId?: string;
  qualityState?: string;
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
    options.push({
      value: "log_productivity",
      label: t("manufacturing.rowActions.logProductivity"),
    })
    options.push({
      value: 'finish',
      label: t('manufacturing.rowActions.finish'),
    });
    if (!p.qualityCheckId) {
      options.push({
        value: 'require_quality',
        label: t('manufacturing.rowActions.requireQuality'),
      });
    } else if ((p.qualityState ?? 'none').toLowerCase() === 'none') {
      options.push({
        value: 'pass_quality',
        label: t('manufacturing.rowActions.passQuality'),
      });
      options.push({
        value: 'fail_quality',
        label: t('manufacturing.rowActions.failQuality'),
      });
    }
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
            type: "hidden",
            id: "woWorkcenterId",
            name: "woWorkcenterId",
            defaultValue: p.workcenterId,
          },
          {
            type: 'hidden',
            id: 'woQualityCheckId',
            name: 'woQualityCheckId',
            defaultValue: p.qualityCheckId ?? '',
          },
          {
            type: 'radio',
            id: 'woAction',
            name: 'woAction',
            label: t('manufacturing.rowActions.form.action'),
            layout: 'vertical',
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
          {
            type: 'text',
            id: 'woQualityName',
            name: 'woQualityName',
            label: t('manufacturing.rowActions.form.qualityCheckName'),
            defaultValue: 'In-process quality check',
            width: 'full',
            visibleWhen: { field: 'woAction', equals: 'require_quality' },
          },
          {
            type: 'text',
            id: 'woQualityNote',
            name: 'woQualityNote',
            label: t('manufacturing.rowActions.form.qualityNote'),
            width: 'full',
            visibleWhen: { field: 'woAction', equals: 'fail_quality' },
          },
        ],
      },
      {
        id: "wo-productivity",
        title: t("manufacturing.rowActions.form.parameters"),
        columns: 2,
        fields: [
          {
            type: "number",
            id: "woLogDuration",
            name: "woLogDuration",
            label: t("manufacturing.rowActions.duration"),
            defaultValue: 1,
            step: 0.0001,
            width: '1/2',
            visibleWhen: { field: 'woAction', equals: 'log_productivity' },
          },
          {
            type: 'text',
            id: 'woLogDescription',
            name: 'woLogDescription',
            label: t('manufacturing.rowActions.form.logDescription'),
            placeholder: t(
              'manufacturing.rowActions.form.logDescriptionPlaceholder',
            ),
            width: 'full',
            visibleWhen: { field: 'woAction', equals: 'log_productivity' },
          },
        ],
      },
    ],
  }
}

export interface ManufacturingWorkcenterRowFormParams {
  recordId: string
  defaultName: string
  /** Options for “Link IoT device”; include a disabled empty row when there are no devices. */
  iotDeviceOptions: Array<{ value: string; label: string; disabled?: boolean }>
  /** Device currently linked to this work center (for default select value). */
  linkedDeviceId?: string
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
              {
                value: "create_routing",
                label: t("manufacturing.rowActions.createRoutingOperation"),
              },
              {
                value: "complete_productivity_log",
                label: t("manufacturing.rowActions.completeProductivityLog"),
              },
              {
                value: "link_iot_device",
                label: t("manufacturing.rowActions.linkIotDevice"),
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
            type: "select",
            id: "linkDeviceId",
            name: "linkDeviceId",
            label: t("manufacturing.rowActions.linkIotDeviceSelect"),
            options: p.iotDeviceOptions,
            defaultValue: p.linkedDeviceId ?? "",
            width: "full",
          },
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
          {
            type: "text",
            id: "logDescription",
            name: "logDescription",
            label: t("manufacturing.rowActions.form.logDescription"),
            placeholder: t("manufacturing.rowActions.form.logDescriptionPlaceholder"),
            width: "full",
          },
          {
            type: "number",
            id: "completeLogId",
            name: "completeLogId",
            label: t("manufacturing.rowActions.form.completeLogId"),
            width: "1/2",
          },
          {
            type: "text",
            id: "routingOpName",
            name: "routingOpName",
            label: t("manufacturing.rowActions.form.routingOpName"),
            defaultValue: "Operation",
            width: "full",
          },
          {
            type: "text",
            id: "routingWorksheetType",
            name: "routingWorksheetType",
            label: t("manufacturing.rowActions.form.routingWorksheetType"),
            defaultValue: "text",
            width: "1/2",
          },
          {
            type: "text",
            id: "routingTimeMode",
            name: "routingTimeMode",
            label: t("manufacturing.rowActions.form.routingTimeMode"),
            defaultValue: "manual",
            width: "1/2",
          },
          {
            type: "number",
            id: "routingTimeModeBatch",
            name: "routingTimeModeBatch",
            label: t("manufacturing.rowActions.form.routingTimeModeBatch"),
            defaultValue: 1,
            width: "1/3",
          },
          {
            type: "number",
            id: "routingTimeCycleManual",
            name: "routingTimeCycleManual",
            label: t("manufacturing.rowActions.form.routingTimeCycleManual"),
            defaultValue: 0,
            step: 0.0001,
            width: "1/3",
          },
          {
            type: "number",
            id: "routingTimeCycle",
            name: "routingTimeCycle",
            label: t("manufacturing.rowActions.form.routingTimeCycle"),
            defaultValue: 60,
            step: 0.0001,
            width: "1/3",
          },
          {
            type: "number",
            id: "routingSequence",
            name: "routingSequence",
            label: t("manufacturing.rowActions.form.routingSequence"),
            defaultValue: 10,
            width: "1/2",
          },
          {
            type: "textarea",
            id: "routingWorksheetBody",
            name: "routingWorksheetBody",
            label: t("manufacturing.rowActions.form.routingWorksheetBody"),
            width: "full",
          },
          {
            type: "text",
            id: "routingWorksheetUrl",
            name: "routingWorksheetUrl",
            label: t("manufacturing.rowActions.form.routingWorksheetUrl"),
            width: "full",
          },
          {
            type: "textarea",
            id: "routingBlockedByIds",
            name: "routingBlockedByIds",
            label: t("manufacturing.rowActions.form.routingBlockedByIds"),
            width: "full",
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
