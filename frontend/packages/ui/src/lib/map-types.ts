export type MapPinFieldType = "text" | "number" | "currency" | "badge" | "status" | "link"

export interface MapPinField {
  key: string
  label: string
  type?: MapPinFieldType
  badgeVariants?: Record<string, string>
  badgeLabels?: Record<string, string>
  format?: (value: unknown) => string
}

export interface MapLayerConfig {
  id: string
  label: string
  /** Hex color used for pin marker fill and legend dot */
  color: string
  /** Lucide icon name (resolved in MapLayerLegend) */
  icon: string
  /** Ordered list of fields to show in the hover card */
  fields: MapPinField[]
  defaultVisible?: boolean
}

export interface MapViewConfig {
  layers: MapLayerConfig[]
  defaultCenter?: [number, number]
  defaultZoom?: number
}

export interface MapPinData {
  id: string
  layerId: string
  lat: number
  lng: number
  /** Primary label shown above the hover card */
  label: string
  data: Record<string, unknown>
}
