import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../services/apiService'
import type { BetQuote } from '../types/grid'
import { useAuth } from '../contexts/AuthContext'

/**
 * Hook to fetch a bet quote for share-based pricing.
 * Debounces requests to avoid excessive API calls when stake changes rapidly.
 */
export function useBetQuote(
    cellId: string | null,
    assetId: string | null,
    stake: number,
    debounceMs: number = 300
) {
    const [quote, setQuote] = useState<BetQuote | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { authenticated } = useAuth()

    const isMountedRef = useRef(true)
    const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const fetchQuote = useCallback(async () => {
        if (!cellId || !assetId || stake <= 0 || !authenticated) {
            setQuote(null)
            return
        }

        try {
            setLoading(true)
            setError(null)

            const { data } = await api.getBetQuote(cellId, assetId, stake)

            if (!isMountedRef.current) return

            setQuote(data)
        } catch (err) {
            if (!isMountedRef.current) return
            console.error('[useBetQuote] Failed to fetch quote:', err)
            setError('Failed to fetch quote')
            setQuote(null)
        } finally {
            if (isMountedRef.current) {
                setLoading(false)
            }
        }
    }, [cellId, assetId, stake, authenticated])

    // Reset quote when cell changes
    useEffect(() => {
        setQuote(null)
        setError(null)
    }, [cellId])

    // Debounced fetch when inputs change
    useEffect(() => {
        isMountedRef.current = true

        if (!cellId || !assetId || stake <= 0 || !authenticated) {
            setQuote(null)
            return
        }

        // Clear any pending debounce
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current)
        }

        // Debounce the API call
        debounceTimeoutRef.current = setTimeout(() => {
            fetchQuote()
        }, debounceMs)

        return () => {
            isMountedRef.current = false
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current)
            }
        }
    }, [cellId, assetId, stake, authenticated, debounceMs, fetchQuote])

    return {
        quote,
        loading,
        error,
        refresh: fetchQuote,
    }
}
