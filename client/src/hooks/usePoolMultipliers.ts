import { useEffect, useRef, useState } from 'react'
import type { Pool } from '../services/betService'
import type { Grid } from '../types/grid'
import { getAbsoluteCellId } from '../lib/gridSlots'

const REFETCH_INTERVAL_MS = 10_000
const SERVER_URL = (import.meta.env.VITE_SERVER_URL || 'http://localhost:3000') as string

export function usePoolMultipliers(
    pool: Pool | null,
    grid: Grid | null,
    visibleMinPrice: number,
    visibleMaxPrice: number,
): { multipliers: Record<string, number>; windowTotals: Record<number, number>; cellStakes: Record<string, number> } {
    const [data, setData] = useState<{
        multipliers: Record<string, number>
        windowTotals: Record<number, number>
        cellStakes: Record<string, number>
    }>({ multipliers: {}, windowTotals: {}, cellStakes: {} })

    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (!pool || !grid || !isFinite(visibleMinPrice) || !isFinite(visibleMaxPrice)) return

        const minCellId = getAbsoluteCellId(visibleMinPrice, grid.price_interval || 2)
        const maxCellId = getAbsoluteCellId(visibleMaxPrice, grid.price_interval || 2) + 1

        const fetchStakes = async () => {
            try {
                const res = await fetch(
                    `${SERVER_URL}/api/pools/${pool.poolId}/stakes?minCell=${minCellId}&maxCell=${maxCellId}`
                )
                if (!res.ok) return

                const snapshot = await res.json() as {
                    windowIds: number[]
                    windowTotals: Record<string, number>
                    cellStakes: Record<string, number>
                }

                // Compute multipliers from server data (net pool = total * 98%)
                const multipliers: Record<string, number> = {}
                for (const wid of snapshot.windowIds) {
                    const total = snapshot.windowTotals[wid] ?? 0
                    if (total === 0) continue
                    const netPool = total * 0.98

                    for (let cid = minCellId; cid <= maxCellId; cid++) {
                        const key = `${wid}_${cid}`
                        const stake = snapshot.cellStakes[key]
                        if (!stake || stake === 0) continue
                        multipliers[key] = Math.min(netPool / stake, 999)
                    }
                }

                setData({
                    multipliers,
                    windowTotals: snapshot.windowTotals as Record<number, number>,
                    cellStakes: snapshot.cellStakes,
                })
            } catch {
                // silently keep last known data
            }
        }

        void fetchStakes()
        timerRef.current = setInterval(() => void fetchStakes(), REFETCH_INTERVAL_MS)
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [pool, grid, visibleMinPrice, visibleMaxPrice])

    return data
}
