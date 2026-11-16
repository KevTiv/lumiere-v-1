'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { defaultMapLayers } from '@lumiere/ui/lib/map-pin-configs';
import { useTranslation } from '@lumiere/i18n';
import { fleetPosition } from '../../fleet-workspace';
import { fleetEnumTag } from '../../fleet-record';
import type { MapPinData } from '@lumiere/ui/lib/map-types';

// SSR-safe: leaflet needs browser APIs (same import as the map module).
const MapView = dynamic(() => import('@lumiere/ui/map-components/map-view').then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>,
});

const visibleLayers = new Set(['vehicle']);

/** A vehicle's last known position as one marker; renders nothing without coordinates. */
export function VehicleLocationMap({ vehicle }: { vehicle: Record<string, unknown> }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const position = fleetPosition(vehicle, now);
  if (!position) return null;
  const { latitude, longitude, observedAt, recent, speedKmh } = position;
  const timestamp = observedAt && new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(observedAt);
  const pin: MapPinData = {
    id: `veh-${String(vehicle.id)}`,
    layerId: 'vehicle',
    lat: latitude,
    lng: longitude,
    label: String(vehicle.name ?? ''),
    data: {
      name: vehicle.name,
      driver: vehicle.driver_name ?? vehicle.driverName,
      status: fleetEnumTag(vehicle.status).toLowerCase(),
      speed: speedKmh,
      last_updated: timestamp,
    },
  };

  return (
    <div className="space-y-2" data-testid="vehicle-location-map">
      <p className="text-sm text-muted-foreground" data-testid="vehicle-position-freshness">
        {timestamp
          ? recent
            ? t('fleet.position.recent', { defaultValue: 'Recent position · {{timestamp}}', timestamp })
            : t('fleet.position.lastKnown', { defaultValue: 'Last known position · {{timestamp}}', timestamp })
          : t('fleet.position.timestampUnavailable', { defaultValue: 'Position timestamp unavailable' })}
      </p>
      <div className="h-72 overflow-hidden rounded-md border">
        <MapView pins={[pin]} layers={defaultMapLayers} visibleLayers={visibleLayers} defaultCenter={[latitude, longitude]} defaultZoom={13} className="h-full w-full" />
      </div>
    </div>
  );
}
