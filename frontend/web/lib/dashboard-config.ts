import type { DashboardConfig } from "@lumiere/ui"
import type { TFunction } from "i18next"

export const salesDashboard = (t: TFunction): DashboardConfig => ({
  id: "sales",
  title: t("demo.dashboards.sales.title"),
  description: t("demo.dashboards.sales.description"),
  sections: [
    {
      id: "ios-highlights",
      widgets: [
        {
          id: "ios-kpis",
          type: "ios-tiles",
          title: "",
          width: "2/3",
          useCard: false,
          data: {
            tiles: [
              {
                id: "revenue-tile",
                label: t("demo.dashboards.sales.widgets.revenue.label"),
                value: "$284K",
                subtitle: t("demo.dashboards.sales.widgets.revenue.subtitle"),
                color: "teal",
                progress: 81,
                size: "medium",
              },
              {
                id: "orders-tile",
                label: t("demo.dashboards.sales.widgets.orders.label"),
                value: "1,847",
                subtitle: t("demo.dashboards.sales.widgets.orders.subtitle"),
                color: "blue",
                sparkline: [45, 52, 38, 65, 72, 68, 82],
                size: "medium",
              },
              {
                id: "customers-tile",
                label: t("demo.dashboards.sales.widgets.customers.label"),
                value: "423",
                subtitle: t("demo.dashboards.sales.widgets.customers.subtitle"),
                color: "green",
                progress: 85,
                size: "medium",
              },
              {
                id: "conversion-tile",
                label: t("demo.dashboards.sales.widgets.conversion.label"),
                value: "3.2%",
                subtitle: t("demo.dashboards.sales.widgets.conversion.subtitle"),
                color: "purple",
                sparkline: [2.1, 2.4, 2.8, 3.0, 2.9, 3.1, 3.2],
                size: "medium",
              },
            ],
          },
        },
        {
          id: "daily-goals",
          type: "activity-rings",
          title: t("demo.dashboards.sales.widgets.dailyGoals"),
          width: "1/3",
          data: {
            rings: [
              { id: "sales", label: t("demo.dashboards.sales.rings.salesTarget"), value: 28400, max: 35000, color: "red", unit: "$" },
              { id: "orders", label: t("demo.dashboards.sales.rings.orderTarget"), value: 184, max: 200, color: "green" },
              { id: "calls", label: t("demo.dashboards.sales.rings.callsMade"), value: 42, max: 50, color: "blue" },
            ],
            showLegend: true,
            size: "sm",
          },
        },
      ],
    },
    {
      id: "charts",
      title: t("demo.dashboards.sales.sections.charts"),
      widgets: [
        {
          id: "revenue-trend",
          type: "area-chart",
          title: t("demo.dashboards.sales.widgets.revenueTrend"),
          width: "2/3",
          data: {
            xAxisKey: "month",
            series: [
              { name: "revenue", color: "hsl(var(--chart-1))" },
              { name: "target", color: "hsl(var(--chart-2))" },
            ],
            values: [
              { month: t("demo.dashboards.sales.chartLabels.jan"), revenue: 18500, target: 20000 },
              { month: t("demo.dashboards.sales.chartLabels.feb"), revenue: 22300, target: 22000 },
              { month: t("demo.dashboards.sales.chartLabels.mar"), revenue: 19800, target: 24000 },
              { month: t("demo.dashboards.sales.chartLabels.apr"), revenue: 28400, target: 26000 },
              { month: t("demo.dashboards.sales.chartLabels.may"), revenue: 32100, target: 28000 },
              { month: t("demo.dashboards.sales.chartLabels.jun"), revenue: 29800, target: 30000 },
              { month: t("demo.dashboards.sales.chartLabels.jul"), revenue: 35200, target: 32000 },
              { month: t("demo.dashboards.sales.chartLabels.aug"), revenue: 38900, target: 34000 },
            ],
          },
        },
        {
          id: "targets",
          type: "metrics",
          title: t("demo.dashboards.sales.widgets.targets"),
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
      title: t("demo.dashboards.sales.sections.details"),
      widgets: [
        {
          id: "region-sales",
          type: "bar-chart",
          title: t("demo.dashboards.sales.widgets.regionSales"),
          width: "1/2",
          data: {
            categoryKey: "region",
            layout: "horizontal",
            series: [{ name: "sales", color: "hsl(var(--primary))" }],
            values: [
              { region: t("demo.dashboards.sales.chartLabels.northAmerica"), sales: 125000 },
              { region: t("demo.dashboards.sales.chartLabels.europe"), sales: 89000 },
              { region: t("demo.dashboards.sales.chartLabels.asiaPacific"), sales: 45000 },
              { region: t("demo.dashboards.sales.chartLabels.latinAmerica"), sales: 18000 },
              { region: t("demo.dashboards.sales.chartLabels.middleEast"), sales: 7400 },
            ],
          },
        },
        {
          id: "top-products",
          type: "table",
          title: t("demo.dashboards.sales.widgets.topProducts"),
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
    {
      id: "quick-actions-section",
      title: t("demo.dashboards.sales.sections.quickActions"),
      widgets: [
        {
          id: "sales-actions",
          type: "quick-actions",
          title: "",
          width: "2/3",
          useCard: false,
          data: {
            actions: [
              { id: "new-order", label: t("demo.dashboards.sales.actions.newOrder"), icon: "plus", color: "blue" },
              { id: "reports", label: t("demo.dashboards.sales.actions.reports"), icon: "file", color: "green" },
              { id: "team", label: t("demo.dashboards.sales.actions.team"), icon: "users", color: "purple" },
              { id: "inventory", label: t("demo.dashboards.sales.actions.inventory"), icon: "package", color: "orange" },
              { id: "export", label: t("demo.dashboards.sales.actions.export"), icon: "download", color: "teal" },
              { id: "alerts", label: t("demo.dashboards.sales.actions.alerts"), icon: "bell", color: "red" },
            ],
            columns: 3,
          },
        },
        {
          id: "quarter-countdown",
          type: "countdown",
          title: t("demo.dashboards.sales.widgets.quarterEnd"),
          width: "1/3",
          data: {
            items: [
              { id: "days", label: t("demo.dashboards.sales.countdown.days"), value: 23, unit: "days", color: "blue" },
              { id: "hours", label: t("demo.dashboards.sales.countdown.hours"), value: 14, unit: "hrs", color: "teal" },
              { id: "mins", label: t("demo.dashboards.sales.countdown.minutes"), value: 32, unit: "min", color: "green" },
            ],
            layout: "horizontal",
          },
        },
      ],
    },
  ],
})

export const inventoryDashboard = (t: TFunction): DashboardConfig => ({
  id: "inventory",
  title: t("demo.dashboards.inventory.title"),
  description: t("demo.dashboards.inventory.description"),
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
              { label: t("demo.dashboards.inventory.stats.totalSkus"), value: "2,847", change: 5.2, icon: "package" },
              { label: t("demo.dashboards.inventory.stats.inStock"), value: "2,341", change: 2.1 },
              { label: t("demo.dashboards.inventory.stats.lowStock"), value: "234", change: -12.4 },
              { label: t("demo.dashboards.inventory.stats.outOfStock"), value: "43", change: 8.3 },
            ],
          },
        },
      ],
    },
    {
      id: "stock-levels",
      title: t("demo.dashboards.inventory.sections.stockLevels"),
      widgets: [
        {
          id: "category-stock",
          type: "bar-chart",
          title: t("demo.dashboards.inventory.widgets.categoryStock"),
          width: "1/2",
          data: {
            categoryKey: "category",
            series: [
              { name: "inStock", color: "hsl(var(--chart-2))" },
              { name: "reserved", color: "hsl(var(--chart-3))" },
            ],
            stacked: true,
            values: [
              { category: t("demo.tables.products.categories.electronics"), inStock: 450, reserved: 120 },
              { category: t("demo.tables.products.categories.furniture"), inStock: 280, reserved: 45 },
              { category: t("demo.tables.products.categories.clothing"), inStock: 890, reserved: 230 },
              { category: t("demo.tables.products.categories.food"), inStock: 1200, reserved: 340 },
              { category: "Hardware", inStock: 340, reserved: 89 },
            ],
          },
        },
        {
          id: "warehouse-capacity",
          type: "metrics",
          title: t("demo.dashboards.inventory.widgets.warehouseCapacity"),
          width: "1/2",
          data: {
            metrics: [
              { label: t("demo.dashboards.inventory.warehouses.warehouseA"), value: 8500, max: 10000, color: "hsl(var(--chart-1))" },
              { label: t("demo.dashboards.inventory.warehouses.warehouseB"), value: 6200, max: 8000, color: "hsl(var(--chart-2))" },
              { label: t("demo.dashboards.inventory.warehouses.warehouseC"), value: 3800, max: 5000, color: "hsl(var(--chart-3))" },
              { label: t("demo.dashboards.inventory.warehouses.distributionCenter"), value: 12400, max: 15000, color: "hsl(var(--chart-4))" },
            ],
          },
        },
      ],
    },
    {
      id: "movements",
      title: t("demo.dashboards.inventory.sections.movements"),
      widgets: [
        {
          id: "stock-movement",
          type: "area-chart",
          title: t("demo.dashboards.inventory.widgets.stockMovement"),
          width: "full",
          data: {
            xAxisKey: "day",
            series: [
              { name: "inbound", color: "hsl(var(--chart-2))" },
              { name: "outbound", color: "hsl(var(--chart-5))" },
            ],
            values: [
              { day: t("demo.dashboards.inventory.chartLabels.mon"), inbound: 245, outbound: 189 },
              { day: t("demo.dashboards.inventory.chartLabels.tue"), inbound: 312, outbound: 234 },
              { day: t("demo.dashboards.inventory.chartLabels.wed"), inbound: 198, outbound: 287 },
              { day: t("demo.dashboards.inventory.chartLabels.thu"), inbound: 423, outbound: 312 },
              { day: t("demo.dashboards.inventory.chartLabels.fri"), inbound: 287, outbound: 398 },
              { day: t("demo.dashboards.inventory.chartLabels.sat"), inbound: 156, outbound: 178 },
              { day: t("demo.dashboards.inventory.chartLabels.sun"), inbound: 89, outbound: 123 },
            ],
          },
        },
      ],
    },
  ],
})

