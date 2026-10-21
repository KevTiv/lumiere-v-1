"use client"

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '@lumiere/i18n'
import { cn } from '../lib/utils'
import { Input } from '../components/input'
import { Button } from '../components/button'
import { Badge } from '../components/badge'
import { ScrollArea } from '../components/scroll-area'
import { Search, X, MapPin, Package } from 'lucide-react'
import { useWarehouse3DContext } from './warehouse-3d-context'
import { CATEGORY_COLORS } from './types'

interface StockSearchBarProps {
  className?: string
  onNavigateToItem?: (itemId: string) => void
}

export function StockSearchBar({ className, onNavigateToItem }: StockSearchBarProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { searchQuery, setSearchQuery, highlightedItemIds, items, slots, zones, setSelectedItem } =
    useWarehouse3DContext()

  const searchResults = highlightedItemIds
    .map((id) => {
      const item = items.find((i) => i.id === id)
      if (!item) return null
      const slot = slots.find((s) => s.id === item.slotId)
      const zone = zones.find((z) => z.id === item.zoneId)
      return { item, slot, zone }
    })
    .filter(Boolean)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectItem = (itemId: string) => {
    setSelectedItem(itemId)
    onNavigateToItem?.(itemId)
    setIsOpen(false)
  }

  const handleClear = () => {
    setSearchQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={t('ui.stock3d.search.placeholder')}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setIsOpen(e.target.value.length > 0)
          }}
          onFocus={() => searchQuery && setIsOpen(true)}
          className="pl-10 pr-10"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={handleClear}
            aria-label={t('ui.stock3d.search.clear')}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isOpen && searchResults.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/50">
            <span className="text-xs text-muted-foreground">
              {t('ui.stock3d.search.resultsFound', { count: searchResults.length })}
            </span>
          </div>
          <ScrollArea className="max-h-72">
            <div className="p-2 space-y-1">
              {searchResults.map((result) => {
                if (!result) return null
                const { item, slot, zone } = result
                const isLowStock = item.minStock !== undefined && item.quantity <= item.minStock

                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item.id)}
                    className="w-full flex items-start gap-3 p-2 rounded-md hover:bg-muted transition-colors text-left"
                  >
                    <div
                      className="w-8 h-8 rounded-md flex items-center justify-center mt-0.5"
                      style={{ backgroundColor: CATEGORY_COLORS[item.category] + '20' }}
                    >
                      <Package
                        className="h-4 w-4"
                        style={{ color: CATEGORY_COLORS[item.category] }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground truncate">
                          {item.name}
                        </span>
                        {isLowStock && (
                          <Badge variant="destructive" className="h-5 text-[10px]">
                            {t('ui.stock3d.search.lowBadge')}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{item.sku}</span>
                        <span className="text-xs text-muted-foreground">
                          {t('ui.stock3d.quantityWithValue', { quantity: item.quantity })}
                        </span>
                      </div>
                      {zone && slot && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          <span>
                            {t('ui.stock3d.search.resultLocation', {
                              zone: zone.name,
                              row: slot.row + 1,
                              column: slot.column + 1,
                              level: slot.level + 1,
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {isOpen && searchQuery && searchResults.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-lg shadow-lg z-50 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t('ui.stock3d.search.noResults', { query: searchQuery })}
          </p>
        </div>
      )}
    </div>
  )
}
