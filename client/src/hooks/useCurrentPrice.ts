import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function useCurrentPrice(assetId: string) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const { authenticated } = useAuth()

  useEffect(() => {
    setCurrentPrice(null)
  }, [assetId, authenticated])

  useEffect(() => {
    if (!authenticated || !assetId) return

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
  }, [assetId, authenticated])

  return currentPrice
}
