"use client"

import { useState } from 'react'
import { cn } from '../lib/utils'
import { Button } from '../components/button'
import { Input } from '../components/input'
import { Label } from '../components/label'
import { Badge } from '../components/badge'
import { Separator } from '../components/separator'
import {
  X,
  Package,
  MapPin,
  Calendar,
  Edit2,
  Trash2,
  ArrowRightLeft,
  Save,
  AlertTriangle,
} from 'lucide-react'
import { useWarehouse3DContext } from './warehouse-3d-context'
import { CATEGORY_COLORS, type StockCategory } from './types'
import { format } from 'date-fns'

interface ItemDetailsPanelProps {
  className?: string
}

const categoryLabels: Record<StockCategory, string> = {
  electronics: 'Electronics',
  clothing: 'Clothing',
  food: 'Food & Beverage',
  furniture: 'Furniture',
  tools: 'Tools',
  packaging: 'Packaging',
  'raw-materials': 'Raw Materials',
  'finished-goods': 'Finished Goods',
}

export function ItemDetailsPanel({ className }: ItemDetailsPanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editQuantity, setEditQuantity] = useState('')

  const {
    selectedItemId,
    items,
    slots,
    zones,
    setSelectedItem,
    onMoveItem,
    onUpdateQuantity,
    onRemoveItem,
  } = useWarehouse3DContext()

  const item = items.find((i) => i.id === selectedItemId)
  const slot = item ? slots.find((s) => s.id === item.slotId) : null
  const zone = item ? zones.find((z) => z.id === item.zoneId) : null

  if (!item || !selectedItemId) return null

  const isLowStock = item.minStock !== undefined && item.quantity <= item.minStock

  const handleSaveQuantity = () => {
    const newQuantity = parseInt(editQuantity)
    if (!isNaN(newQuantity) && newQuantity >= 0) {
      onUpdateQuantity?.(item.id, newQuantity)
    }
    setIsEditing(false)
    setEditQuantity('')
  }

  const handleDelete = () => {
    if (confirm(`Remove "${item.name}" from inventory?`)) {
      onRemoveItem?.(item.id)
      setSelectedItem(null)
    }
  }

  const handleStartEdit = () => {
    setEditQuantity(item.quantity.toString())
    setIsEditing(true)
  }

  return (
    <div
      className={cn(
        'bg-card border-t border-border shadow-lg animate-in slide-in-from-bottom duration-300',
        className,
      )}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: CATEGORY_COLORS[item.category] + '20' }}
            >
              <Package
                className="h-6 w-6"
                style={{ color: CATEGORY_COLORS[item.category] }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{item.name}</h3>
                {isLowStock && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Low Stock
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline">{item.sku}</Badge>
                <Badge
                  style={{
                    backgroundColor: CATEGORY_COLORS[item.category] + '20',
                    color: CATEGORY_COLORS[item.category],
                    borderColor: CATEGORY_COLORS[item.category],
                  }}
                >
                  {categoryLabels[item.category]}
                </Badge>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSelectedItem(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator className="my-4" />

        {/* Details Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Quantity */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Quantity</Label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(e.target.value)}
                  className="h-8 w-20"
                  min={0}
                  autoFocus
                />
                <Button size="sm" variant="ghost" className="h-8" onClick={handleSaveQuantity}>
                  <Save className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p
                  className={cn(
                    'text-lg font-semibold',
                    isLowStock ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {item.quantity}
                </p>
                {onUpdateQuantity && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={handleStartEdit}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
            {item.minStock !== undefined && (
              <p className="text-xs text-muted-foreground">
                Min: {item.minStock} / Max: {item.maxStock}
              </p>
            )}
          </div>

          {/* Location */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Location</Label>
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{zone?.name}</p>
            </div>
            {slot && (
              <p className="text-xs text-muted-foreground">
                Row {slot.row + 1}, Col {slot.column + 1}, Level {slot.level + 1}
              </p>
            )}
          </div>

          {/* Last Updated */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Last Updated</Label>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {format(item.lastUpdated, 'MMM d, yyyy')}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{format(item.lastUpdated, 'h:mm a')}</p>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Actions</Label>
            <div className="flex items-center gap-2">
              {onMoveItem && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => onMoveItem(item.id, '')}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Move
                </Button>
              )}
              {onRemoveItem && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 gap-1.5"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
