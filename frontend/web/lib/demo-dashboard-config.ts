import type { DashboardConfig } from "@lumiere/ui"
import { DollarSign, ShoppingCart, Users, Package, TrendingUp, Bell } from "lucide-react"

export const salesDashboard: DashboardConfig = {
  id: "sales",
  title: "Sales Dashboard",
  description: "Real-time sales performance and analytics",
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
                label: "Revenue",
                value: "$284K",
                subtitle: "+12.5% this month",
                color: "teal",
                progress: 81,
                size: "medium",
              },
              {
                id: "orders-tile",
                label: "Orders",
                value: "1,847",
                subtitle: "+8.2% growth",
                color: "blue",
                sparkline: [45, 52, 38, 65, 72, 68, 82],
                size: "medium",
              },
              {
                id: "customers-tile",
                label: "Customers",
                value: "423",
                subtitle: "New this month",
                color: "green",
                progress: 85,
                size: "medium",
              },
              {
                id: "conversion-tile",
                label: "Conversion",
                value: "3.2%",
                subtitle: "Above target",
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
          title: "Daily Goals",
          width: "1/3",
          data: {
            rings: [
              { id: "sales", label: "Sales Target", value: 28400, max: 35000, color: "red", unit: "$" },
              { id: "orders", label: "Order Target", value: 184, max: 200, color: "green" },
              { id: "calls", label: "Calls Made", value: 42, max: 50, color: "blue" },
            ],
            showLegend: true,
            size: "sm",
          },
        },
      ],
    },
    {
      id: "charts",
      title: "Performance Trends",
      widgets: [
        {
          id: "revenue-trend",
          type: "area-chart",
          title: "Revenue Over Time",
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
          title: "Monthly Targets",
          width: "1/3",
          data: {
            metrics: [
              { label: "Revenue Target", value: 284000, max: 350000, color: "hsl(var(--chart-1))" },
              { label: "Orders Target", value: 1847, max: 2000, color: "hsl(var(--chart-2))" },
              { label: "Customer Acquisition", value: 423, max: 500, color: "hsl(var(--chart-3))" },
              { label: "Retention Rate", value: 87, max: 100, color: "hsl(var(--chart-4))" },
            ],
          },
        },
      ],
    },
    {
      id: "details",
      title: "Sales by Region",
      widgets: [
        {
          id: "region-sales",
          type: "bar-chart",
          title: "Regional Performance",
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
          title: "Top Products",
          width: "1/2",
          data: {
            columns: [
              { key: "product", label: "Product" },
              { key: "sales", label: "Sales", align: "right" as const },
              { key: "revenue", label: "Revenue", align: "right" as const },
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
      title: "Quick Actions",
      widgets: [
        {
          id: "sales-actions",
          type: "quick-actions",
          title: "",
          width: "2/3",
          useCard: false,
          data: {
            actions: [
              { id: "new-order", label: "New Order", icon: "plus", color: "blue" },
              { id: "reports", label: "Reports", icon: "file", color: "green" },
              { id: "team", label: "Team", icon: "users", color: "purple" },
              { id: "inventory", label: "Inventory", icon: "package", color: "orange" },
              { id: "export", label: "Export", icon: "download", color: "teal" },
              { id: "alerts", label: "Alerts", icon: "bell", color: "red" },
            ],
            columns: 3,
          },
        },
        {
          id: "quarter-countdown",
          type: "countdown",
          title: "Quarter End",
          width: "1/3",
          data: {
            items: [
              { id: "days", label: "Days", value: 23, unit: "days", color: "blue" },
              { id: "hours", label: "Hours", value: 14, unit: "hrs", color: "teal" },
              { id: "mins", label: "Minutes", value: 32, unit: "min", color: "green" },
            ],
            layout: "horizontal",
          },
        },
      ],
    },
  ],
}

export const inventoryDashboard: DashboardConfig = {
  id: "inventory",
  title: "Inventory Dashboard",
  description: "Stock levels, movements, and warehouse analytics",
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
              { label: "Total SKUs", value: "2,847", change: 5.2, icon: "package" },
              { label: "In Stock", value: "2,341", change: 2.1 },
              { label: "Low Stock", value: "234", change: -12.4 },
              { label: "Out of Stock", value: "43", change: 8.3 },
            ],
          },
        },
      ],
    },
    {
      id: "stock-levels",
      title: "Stock Analysis",
      widgets: [
        {
          id: "category-stock",
          type: "bar-chart",
          title: "Stock by Category",
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
          title: "Warehouse Capacity",
          width: "1/2",
          data: {
            metrics: [
              { label: "Warehouse A", value: 8500, max: 10000, color: "hsl(var(--chart-1))" },
              { label: "Warehouse B", value: 6200, max: 8000, color: "hsl(var(--chart-2))" },
              { label: "Warehouse C", value: 3800, max: 5000, color: "hsl(var(--chart-3))" },
              { label: "Distribution Center", value: 12400, max: 15000, color: "hsl(var(--chart-4))" },
            ],
          },
        },
      ],
    },
    {
      id: "movements",
      title: "Recent Activity",
      widgets: [
        {
          id: "stock-movement",
          type: "area-chart",
          title: "Stock Movement Trends",
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

export const trackersDashboard: DashboardConfig = {
  id: "trackers",
  title: "Activity Trackers",
  description: "iOS-inspired widgets for monitoring key metrics",
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
                label: "Revenue",
                value: "$284K",
                subtitle: "+12.5% this month",
                color: "teal",
                progress: 81,
                size: "large",
              },
              {
                id: "orders-tile",
                label: "Orders",
                value: "1,847",
                subtitle: "+8.2% growth",
                color: "blue",
                sparkline: [45, 52, 38, 65, 72, 68, 82],
              },
              {
                id: "customers-tile",
                label: "Customers",
                value: "423",
                subtitle: "New this month",
                color: "green",
                progress: 85,
              },
              {
                id: "conversion-tile",
                label: "Conversion",
                value: "3.2%",
                subtitle: "Above target",
                color: "purple",
                sparkline: [2.1, 2.4, 2.8, 3.0, 2.9, 3.1, 3.2],
              },
              {
                id: "avg-order-tile",
                label: "Avg Order",
                value: "$154",
                color: "orange",
                progress: 77,
              },
              {
                id: "retention-tile",
                label: "Retention",
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
      title: "Performance Rings",
      widgets: [
        {
          id: "activity-rings",
          type: "activity-rings",
          title: "Daily Goals",
          width: "1/2",
          data: {
            rings: [
              { id: "sales", label: "Sales Target", value: 28400, max: 35000, color: "red", unit: "$" },
              { id: "orders", label: "Order Target", value: 184, max: 200, color: "green" },
              { id: "calls", label: "Calls Made", value: 42, max: 50, color: "blue" },
            ],
            showLegend: true,
            size: "md",
          },
        },
        {
          id: "weekly-rings",
          type: "activity-rings",
          title: "Weekly Progress",
          width: "1/2",
          data: {
            rings: [
              { id: "revenue", label: "Revenue", value: 142000, max: 175000, color: "teal", unit: "$" },
              { id: "leads", label: "Leads Generated", value: 89, max: 100, color: "orange" },
              { id: "meetings", label: "Meetings", value: 18, max: 25, color: "purple" },
            ],
            showLegend: true,
            size: "md",
          },
        },
      ],
    },
    {
      id: "countdown-section",
      title: "Time Trackers",
      widgets: [
        {
          id: "quarter-countdown",
          type: "countdown",
          title: "Quarter End",
          width: "1/2",
          data: {
            items: [
              { id: "days", label: "Days", value: 23, unit: "days", color: "blue" },
              { id: "hours", label: "Hours", value: 14, unit: "hrs", color: "teal" },
              { id: "mins", label: "Minutes", value: 32, unit: "min", color: "green" },
              { id: "secs", label: "Seconds", value: 45, unit: "sec", color: "orange" },
            ],
            layout: "horizontal",
          },
        },
        {
          id: "sprint-progress",
          type: "countdown",
          title: "Sprint Progress",
          width: "1/2",
          data: {
            items: [
              { id: "completed", label: "Completed", value: 18, unit: "tasks", maxValue: 24, color: "green" },
              { id: "in-progress", label: "In Progress", value: 4, unit: "tasks", maxValue: 24, color: "blue" },
              { id: "pending", label: "Pending", value: 2, unit: "tasks", maxValue: 24, color: "orange" },
              { id: "blocked", label: "Blocked", value: 0, unit: "tasks", maxValue: 24, color: "red" },
            ],
            layout: "grid",
          },
        },
      ],
    },
    {
      id: "actions-section",
      title: "Quick Actions",
      widgets: [
        {
          id: "quick-actions",
          type: "quick-actions",
          title: "",
          width: "full",
          useCard: false,
          data: {
            actions: [
              { id: "new-order", label: "New Order", icon: "plus", color: "blue" },
              { id: "reports", label: "Reports", icon: "file", color: "green" },
              { id: "team", label: "Team", icon: "users", color: "purple" },
              { id: "inventory", label: "Inventory", icon: "package", color: "orange" },
              { id: "analytics", label: "Analytics", icon: "trending", color: "teal" },
              { id: "settings", label: "Settings", icon: "settings", color: "blue" },
              { id: "export", label: "Export", icon: "download", color: "green" },
              { id: "alerts", label: "Alerts", icon: "bell", color: "red" },
            ],
            columns: 4,
          },
        },
      ],
    },
  ],
}

export const dashboardConfigs: Record<string, DashboardConfig> = {
  overview: salesDashboard,
  sales: salesDashboard,
  inventory: inventoryDashboard,
  customers: trackersDashboard,
  analytics: trackersDashboard,
  settings: salesDashboard,
}
