import { describe, expect, it } from 'vitest'
import {
    getAbsoluteCellId,
    getCellPriceRange,
    getGridEpochMs,
    getSlotKey,
    getSlotKeyFromCell,
    getWindowDurationMs,
    getWindowEndMs,
    getWindowIdAtTime,
    getWindowStartMs,
    isCanonicalSlotKey,
    normalizeSlotKey,
} from './gridSlots'

describe('gridSlots', () => {
    const pool = {
        poolId: '0xpool',
        assetId: 'ETH-USD',
        poolKey: {
            currency0: '0x0',
            currency1: '0x0',
            fee: 0,
            tickSpacing: 60,
            hooks: '0x0',
        },
        gridEpoch: 1_700_000_000,
        windowDurationSec: 60,
    }

    const grid = {
        grid_id: 'grid-1',
        asset_id: 'ETH-USD',
        timeframe_sec: 60,
        price_interval: 2,
        anchor_price: 3000,
        start_time: '2023-11-14T22:13:20.000Z',
        end_time: '2099-01-01T00:00:00.000Z',
    }

    it('prefers pool duration and epoch when present', () => {
        expect(getWindowDurationMs(pool, grid)).toBe(60_000)
        expect(getGridEpochMs(pool, grid)).toBe(1_700_000_000_000)
    })

    it('falls back to grid start time when pool is absent', () => {
        expect(getGridEpochMs(null, grid)).toBe(new Date(grid.start_time).getTime())
        expect(getWindowDurationMs(null, grid)).toBe(60_000)
    })

    it('derives absolute cell ids from price interval', () => {
        expect(getAbsoluteCellId(3000, 2)).toBe(1500)
        expect(getAbsoluteCellId(3001.99, 2)).toBe(1500)
        expect(getAbsoluteCellId(3002, 2)).toBe(1501)
    })

    it('derives price ranges from absolute cell ids', () => {
        expect(getCellPriceRange(1500, 2)).toEqual({ low: 3000, high: 3002 })
    })

    it('derives window ids from epoch math', () => {
        const epochMs = getGridEpochMs(pool, grid)
        expect(getWindowIdAtTime(epochMs, pool, grid)).toBe(0)
        expect(getWindowIdAtTime(epochMs + 60_000, pool, grid)).toBe(1)
        expect(getWindowIdAtTime(epochMs + 179_999, pool, grid)).toBe(2)
    })

    it('derives window start and end times from window id', () => {
        const epochMs = getGridEpochMs(pool, grid)
        expect(getWindowStartMs(2, pool, grid)).toBe(epochMs + 120_000)
        expect(getWindowEndMs(2, pool, grid)).toBe(epochMs + 180_000)
    })

    it('builds canonical slot keys', () => {
        expect(getSlotKey(42, 1500)).toBe('42_1500')
        expect(getSlotKeyFromCell({ window_index: 42, price_band_index: 1500 })).toBe('42_1500')
    })

    it('recognizes canonical slot keys', () => {
        expect(isCanonicalSlotKey('42_1500')).toBe(true)
        expect(isCanonicalSlotKey('legacy-cell-id')).toBe(false)
    })

    it('normalizes legacy backend cell ids using provided cell metadata', () => {
        const cells = [
            {
                cell_id: 'legacy-uuid-1',
                window_index: 42,
                price_band_index: 1500,
            },
        ]

        expect(normalizeSlotKey('legacy-uuid-1', cells)).toBe('42_1500')
        expect(normalizeSlotKey('42_1500', cells)).toBe('42_1500')
        expect(normalizeSlotKey('unknown-cell', cells)).toBe('unknown-cell')
    })
})
