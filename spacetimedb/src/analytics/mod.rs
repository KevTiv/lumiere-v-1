/// Analytics & Reporting Module — Dashboards, KPIs, and scheduled reports
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DashboardWidget** | Individual configurable widget on a dashboard |
/// | **Dashboard** | Named collection of widgets with sharing settings |
/// | **ReportTemplate** | Report layout and format definitions |
/// | **ScheduledReport** | Automated periodic report delivery |
/// | **AnalyticsMetric** | KPI / trend metric with cached values |
pub mod dashboards;
pub mod reports;

pub use dashboards::*;
pub use reports::*;
