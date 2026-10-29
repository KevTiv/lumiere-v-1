import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export function aiReducerAllowlistCreateFormConfig(t: TFunction): FormConfig {
  return {
    id: "settings-ai-reducer-allowlist-create",
    title: t("settings.ai.allowlistCreateTitle"),
    description: t("settings.ai.allowlistCreateDescription"),
    submitLabel: t("settings.ai.create"),
    sections: [
      {
        id: "allowlist",
        fields: [
          {
            type: "select",
            id: "reducerName",
            name: "reducerName",
            label: t("settings.ai.allowlistReducer"),
            required: true,
            width: "full",
            defaultValue: "create_sale_order",
            options: [
              { value: "create_task", label: t("aiAssistant.builtIn.aiReducerAllowlistFormConfigs.aiReducerAllowlistCreateFormConfig.reducerName.label") },
              { value: "create_sale_order", label: t("aiAssistant.builtIn.aiReducerAllowlistFormConfigs.aiReducerAllowlistCreateFormConfig.reducerName.labelcreateSaleOrder") },
              { value: "create_purchase_order", label: t("aiAssistant.builtIn.aiReducerAllowlistFormConfigs.aiReducerAllowlistCreateFormConfig.reducerName.labelcreatePurchaseOrder") },
            ],
          },
          {
            type: "text",
            id: "permissionResource",
            name: "permissionResource",
            label: t("settings.ai.allowlistPermissionResource"),
            width: "1/2",
            defaultValue: "",
            placeholder: t("settings.ai.allowlistResourcePlaceholder"),
          },
          {
            type: "text",
            id: "permissionAction",
            name: "permissionAction",
            label: t("settings.ai.allowlistPermissionAction"),
            width: "1/2",
            defaultValue: "create",
            placeholder: t("settings.ai.allowlistActionPlaceholder"),
          },
          {
            type: "switch",
            id: "enabled",
            name: "enabled",
            label: t("settings.ai.allowlistEnabled"),
            width: "full",
            defaultValue: true,
          },
        ],
      },
    ],
  }
}
