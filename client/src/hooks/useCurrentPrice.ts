import { useState, useEffect, useRef, useCallback } from 'react'

export function useCurrentPrice(assetId: string) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)

  const pendingRef = useRef<number | null>(null)
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (pendingRef.current !== null) {
      setCurrentPrice(pendingRef.current)
      pendingRef.current = null
    }
    flushTimeoutRef.current = null
  }, [])

  useEffect(() => {
    setCurrentPrice(null)
  }, [assetId])

  useEffect(() => {
    if (!assetId) return

    let isActive = true
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080'
    const baseURL = serverUrl.endsWith('/api') ? serverUrl : `${serverUrl}/api`

    const poll = async () => {
      if (!isActive) return
      try {
        const res = await fetch(`${baseURL}/public-price?asset_id=${encodeURIComponent(assetId)}`)
        if (!res.ok || !isActive) return
        const data = await res.json()
        const price = Number(data?.price)
        if (!Number.isFinite(price) || !isActive) return
        pendingRef.current = price
        if (!flushTimeoutRef.current) {
          flushTimeoutRef.current = setTimeout(flush, 100)
        }
      } catch {
        // ignore
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
    }
  }, [assetId, flush])

  return currentPrice
}
