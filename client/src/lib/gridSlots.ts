import type { Pool } from '../services/betService'
import type { Cell, Grid } from '../types/grid'

export function getWindowDurationMs(pool: Pool | null, grid: Grid | null): number {
    const seconds = pool?.windowDurationSec || grid?.timeframe_sec || 60
    return Math.max(1, seconds * 1000)
}

export function getGridEpochMs(pool: Pool | null, grid: Grid | null): number {
    if (typeof pool?.gridEpoch === 'number' && Number.isFinite(pool.gridEpoch) && pool.gridEpoch > 0) {
        return pool.gridEpoch * 1000
    }
    if (grid?.start_time) {
        return new Date(grid.start_time).getTime()
    }
    return 0
}

export function getAbsoluteCellId(price: number, priceInterval: number): number {
    const bandWidthUsdc = Math.max(1, Math.round(priceInterval * 1_000_000))
    return Math.floor((price * 1_000_000) / bandWidthUsdc)
}

export function getCellPriceRange(cellId: number, priceInterval: number): { low: number; high: number } {
    const bandWidthUsdc = Math.max(1, Math.round(priceInterval * 1_000_000))
    return {
        low: (cellId * bandWidthUsdc) / 1_000_000,
        high: ((cellId + 1) * bandWidthUsdc) / 1_000_000,
    }
}

export function getWindowIdAtTime(timestampMs: number, pool: Pool | null, grid: Grid | null): number {
    const durationMs = getWindowDurationMs(pool, grid)
    const epochMs = getGridEpochMs(pool, grid)
    return Math.floor((timestampMs - epochMs) / durationMs)
}

export function getWindowStartMs(windowId: number, pool: Pool | null, grid: Grid | null): number {
    return getGridEpochMs(pool, grid) + windowId * getWindowDurationMs(pool, grid)
}

export function getWindowEndMs(windowId: number, pool: Pool | null, grid: Grid | null): number {
    return getWindowStartMs(windowId, pool, grid) + getWindowDurationMs(pool, grid)
}

export function getSlotKey(windowId: number, absoluteCellId: number): string {
    return `${windowId}_${absoluteCellId}`
}

export function getSlotKeyFromCell(cell: Pick<Cell, 'window_index' | 'price_band_index'>): string {
    return getSlotKey(cell.window_index, cell.price_band_index)
}

export function isCanonicalSlotKey(value: string): boolean {
    return /^\d+_\d+$/.test(value)
}

export function normalizeSlotKey(value: string, cells: Pick<Cell, 'cell_id' | 'window_index' | 'price_band_index'>[]): string {
    if (isCanonicalSlotKey(value)) return value
    const cell = cells.find((item) => item.cell_id === value)
    return cell ? getSlotKeyFromCell(cell) : value
}
