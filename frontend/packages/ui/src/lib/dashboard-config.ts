import type { DashboardConfig } from "./dashboard-types"

// Accept any t() compatible function — avoids coupling to a specific i18n library
type T = (key: string, options?: Record<string, unknown>) => string

export function createSalesDashboard(t: T): DashboardConfig {
  return {
    id: "sales",
    title: t("dashboard.sales.title"),
    description: t("dashboard.sales.description"),
    sections: [
      {
        id: "kpis",
        widgets: [
          {
            id: "revenue",
            type: "kpi",
            title: t("dashboard.sales.widgets.revenue"),
            width: "1/3",
            data: {
              value: "$284,392",
              label: t("dashboard.sales.widgets.revenue"),
              change: 12.5,
              changeLabel: t("dashboard.vsLastMonth"),
              trend: "up",
              icon: "dollar",
            },
          },
          {
            id: "orders",
            type: "kpi",
            title: t("dashboard.sales.widgets.orders"),
            width: "1/3",
            data: {
              value: "1,847",
              label: t("dashboard.sales.widgets.orders"),
              change: 8.2,
              changeLabel: t("dashboard.vsLastMonth"),
              trend: "up",
              icon: "cart",
            },
          },
          {
            id: "customers",
            type: "kpi",
            title: t("dashboard.sales.widgets.customers"),
            width: "1/3",
            data: {
              value: "423",
              label: t("dashboard.sales.widgets.customers"),
              change: -2.4,
              changeLabel: t("dashboard.vsLastMonth"),
              trend: "down",
              icon: "users",
            },
          },
        ],
      },
      {
        id: "charts",
        title: t("dashboard.sales.sections.charts"),
        widgets: [
          {
            id: "revenue-trend",
            type: "area-chart",
            title: t("dashboard.sales.widgets.revenueTrend"),
            width: "2/3",
            data: {
              xAxisKey: "month",
              series: [
                { name: "revenue", color: "hsl(var(--chart-1))" },
                { name: "target", color: "hsl(var(--chart-2))" },
              ],
              values: [
                { month: "Jan", revenue: 18500, target: 20000 },
                { month: "Feb", revenue: 22300, target: 22000 },
                { month: "Mar", revenue: 19800, target: 24000 },
                { month: "Apr", revenue: 28400, target: 26000 },
                { month: "May", revenue: 32100, target: 28000 },
                { month: "Jun", revenue: 29800, target: 30000 },
                { month: "Jul", revenue: 35200, target: 32000 },
                { month: "Aug", revenue: 38900, target: 34000 },
              ],
            },
          },
          {
            id: "targets",
            type: "metrics",
            title: t("dashboard.sales.widgets.targets"),
            width: "1/3",
            data: {
              metrics: [
                { label: t("dashboard.sales.metrics.revenueTarget"), value: 284000, max: 350000, color: "hsl(var(--chart-1))" },
                { label: t("dashboard.sales.metrics.ordersTarget"), value: 1847, max: 2000, color: "hsl(var(--chart-2))" },
                { label: t("dashboard.sales.metrics.customerAcquisition"), value: 423, max: 500, color: "hsl(var(--chart-3))" },
                { label: t("dashboard.sales.metrics.retentionRate"), value: 87, max: 100, color: "hsl(var(--chart-4))" },
              ],
            },
          },
        ],
      },
      {
        id: "details",
        title: t("dashboard.sales.sections.details"),
        widgets: [
          {
            id: "region-sales",
            type: "bar-chart",
            title: t("dashboard.sales.widgets.regionSales"),
            width: "1/2",
            data: {
              categoryKey: "region",
              layout: "horizontal",
              series: [{ name: "sales", color: "hsl(var(--primary))" }],
              values: [
                { region: "North America", sales: 125000 },
                { region: "Europe", sales: 89000 },
                { region: "Asia Pacific", sales: 45000 },
                { region: "Latin America", sales: 18000 },
                { region: "Middle East", sales: 7400 },
              ],
            },
          },
          {
            id: "top-products",
            type: "table",
            title: t("dashboard.sales.widgets.topProducts"),
            width: "1/2",
            data: {
              columns: [
                { key: "product", label: t("dashboard.sales.table.product") },
                { key: "sales", label: t("dashboard.sales.table.sales"), align: "right" as const },
                { key: "revenue", label: t("dashboard.sales.table.revenue"), align: "right" as const },
              ],
              rows: [
                { product: "Enterprise Suite", sales: "423", revenue: "$84,600" },
                { product: "Professional Plan", sales: "312", revenue: "$46,800" },
                { product: "Starter Kit", sales: "567", revenue: "$28,350" },
                { product: "Add-on Module A", sales: "234", revenue: "$11,700" },
                { product: "Support Package", sales: "189", revenue: "$9,450" },
              ],
            },
          },
        ],
      },
    ],
  }
}

