// Jupyter-like Notebook Types for ML/Predictive Analytics

export type CellType = "code" | "markdown" | "output" | "chart" | "table"
export type CellStatus = "idle" | "running" | "success" | "error"
export type OutputType = "text" | "html" | "image" | "table" | "chart" | "error"

export interface CellOutput {
  id: string
  type: OutputType
  content: string
  data?: unknown
  timestamp: Date
  executionTime?: number
}

export interface NotebookCell {
  id: string
  type: CellType
  content: string
  outputs: CellOutput[]
  status: CellStatus
  executionCount?: number
  metadata?: {
    collapsed?: boolean
    scrolled?: boolean
    trusted?: boolean
    tags?: string[]
  }
  createdAt: Date
  updatedAt: Date
}

export interface Notebook {
  id: string
  title: string
  description?: string
  cells: NotebookCell[]
  metadata: NotebookMetadata
  createdAt: Date
  updatedAt: Date
  author?: string
}

export interface NotebookMetadata {
  kernelSpec?: {
    name: string
    language: string
    displayName: string
  }
  languageInfo?: {
    name: string
    version: string
  }
  tags?: string[]
  category?: "analysis" | "ml" | "report" | "visualization" | "sales" | "inventory" | "customers" | "financial" | "custom"
}

// Kernel simulation for demo
export interface KernelState {
  status: "idle" | "busy" | "starting" | "error"
  executionCount: number
  variables: Record<string, unknown>
  imports: string[]
}

// Code completion suggestion
export interface CodeSuggestion {
  text: string
  displayText: string
  type: "function" | "variable" | "module" | "snippet"
  description?: string
}

// Data context available to notebooks
export interface NotebookDataContext {
  sales: unknown[]
  inventory: unknown[]
  customers: unknown[]
  dateRange?: {
    start: Date
    end: Date
  }
}

// Report template
export interface ReportTemplate {
  id: string
  name: string
  description: string
  category: "sales" | "inventory" | "customers" | "financial" | "custom"
  cells: Partial<NotebookCell>[]
  variables: Record<string, string>
}

// ML Model output
export interface MLModelOutput {
  type: "regression" | "classification" | "clustering" | "forecast"
  metrics: Record<string, number>
  predictions?: unknown[]
  visualization?: string
  summary: string
}

// Chart configuration for visualizations
export interface ChartConfig {
  type: "line" | "bar" | "scatter" | "pie" | "area" | "heatmap"
  title?: string
  xAxis?: string
  yAxis?: string
  data: unknown[]
  options?: Record<string, unknown>
}

// Default Python snippets for ML
export const mlSnippets = {
  imports: `import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt`,

  loadData: `# Load data from ERP context
df = pd.DataFrame(data['sales'])
print(f"Loaded {len(df)} records")
df.head()`,

  basicStats: `# Basic statistics
print(df.describe())
print(f"\\nMissing values:\\n{df.isnull().sum()}")`,

  linearRegression: `from sklearn.linear_model import LinearRegression

X = df[['feature1', 'feature2']]
y = df['target']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

model = LinearRegression()
model.fit(X_train, y_train)

score = model.score(X_test, y_test)
print(f"R² Score: {score:.4f}")`,

  forecast: `from sklearn.ensemble import RandomForestRegressor

# Time series forecasting
model = RandomForestRegressor(n_estimators=100)
model.fit(X_train, y_train)

predictions = model.predict(X_test)
print(f"Mean prediction: {predictions.mean():.2f}")`,

  visualization: `import matplotlib.pyplot as plt

plt.figure(figsize=(10, 6))
plt.plot(df['date'], df['value'])
plt.title('Trend Analysis')
plt.xlabel('Date')
plt.ylabel('Value')
plt.show()`,

  reportSummary: `# Generate Report Summary
summary = {
    'total_records': len(df),
    'date_range': f"{df['date'].min()} to {df['date'].max()}",
    'key_metrics': {
        'total': df['value'].sum(),
        'average': df['value'].mean(),
        'trend': 'increasing' if df['value'].iloc[-1] > df['value'].iloc[0] else 'decreasing'
    }
}
print(summary)`,
}

// Report templates
export const reportTemplates: ReportTemplate[] = [
  {
    id: "sales-analysis",
    name: "Sales Analysis Report",
    description: "Comprehensive sales performance analysis with trends and forecasts",
    category: "sales",
    cells: [
      { type: "markdown", content: "# Sales Analysis Report\n\nGenerated analysis of sales performance." },
      { type: "code", content: mlSnippets.imports },
      { type: "code", content: mlSnippets.loadData },
      { type: "code", content: mlSnippets.basicStats },
    ],
    variables: { dataSource: "sales", dateRange: "last_quarter" },
  },
  {
    id: "inventory-forecast",
    name: "Inventory Forecast",
    description: "Predictive inventory analysis for stock optimization",
    category: "inventory",
    cells: [
      { type: "markdown", content: "# Inventory Forecast Report\n\nPredictive analysis for optimal stock levels." },
      { type: "code", content: mlSnippets.imports },
      { type: "code", content: "df = pd.DataFrame(data['inventory'])" },
      { type: "code", content: mlSnippets.forecast },
    ],
    variables: { dataSource: "inventory", forecastPeriod: "30_days" },
  },
  {
    id: "customer-segmentation",
    name: "Customer Segmentation",
    description: "ML-based customer clustering and segmentation analysis",
    category: "customers",
    cells: [
      { type: "markdown", content: "# Customer Segmentation Analysis\n\nClustering analysis for customer segments." },
      { type: "code", content: mlSnippets.imports + "\nfrom sklearn.cluster import KMeans" },
      { type: "code", content: "df = pd.DataFrame(data['customers'])" },
    ],
    variables: { dataSource: "customers", clusters: "5" },
  },
]