export const trackersDashboard = (t: TFunction): DashboardConfig => ({
  id: "trackers",
  title: t("demo.dashboards.trackers.title"),
  description: t("demo.dashboards.trackers.description"),
  sections: [
    {
      id: "ios-tiles",
      widgets: [
        {
          id: "tile-metrics",
          type: "ios-tiles",
          title: "",
          width: "full",
          useCard: false,
          data: {
            tiles: [
              {
                id: "revenue-tile",
                label: t("demo.dashboards.trackers.tiles.revenue"),
                value: "$284K",
                subtitle: "+12.5% this month",
                color: "teal",
                progress: 81,
                size: "large",
              },
              {
                id: "orders-tile",
                label: t("demo.dashboards.trackers.tiles.orders"),
                value: "1,847",
                subtitle: "+8.2% growth",
                color: "blue",
                sparkline: [45, 52, 38, 65, 72, 68, 82],
              },
              {
                id: "customers-tile",
                label: t("demo.dashboards.trackers.tiles.customers"),
                value: "423",
                subtitle: "New this month",
                color: "green",
                progress: 85,
              },
              {
                id: "conversion-tile",
                label: t("demo.dashboards.trackers.tiles.conversion"),
                value: "3.2%",
                subtitle: "Above target",
                color: "purple",
                sparkline: [2.1, 2.4, 2.8, 3.0, 2.9, 3.1, 3.2],
              },
              {
                id: "avg-order-tile",
                label: t("demo.dashboards.trackers.tiles.avgOrder"),
                value: "$154",
                color: "orange",
                progress: 77,
              },
              {
                id: "retention-tile",
                label: t("demo.dashboards.trackers.tiles.retention"),
                value: "87%",
                subtitle: "30-day rate",
                color: "teal",
                sparkline: [82, 84, 83, 85, 86, 85, 87],
              },
            ],
          },
        },
      ],
    },
    {
      id: "activity-section",
      title: t("demo.dashboards.trackers.sections.activity"),
      widgets: [
        {
          id: "activity-rings",
          type: "activity-rings",
          title: t("demo.dashboards.trackers.widgets.dailyGoals"),
          width: "1/2",
          data: {
            rings: [
              { id: "sales", label: t("demo.dashboards.trackers.rings.salesTarget"), value: 28400, max: 35000, color: "red", unit: "$" },
              { id: "orders", label: t("demo.dashboards.trackers.rings.orderTarget"), value: 184, max: 200, color: "green" },
              { id: "calls", label: t("demo.dashboards.trackers.rings.callsMade"), value: 42, max: 50, color: "blue" },
            ],
            showLegend: true,
            size: "md",
          },
        },
        {
          id: "weekly-rings",
          type: "activity-rings",
          title: t("demo.dashboards.trackers.widgets.weeklyProgress"),
          width: "1/2",
          data: {
            rings: [
              { id: "revenue", label: t("demo.dashboards.trackers.rings.revenue"), value: 142000, max: 175000, color: "teal", unit: "$" },
              { id: "leads", label: t("demo.dashboards.trackers.rings.leads"), value: 89, max: 100, color: "orange" },
              { id: "meetings", label: t("demo.dashboards.trackers.rings.meetings"), value: 18, max: 25, color: "purple" },
            ],
            showLegend: true,
            size: "md",
          },
        },
      ],
    },
    {
      id: "countdown-section",
      title: t("demo.dashboards.trackers.sections.countdown"),
      widgets: [
        {
          id: "quarter-countdown",
          type: "countdown",
          title: t("demo.dashboards.trackers.widgets.quarterEnd"),
          width: "1/2",
          data: {
            items: [
              { id: "days", label: t("demo.dashboards.sales.countdown.days"), value: 23, unit: "days", color: "blue" },
              { id: "hours", label: t("demo.dashboards.sales.countdown.hours"), value: 14, unit: "hrs", color: "teal" },
              { id: "mins", label: t("demo.dashboards.sales.countdown.minutes"), value: 32, unit: "min", color: "green" },
              { id: "secs", label: t("demo.dashboards.sales.countdown.seconds"), value: 45, unit: "sec", color: "orange" },
            ],
            layout: "horizontal",
          },
        },
        {
          id: "sprint-progress",
          type: "countdown",
          title: t("demo.dashboards.trackers.widgets.sprintProgress"),
          width: "1/2",
          data: {
            items: [
              { id: "completed", label: t("demo.dashboards.trackers.countdown.completed"), value: 18, unit: "tasks", maxValue: 24, color: "green" },
              { id: "in-progress", label: t("demo.dashboards.trackers.countdown.inProgress"), value: 4, unit: "tasks", maxValue: 24, color: "blue" },
              { id: "pending", label: t("demo.dashboards.trackers.countdown.pending"), value: 2, unit: "tasks", maxValue: 24, color: "orange" },
              { id: "blocked", label: t("demo.dashboards.trackers.countdown.blocked"), value: 0, unit: "tasks", maxValue: 24, color: "red" },
            ],
            layout: "grid",
          },
        },
      ],
    },
    {
      id: "actions-section",
      title: t("demo.dashboards.trackers.sections.actions"),
      widgets: [
        {
          id: "quick-actions",
          type: "quick-actions",
          title: "",
          width: "full",
          useCard: false,
          data: {
            actions: [
              { id: "new-order", label: t("demo.dashboards.trackers.actions.newOrder"), icon: "plus", color: "blue" },
              { id: "reports", label: t("demo.dashboards.trackers.actions.reports"), icon: "file", color: "green" },
              { id: "team", label: t("demo.dashboards.trackers.actions.team"), icon: "users", color: "purple" },
              { id: "inventory", label: t("demo.dashboards.trackers.actions.inventory"), icon: "package", color: "orange" },
              { id: "analytics", label: t("demo.dashboards.trackers.actions.analytics"), icon: "trending", color: "teal" },
              { id: "settings", label: t("demo.dashboards.trackers.actions.settings"), icon: "settings", color: "blue" },
              { id: "export", label: t("demo.dashboards.trackers.actions.export"), icon: "download", color: "green" },
              { id: "alerts", label: t("demo.dashboards.trackers.actions.alerts"), icon: "bell", color: "red" },
            ],
            columns: 4,
          },
        },
      ],
    },
  ],
})

