"use client"

import { useEffect, useRef, useState } from "react"
import type L from "leaflet"
import "leaflet/dist/leaflet.css"
import { MapPinHoverCard } from "./map-pin-hover-card"
import type { MapLayerConfig, MapPinData } from "@/lib/map-types"
import { cn } from "../native/lib/utils"

interface HoverState {
  pin: MapPinData
  x: number
  y: number
}

interface MapViewProps {
  pins: MapPinData[]
  layers: MapLayerConfig[]
  visibleLayers: Set<string>
  defaultCenter?: [number, number]
  defaultZoom?: number
  className?: string
}

export function MapView({
  pins,
  layers,
  visibleLayers,
  defaultCenter = [20, 0],
  defaultZoom = 2,
  className,
}: MapViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.CircleMarker[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [hovered, setHovered] = useState<HoverState | null>(null)

  // Init map once — raw Leaflet avoids react-leaflet's React-19 StrictMode bug
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    let cancelled = false

    import("leaflet").then((L) => {
      if (cancelled || !mapDivRef.current || mapRef.current) return

      const map = L.map(mapDivRef.current, {
        center: defaultCenter,
        zoom: defaultZoom,
        zoomControl: true,
        scrollWheelZoom: true,
      })

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map)

      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [defaultCenter, defaultZoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update view when center/zoom props change
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.setView(defaultCenter, defaultZoom)
  }, [defaultCenter, defaultZoom])

  // Sync circle markers whenever pins/layers/visibility change (or map becomes ready)
  useEffect(() => {
    if (!mapReady) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      markersRef.current.map((m) => m.remove())
      markersRef.current = []

      const layerMap = new Map(layers.map((l) => [l.id, l]))

      pins
        .filter((pin) => visibleLayers.has(pin.layerId))
        .forEach((pin) => {
          const layer = layerMap.get(pin.layerId)
          if (!layer) return

          const marker = L.circleMarker([pin.lat, pin.lng], {
            radius: 8,
            fillColor: layer.color,
            fillOpacity: 0.9,
            color: "#fff",
            weight: 2,
          })

          marker.on("mouseover", (e: L.LeafletMouseEvent) => {
            const point = map.latLngToContainerPoint(e.latlng)
            setHovered({ pin, x: point.x, y: point.y })
          })

          marker.on("mouseout", () => setHovered(null))

          marker.addTo(map)
          markersRef.current.push(marker)
        })
    })
  }, [pins, layers, visibleLayers, mapReady])

  const layerMap = new Map(layers.map((l) => [l.id, l]))
  const CARD_WIDTH = 224
  const CARD_HEIGHT = 220
  const OFFSET = 14

  function getCardPosition(x: number, y: number, mapW: number, mapH: number) {
    let left = x + OFFSET
    let top = y - CARD_HEIGHT / 2
    if (left + CARD_WIDTH > mapW - 8) left = x - CARD_WIDTH - OFFSET
    if (top < 8) top = 8
    if (top + CARD_HEIGHT > mapH - 8) top = mapH - CARD_HEIGHT - 8
    return { left, top }
  }

  const mapW = wrapperRef.current?.offsetWidth ?? 800
  const mapH = wrapperRef.current?.offsetHeight ?? 500

  return (
    <div ref={wrapperRef} className={cn('rounded-2xl', className)} style={{ position: "relative", borderRadius: "calc(var(--radius) * 1.8" }}>
      <div ref={mapDivRef} style={{ width: "100%", height: "100%" }} />

      {hovered && layerMap.has(hovered.pin.layerId) &&
        (() => {
          const { left, top } = getCardPosition(hovered.x, hovered.y, mapW, mapH)
          const layerIds = layerMap.get(hovered.pin.layerId);
          return (
            <div
              style={{ position: "absolute", left, top, zIndex: 1000, pointerEvents: "none" }}
            >
              {layerIds !== undefined && <MapPinHoverCard
                pin={hovered.pin}
                layer={layerIds}
              />}
            </div>
          )
        })()}
    </div>
  )
}