export function createInventoryDashboard(t: T): DashboardConfig {
  return {
    id: "inventory",
    title: t("dashboard.inventory.title"),
    description: t("dashboard.inventory.description"),
    sections: [
      {
        id: "stats",
        widgets: [
          {
            id: "stock-stats",
            type: "stat-cards",
            title: "",
            width: "full",
            useCard: false,
            data: {
              stats: [
                { label: t("dashboard.inventory.stats.totalSkus"), value: "2,847", change: 5.2, icon: "package" },
                { label: t("dashboard.inventory.stats.inStock"), value: "2,341", change: 2.1 },
                { label: t("dashboard.inventory.stats.lowStock"), value: "234", change: -12.4 },
                { label: t("dashboard.inventory.stats.outOfStock"), value: "43", change: 8.3 },
              ],
            },
          },
        ],
      },
      {
        id: "stock-levels",
        title: t("dashboard.inventory.sections.stockLevels"),
        widgets: [
          {
            id: "category-stock",
            type: "bar-chart",
            title: t("dashboard.inventory.widgets.categoryStock"),
            width: "1/2",
            data: {
              categoryKey: "category",
              series: [
                { name: "inStock", color: "hsl(var(--chart-2))" },
                { name: "reserved", color: "hsl(var(--chart-3))" },
              ],
              stacked: true,
              values: [
                { category: "Electronics", inStock: 450, reserved: 120 },
                { category: "Furniture", inStock: 280, reserved: 45 },
                { category: "Apparel", inStock: 890, reserved: 230 },
                { category: "Food & Bev", inStock: 1200, reserved: 340 },
                { category: "Hardware", inStock: 340, reserved: 89 },
              ],
            },
          },
          {
            id: "warehouse-capacity",
            type: "metrics",
            title: t("dashboard.inventory.widgets.warehouseCapacity"),
            width: "1/2",
            data: {
              metrics: [
                { label: t("dashboard.inventory.warehouses.warehouse", { id: "A" }), value: 8500, max: 10000, color: "hsl(var(--chart-1))" },
                { label: t("dashboard.inventory.warehouses.warehouse", { id: "B" }), value: 6200, max: 8000, color: "hsl(var(--chart-2))" },
                { label: t("dashboard.inventory.warehouses.warehouse", { id: "C" }), value: 3800, max: 5000, color: "hsl(var(--chart-3))" },
                { label: t("dashboard.inventory.warehouses.distribution"), value: 12400, max: 15000, color: "hsl(var(--chart-4))" },
              ],
            },
          },
        ],
      },
      {
        id: "movements",
        title: t("dashboard.inventory.sections.movements"),
        widgets: [
          {
            id: "stock-movement",
            type: "area-chart",
            title: t("dashboard.inventory.widgets.stockMovement"),
            width: "full",
            data: {
              xAxisKey: "day",
              series: [
                { name: "inbound", color: "hsl(var(--chart-2))" },
                { name: "outbound", color: "hsl(var(--chart-5))" },
              ],
              values: [
                { day: "Mon", inbound: 245, outbound: 189 },
                { day: "Tue", inbound: 312, outbound: 234 },
                { day: "Wed", inbound: 198, outbound: 287 },
                { day: "Thu", inbound: 423, outbound: 312 },
                { day: "Fri", inbound: 287, outbound: 398 },
                { day: "Sat", inbound: 156, outbound: 178 },
                { day: "Sun", inbound: 89, outbound: 123 },
              ],
            },
          },
        ],
      },
    ],
  }
}

export function createDashboardConfigs(t: T): Record<string, DashboardConfig> {
  const sales = createSalesDashboard(t)
  const inventory = createInventoryDashboard(t)
  return {
    overview: sales,
    sales,
    inventory,
    customers: sales,
    analytics: inventory,
    settings: sales,
  }
}
