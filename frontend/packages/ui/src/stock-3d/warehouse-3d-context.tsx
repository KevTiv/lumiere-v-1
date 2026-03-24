"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import type { Zone, StorageSlot, StockItem, StockCategory } from './types'

// ── State ─────────────────────────────────────────────────────────────────────

export type ViewMode = 'all' | 'low-stock' | 'empty-slots' | 'category'

interface UIState {
  selectedItemId: string | null
  selectedSlotId: string | null
  hoveredItemId: string | null
  searchQuery: string
  highlightedItemIds: string[]
  viewMode: ViewMode
  filterCategory: StockCategory | null
}

type Action =
  | { type: 'SET_SELECTED_ITEM'; id: string | null }
  | { type: 'SET_SELECTED_SLOT'; id: string | null }
  | { type: 'SET_HOVERED_ITEM'; id: string | null }
  | { type: 'SET_SEARCH_QUERY'; query: string; matchIds: string[] }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'SET_FILTER_CATEGORY'; category: StockCategory | null }

function uiReducer(state: UIState, action: Action): UIState {
  switch (action.type) {
    case 'SET_SELECTED_ITEM':
      return { ...state, selectedItemId: action.id }
    case 'SET_SELECTED_SLOT':
      return { ...state, selectedSlotId: action.id }
    case 'SET_HOVERED_ITEM':
      return { ...state, hoveredItemId: action.id }
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query, highlightedItemIds: action.matchIds }
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode }
    case 'SET_FILTER_CATEGORY':
      return { ...state, filterCategory: action.category }
    default:
      return state
  }
}

const initialUIState: UIState = {
  selectedItemId: null,
  selectedSlotId: null,
  hoveredItemId: null,
  searchQuery: '',
  highlightedItemIds: [],
  viewMode: 'all',
  filterCategory: null,
}

// ── Context ───────────────────────────────────────────────────────────────────

export interface ZoneStat {
  zone: Zone
  totalSlots: number
  occupiedSlots: number
  utilizationPercent: number
  itemCount: number
  totalQuantity: number
}

interface Warehouse3DContextValue extends UIState {
  // Data from SpacetimeDB
  zones: Zone[]
  slots: StorageSlot[]
  items: StockItem[]

  // Setters
  setSelectedItem: (id: string | null) => void
  setSelectedSlot: (id: string | null) => void
  setHoveredItem: (id: string | null) => void
  setSearchQuery: (query: string) => void
  setViewMode: (mode: ViewMode) => void
  setFilterCategory: (category: StockCategory | null) => void

  // External callbacks (wired to SpacetimeDB reducers by parent)
  onMoveItem?: (itemId: string, targetSlotId: string) => void
  onUpdateQuantity?: (itemId: string, quantity: number) => void
  onRemoveItem?: (itemId: string) => void

  // Derived
  filteredItems: StockItem[]
  zoneStats: ZoneStat[]
}

const Warehouse3DContext = createContext<Warehouse3DContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

interface Warehouse3DProviderProps {
  children: ReactNode
  zones: Zone[]
  slots: StorageSlot[]
  items: StockItem[]
  onMoveItem?: (itemId: string, targetSlotId: string) => void
  onUpdateQuantity?: (itemId: string, quantity: number) => void
  onRemoveItem?: (itemId: string) => void
}

export function Warehouse3DProvider({
  children,
  zones,
  slots,
  items,
  onMoveItem,
  onUpdateQuantity,
  onRemoveItem,
}: Warehouse3DProviderProps) {
  const [uiState, dispatch] = useReducer(uiReducer, initialUIState)

  const setSelectedItem = useCallback((id: string | null) => {
    dispatch({ type: 'SET_SELECTED_ITEM', id })
  }, [])

  const setSelectedSlot = useCallback((id: string | null) => {
    dispatch({ type: 'SET_SELECTED_SLOT', id })
  }, [])

  const setHoveredItem = useCallback((id: string | null) => {
    dispatch({ type: 'SET_HOVERED_ITEM', id })
  }, [])

  const setSearchQuery = useCallback(
    (query: string) => {
      const matchIds = query.trim()
        ? items
            .filter(
              (item) =>
                item.name.toLowerCase().includes(query.toLowerCase()) ||
                item.sku.toLowerCase().includes(query.toLowerCase()),
            )
            .map((item) => item.id)
        : []
      dispatch({ type: 'SET_SEARCH_QUERY', query, matchIds })
    },
    [items],
  )

  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', mode })
  }, [])

  const setFilterCategory = useCallback((category: StockCategory | null) => {
    dispatch({ type: 'SET_FILTER_CATEGORY', category })
  }, [])

  const filteredItems = useMemo(() => {
    switch (uiState.viewMode) {
      case 'low-stock':
        return items.filter((item) => item.minStock && item.quantity <= item.minStock)
      case 'category':
        return uiState.filterCategory
          ? items.filter((item) => item.category === uiState.filterCategory)
          : items
      default:
        return items
    }
  }, [items, uiState.viewMode, uiState.filterCategory])

  const zoneStats = useMemo<ZoneStat[]>(() => {
    return zones.map((zone) => {
      const zoneSlots = slots.filter((s) => s.zoneId === zone.id)
      const occupiedSlots = zoneSlots.filter((s) => s.occupied)
      const zoneItems = items.filter((i) => i.zoneId === zone.id)
      const totalQuantity = zoneItems.reduce((sum, i) => sum + i.quantity, 0)

      return {
        zone,
        totalSlots: zoneSlots.length,
        occupiedSlots: occupiedSlots.length,
        utilizationPercent:
          zoneSlots.length > 0
            ? Math.round((occupiedSlots.length / zoneSlots.length) * 100)
            : 0,
        itemCount: zoneItems.length,
        totalQuantity,
      }
    })
  }, [zones, slots, items])

  const value = useMemo<Warehouse3DContextValue>(
    () => ({
      ...uiState,
      zones,
      slots,
      items,
      setSelectedItem,
      setSelectedSlot,
      setHoveredItem,
      setSearchQuery,
      setViewMode,
      setFilterCategory,
      onMoveItem,
      onUpdateQuantity,
      onRemoveItem,
      filteredItems,
      zoneStats,
    }),
    [
      uiState,
      zones,
      slots,
      items,
      setSelectedItem,
      setSelectedSlot,
      setHoveredItem,
      setSearchQuery,
      setViewMode,
      setFilterCategory,
      onMoveItem,
      onUpdateQuantity,
      onRemoveItem,
      filteredItems,
      zoneStats,
    ],
  )

  return <Warehouse3DContext.Provider value={value}>{children}</Warehouse3DContext.Provider>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWarehouse3DContext(): Warehouse3DContextValue {
  const ctx = useContext(Warehouse3DContext)
  if (!ctx) throw new Error('useWarehouse3DContext must be used inside <Warehouse3DProvider>')
  return ctx
}
