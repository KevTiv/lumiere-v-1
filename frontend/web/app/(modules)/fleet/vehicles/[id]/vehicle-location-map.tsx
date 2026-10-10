'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { defaultMapLayers } from '@lumiere/ui/lib/map-pin-configs';
import type { MapPinData } from '@lumiere/ui/lib/map-types';

// SSR-safe: leaflet needs browser APIs (same import as the map module).
const MapView = dynamic(() => import('@lumiere/ui/map-components/map-view').then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>,
});

/** A vehicle's last known position as one marker; renders nothing without coordinates. */
export function VehicleLocationMap({ vehicle }: { vehicle: Record<string, unknown> }) {
  const lat = vehicle.latitude == null ? NaN : Number(vehicle.latitude);
  const lng = vehicle.longitude == null ? NaN : Number(vehicle.longitude);
  const hasPosition = Number.isFinite(lat) && Number.isFinite(lng);
  const center = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  const visible = useMemo(() => new Set(['vehicle']), []);
  const pins = useMemo<MapPinData[]>(
    () =>
      hasPosition
        ? [
            {
              id: `veh-${String(vehicle.id)}`,
              layerId: 'vehicle',
              lat,
              lng,
              label: String(vehicle.name ?? ''),
              data: {
                name: String(vehicle.name ?? ''),
                driver: String(vehicle.driverName ?? '—'),
                status: String(vehicle.status ?? 'idle').toLowerCase(),
                speed: Number(vehicle.speedKmh ?? 0),
                last_updated: 'live',
              },
            },
          ]
        : [],
    [hasPosition, lat, lng, vehicle],
  );
  if (!hasPosition) return null;
  return (
    <div className="h-72 overflow-hidden rounded-md border" data-testid="vehicle-location-map">
      <MapView pins={pins} layers={defaultMapLayers} visibleLayers={visible} defaultCenter={center} defaultZoom={13} className="h-full w-full" />
    </div>
  );
}
