import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function useCurrentPrice(assetId: string) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const { authenticated } = useAuth()
  const isRestOnlyMode = import.meta.env.VITE_REST_ONLY === 'true'

  useEffect(() => {
    setCurrentPrice(null)
  }, [assetId, authenticated])

  useEffect(() => {
    if (!authenticated || !assetId || !isRestOnlyMode) return

    let timer: ReturnType<typeof setInterval> | null = null
    let isActive = true

    const poll = async () => {
      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080'
        const baseURL = serverUrl.endsWith('/api') ? serverUrl : `${serverUrl}/api`
        const res = await fetch(`${baseURL}/public-price?asset_id=${encodeURIComponent(assetId)}`)
        if (!res.ok) return
        const data = await res.json()
        const price = Number(data?.price)
        if (!isActive || !Number.isFinite(price)) return
        setCurrentPrice(price)
      } catch {
        // no-op: temporary network issues
      }
    }

    poll()
    timer = setInterval(poll, 2000)

    return () => {
      isActive = false
      if (timer) clearInterval(timer)
    }
  }, [assetId, authenticated, isRestOnlyMode])

  useEffect(() => {
    if (!authenticated || !assetId || isRestOnlyMode) return

    let ws: WebSocket | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let isActive = true

    const connect = () => {
      if (!isActive) return
      const wsBase = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
      ws = new WebSocket(`${wsBase}/api/ws`)
      ws.onmessage = (event) => {
        if (!isActive) return
        try {
          const msg = JSON.parse(event.data)
          if (msg.asset_id === assetId && typeof msg.price === 'number') {
            setCurrentPrice(msg.price)
          }
        } catch {
          // Ignore parse errors
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
    }
  }, [assetId, authenticated, isRestOnlyMode])

  return currentPrice
}
