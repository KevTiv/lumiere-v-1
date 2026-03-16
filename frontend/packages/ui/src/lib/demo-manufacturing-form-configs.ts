import type { FormConfig } from "./form-types"

export const newManufacturingOrderForm: FormConfig = {
  id: "new-manufacturing-order",
  title: "New Manufacturing Order",
  description: "Create a new production order",
  sections: [
    {
      id: "mo-product",
      title: "Product",
      fields: [
        {
          type: "number",
          name: "productId",
          label: "Product",
          placeholder: "Product ID",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "productQty",
          label: "Quantity",
          placeholder: "0",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "bomId",
          label: "Bill of Materials",
          placeholder: "BOM ID",
          width: "half",
        },
        {
          type: "number",
          name: "productUomId",
          label: "Unit of Measure",
          placeholder: "UOM ID",
          width: "half",
        },
      ],
    },
    {
      id: "mo-schedule",
      title: "Scheduling",
      fields: [
        {
          type: "date",
          name: "datePlannedStart",
          label: "Scheduled Start",
          required: true,
          width: "half",
        },
        {
          type: "date",
          name: "datePlannedFinished",
          label: "Scheduled End",
          width: "half",
        },
      ],
    },
    {
      id: "mo-misc",
      title: "Other",
      fields: [
        {
          type: "text",
          name: "origin",
          label: "Source Document",
          placeholder: "e.g. SO-0042",
          width: "half",
        },
        {
          type: "number",
          name: "routingId",
          label: "Routing",
          placeholder: "Routing ID",
          width: "half",
        },
      ],
    },
  ],
}

export const newBomForm: FormConfig = {
  id: "new-bom",
  title: "New Bill of Materials",
  description: "Define a product structure",
  sections: [
    {
      id: "bom-product",
      title: "Product",
      fields: [
        {
          type: "number",
          name: "productTmplId",
          label: "Product Template",
          placeholder: "Template ID",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "productQty",
          label: "Quantity",
          placeholder: "1",
          required: true,
          width: "half",
        },
        {
          type: "select",
          name: "type",
          label: "BOM Type",
          required: true,
          width: "half",
          options: [
            { value: "Normal", label: "Manufacture" },
            { value: "Phantom", label: "Phantom" },
            { value: "Kit", label: "Kit" },
            { value: "Subcontracting", label: "Subcontracting" },
          ],
        },
        {
          type: "number",
          name: "routingId",
          label: "Routing",
          placeholder: "Routing ID",
          width: "half",
        },
      ],
    },
  ],
}

export const newWorkcenterForm: FormConfig = {
  id: "new-workcenter",
  title: "New Work Center",
  description: "Register a machine or work station",
  sections: [
    {
      id: "wc-general",
      title: "General",
      fields: [
        {
          type: "text",
          name: "name",
          label: "Name",
          placeholder: "e.g. Assembly Line A",
          required: true,
          width: "half",
        },
        {
          type: "text",
          name: "code",
          label: "Code",
          placeholder: "e.g. ALA",
          width: "half",
        },
        {
          type: "number",
          name: "capacity",
          label: "Capacity",
          placeholder: "1",
          width: "third",
        },
        {
          type: "number",
          name: "timeEfficiency",
          label: "Efficiency %",
          placeholder: "100",
          width: "third",
        },
        {
          type: "number",
          name: "oeeTarget",
          label: "OEE Target %",
          placeholder: "85",
          width: "third",
        },
      ],
    },
  ],
}
