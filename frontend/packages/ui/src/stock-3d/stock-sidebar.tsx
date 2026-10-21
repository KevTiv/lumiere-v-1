"use client"

import { useTranslation } from '@lumiere/i18n'
import { cn } from '../lib/utils'
import { Badge } from '../components/badge'
import { Button } from '../components/button'
import { ScrollArea } from '../components/scroll-area'
import { Separator } from '../components/separator'
import { Package, AlertTriangle, Grid3X3, ChevronRight } from 'lucide-react'
import { useWarehouse3DContext } from './warehouse-3d-context'
import { CATEGORY_COLORS, type StockCategory, type ZoneType } from './types'

interface StockSidebarProps {
  className?: string
}

export function StockSidebar({ className }: StockSidebarProps) {
  const { t } = useTranslation()
  const { items, slots, viewMode, filterCategory, setViewMode, setFilterCategory, zoneStats } =
    useWarehouse3DContext()
  const categoryLabels: Record<StockCategory, string> = {
    electronics: t('ui.stock3d.categories.electronics'),
    clothing: t('ui.stock3d.categories.clothing'),
    food: t('ui.stock3d.categories.food'),
    furniture: t('ui.stock3d.categories.furniture'),
    tools: t('ui.stock3d.categories.tools'),
    packaging: t('ui.stock3d.categories.packaging'),
    'raw-materials': t('ui.stock3d.categories.rawMaterials'),
    'finished-goods': t('ui.stock3d.categories.finishedGoods'),
  }
  const zoneTypeLabels: Record<ZoneType, string> = {
    rack: t('ui.stock3d.zoneTypes.rack'),
    shelf: t('ui.stock3d.zoneTypes.shelf'),
    floor: t('ui.stock3d.zoneTypes.floor'),
    'cold-storage': t('ui.stock3d.zoneTypes.coldStorage'),
    bin: t('ui.stock3d.zoneTypes.bin'),
  }

  const totalItems = items.length
  const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0)
  const lowStockItems = items.filter((i) => i.minStock !== undefined && i.quantity <= i.minStock)
  const emptySlots = slots.filter((s) => !s.occupied)
  const utilizationPercent =
    slots.length > 0 ? Math.round(((slots.length - emptySlots.length) / slots.length) * 100) : 0

  const categoryStats = Object.entries(
    items.reduce(
      (acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    ),
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className={cn('flex flex-col bg-card border-r border-border', className)}>
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-foreground">{t('ui.stock3d.sidebar.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('ui.stock3d.sidebar.subtitle')}</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Package className="h-4 w-4" />
                <span className="text-xs">{t('ui.stock3d.sidebar.totalItems')}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{totalItems}</p>
              <p className="text-xs text-muted-foreground">
                {t('ui.stock3d.sidebar.units', { count: totalQuantity })}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Grid3X3 className="h-4 w-4" />
                <span className="text-xs">{t('ui.stock3d.sidebar.utilization')}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{utilizationPercent}%</p>
              <p className="text-xs text-muted-foreground">
                {t('ui.stock3d.sidebar.emptySlots', { count: emptySlots.length })}
              </p>
            </div>
          </div>

          {/* Low stock alert */}
          {lowStockItems.length > 0 && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-2 text-destructive mb-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">{t('ui.stock3d.sidebar.lowStockAlert')}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('ui.stock3d.sidebar.belowMinimum', { count: lowStockItems.length })}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => setViewMode('low-stock')}
              >
                {t('ui.stock3d.sidebar.viewLowStock')} <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}

          <Separator />

          {/* View mode */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">{t('ui.stock3d.sidebar.viewMode')}</h3>
            <div className="space-y-1">
              {(
                [
                  { mode: 'all', label: t('ui.stock3d.sidebar.viewModes.all'), icon: Package },
                  { mode: 'low-stock', label: t('ui.stock3d.sidebar.viewModes.lowStock'), icon: AlertTriangle },
                  { mode: 'empty-slots', label: t('ui.stock3d.sidebar.viewModes.emptySlots'), icon: Grid3X3 },
                ] as const
              ).map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => {
                    setViewMode(mode)
                    setFilterCategory(null)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                    viewMode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Categories */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">{t('ui.stock3d.sidebar.categories')}</h3>
            <div className="space-y-1">
              {categoryStats.map(([category, count]) => (
                <button
                  key={category}
                  onClick={() => {
                    setViewMode('category')
                    setFilterCategory(
                      filterCategory === category ? null : (category as StockCategory),
                    )
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                    viewMode === 'category' && filterCategory === category
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: CATEGORY_COLORS[category as StockCategory] }}
                  />
                  <span className="flex-1 text-left">
                    {categoryLabels[category as StockCategory]}
                  </span>
                  <Badge variant="secondary" className="h-5 text-xs">
                    {count}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Zones */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">{t('ui.stock3d.sidebar.zones')}</h3>
            <div className="space-y-2">
              {zoneStats.map(({ zone, totalSlots, occupiedSlots, utilizationPercent: pct }) => (
                <div key={zone.id} className="p-3 rounded-lg bg-muted/30 border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-foreground">{zone.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {zoneTypeLabels[zone.type]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">
                      {occupiedSlots}/{totalSlots}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Color legend */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">{t('ui.stock3d.sidebar.colorLegend')}</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CATEGORY_COLORS).map(([category, color]) => (
                <div key={category} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-xs text-muted-foreground truncate">
                    {categoryLabels[category as StockCategory]}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-destructive" />
              <span className="text-xs text-muted-foreground">{t('ui.stock3d.lowStock')}</span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