export const getDashboardConfigs = (t: TFunction): Record<string, DashboardConfig> => ({
  overview: salesDashboard(t),
  sales: salesDashboard(t),
  inventory: inventoryDashboard(t),
  customers: trackersDashboard(t),
  analytics: trackersDashboard(t),
  settings: salesDashboard(t),
})

// Backward compatibility - default export using English translations
// These will be replaced at runtime when using the factory function
export { salesDashboard as salesDashboardConfig, inventoryDashboard as inventoryDashboardConfig, trackersDashboard as trackersDashboardConfig }

// Default export for backward compatibility
// Use a simple dot-notation lookup against the raw JSON (safe in server components)
import en from "@lumiere/i18n/locales/en"
function t(key: string): string {
  const parts = key.split(".")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = en
  for (const part of parts) {
    if (node == null || typeof node !== "object") return key
    node = node[part]
  }
  return typeof node === "string" ? node : key
}
const defaultSalesDashboard = salesDashboard(t)
const defaultInventoryDashboard = inventoryDashboard(t)
const defaultTrackersDashboard = trackersDashboard(t)

export const dashboardConfigs: Record<string, DashboardConfig> = {
  overview: defaultSalesDashboard,
  sales: defaultSalesDashboard,
  inventory: defaultInventoryDashboard,
  customers: defaultTrackersDashboard,
  analytics: defaultTrackersDashboard,
  settings: defaultSalesDashboard,
}