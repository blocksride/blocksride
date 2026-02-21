import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../services/apiService'
import type { CellPrice } from '../types/grid'
import { useAuth } from '../contexts/AuthContext'

export interface CellPricesMap {
    [cellId: string]: CellPrice
}

/**
 * Hook to fetch and maintain cell probabilities for a grid.
 * Refreshes every refreshInterval milliseconds.
 */
export function useCellPrices(gridId: string | null, refreshInterval: number = 5000) {
    const [cellPrices, setCellPrices] = useState<CellPricesMap>({})
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { authenticated } = useAuth()

    const isMountedRef = useRef(true)

    const fetchPrices = useCallback(async () => {
        if (!gridId) return

        try {
            setLoading(true)
            setError(null)

            const { data } = await api.getCellPrices(gridId)

            if (!isMountedRef.current) return

            // Convert array to map keyed by cell_id
            const pricesMap: CellPricesMap = {}
            for (const price of data) {
                pricesMap[price.cell_id] = price
            }

            setCellPrices(pricesMap)
        } catch (err) {
            if (!isMountedRef.current) return
            console.error('[useCellPrices] Failed to fetch cell prices:', err)
            setError('Failed to fetch cell prices')
        } finally {
            if (isMountedRef.current) {
                setLoading(false)
            }
        }
    }, [gridId])

    // Reset when grid changes
    useEffect(() => {
        setCellPrices({})
        setError(null)
    }, [gridId])

    // Fetch on mount and set up refresh interval
    useEffect(() => {
        isMountedRef.current = true

        if (!gridId || !authenticated) return

        // Initial fetch
        fetchPrices()

        // Set up periodic refresh
        const intervalId = setInterval(fetchPrices, refreshInterval)

        return () => {
            isMountedRef.current = false
            clearInterval(intervalId)
        }
    }, [gridId, authenticated, refreshInterval, fetchPrices])

    return {
        cellPrices,
        loading,
        error,
        refresh: fetchPrices,
    }
}
