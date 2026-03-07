import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../services/apiService'
import type { Grid } from '../types/grid'
import { PricePoint } from '../types/grid'

export function useGridPrices(selectedAsset: string, grid: Grid | null) {
  const [prices, setPrices] = useState<PricePoint[]>([])
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)

  // Batch price updates to reduce re-renders
  const pendingPricesRef = useRef<PricePoint[]>([])
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPrices = useCallback(() => {
    if (pendingPricesRef.current.length === 0) return

    const newPrices = pendingPricesRef.current
    pendingPricesRef.current = []

    setPrices((prev) => {
      const combined = [...prev, ...newPrices]
      const uniqueMap = new Map<number, PricePoint>()
      combined.forEach((p) => uniqueMap.set(p.time, p))
      const sorted = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time)
      // Keep up to 50000 prices
      return sorted.slice(-50000)
    })
  }, [])

  useEffect(() => {
    setPrices([])
    setCurrentPrice(null)
  }, [selectedAsset])

  useEffect(() => {
    if (!grid) return

    let isMounted = true
    const now = Date.now()

    // Progressive loading: load in chunks, starting with recent data
    const loadPriceChunk = async (endTime: number, hoursBack: number) => {
      if (!isMounted) return false

      const startTime = new Date(endTime - hoursBack * 60 * 60 * 1000).toISOString()
      const endTimeStr = new Date(endTime).toISOString()

      try {
        const { data: history } = await api.getPriceHistory(
          grid.asset_id,
          startTime,
          endTimeStr
        )

        if (!isMounted) return false

        const historicalPrices = history.map((h) => ({
          time: new Date(h.timestamp).getTime(),
          price: h.price,
        }))

        setPrices((prev) => {
          const combined = [...historicalPrices, ...prev]
          const uniqueMap = new Map()
          combined.forEach((p) => uniqueMap.set(p.time, p))
          return Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time)
        })

        return true
      } catch (err) {
        console.error('[useGridPrices] Failed to load price chunk:', err)
        return false
      }
    }

    // Load progressively: first 30min, then 2h chunks up to 24h
    const loadProgressively = async () => {
      // First chunk: last 30 minutes (fast, immediate display)
      await loadPriceChunk(now, 0.5)

      // Continue loading in 2-hour chunks up to 24 hours
      let cursor = now - 0.5 * 60 * 60 * 1000
      const maxHistory = now - 24 * 60 * 60 * 1000

      while (isMounted && cursor > maxHistory) {
        const success = await loadPriceChunk(cursor, 2)
        if (!success) break
        cursor -= 2 * 60 * 60 * 1000
        // Small delay between chunks to not overwhelm the server
        await new Promise(r => setTimeout(r, 100))
      }
    }

    loadProgressively()

    return () => {
      isMounted = false
    }
  }, [grid])

  useEffect(() => {
    let isActive = true
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080'
    const baseURL = serverUrl.endsWith('/api') ? serverUrl : `${serverUrl}/api`

    const poll = async () => {
      if (!isActive) return
      try {
        const res = await fetch(`${baseURL}/public-price?asset_id=${encodeURIComponent(selectedAsset)}`)
        if (!res.ok || !isActive) return
        const data = await res.json()
        const price = Number(data?.price)
        if (!Number.isFinite(price) || !isActive) return

        const now = Date.now()
        setCurrentPrice(price)
        pendingPricesRef.current.push({ time: now, price })
        if (!flushTimeoutRef.current) {
          flushTimeoutRef.current = setTimeout(() => {
            flushTimeoutRef.current = null
            flushPrices()
          }, 100)
        }
      } catch {
        // ignore fetch errors
      }
    }

    poll()
    const pollId = setInterval(poll, 2000)

    return () => {
      isActive = false
      clearInterval(pollId)
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
      flushPrices()
    }
  }, [selectedAsset, flushPrices])

  return { prices, currentPrice }
}
