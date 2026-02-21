import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../services/apiService'
import type { Grid } from '../types/grid'
import { PricePoint } from '../types/grid'
import { useAuth } from '../contexts/AuthContext'

export function useGridPrices(selectedAsset: string, grid: Grid | null) {
  const [prices, setPrices] = useState<PricePoint[]>([])
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const { authenticated } = useAuth()

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
  }, [selectedAsset, authenticated])

  useEffect(() => {
    if (!grid || !authenticated) return

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
  }, [grid, authenticated])

  useEffect(() => {
    if (!authenticated) return

    let ws: WebSocket | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let isActive = true

    const connect = () => {
      if (!isActive) return
      const wsBase = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
      ws = new WebSocket(`${wsBase}/api/ws`)
      ws.onopen = () => {
        // Connected to WebSocket
      }
      ws.onmessage = (event) => {
        if (!isActive) return
        try {
          const msg = JSON.parse(event.data)
          if (msg.asset_id === selectedAsset && typeof msg.price === 'number') {
            const price = msg.price
            const timestamp = new Date(msg.timestamp).getTime()
            setCurrentPrice(price)

            // Batch price updates instead of updating state on every message
            pendingPricesRef.current.push({ time: timestamp, price })

            // Flush every 100ms to batch multiple updates
            if (!flushTimeoutRef.current) {
              flushTimeoutRef.current = setTimeout(() => {
                flushTimeoutRef.current = null
                flushPrices()
              }, 100)
            }
          }
        } catch (error) {
          console.error('[useGridPrices] Failed to parse WebSocket message:', error)
        }
      }
      ws.onclose = () => {
        if (!isActive) return
        timeoutId = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      isActive = false
      if (ws) {
        ws.onclose = null
        ws.close()
      }
      if (timeoutId) clearTimeout(timeoutId)
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
      // Flush any remaining prices
      flushPrices()
    }
  }, [selectedAsset, authenticated, flushPrices])

  return { prices, currentPrice }
}
