import { useEffect, useRef, useState, useCallback } from 'react'
import type { CellPrice } from '../types/grid'

interface StakeUpdateMessage {
    type: 'stake_update'
    data: {
        cell_id: string
        total_stake: number
    }
}

interface CellPricesMessage {
    type: 'cell_prices'
    data: {
        grid_id: string
        prices: CellPrice[]
    }
}

interface CellResolvedMessage {
    type: 'cell_resolved'
    data: {
        cell_id: string
        result: string
        min_price: number
        max_price: number
    }
}

type GridUpdateMessage = StakeUpdateMessage | CellPricesMessage | CellResolvedMessage

export interface CellPricesMap {
    [cellId: string]: CellPrice
}

export const useGridSocket = () => {
    const [cellStakes, setCellStakes] = useState<Record<string, number>>({})
    const [cellPrices, setCellPrices] = useState<CellPricesMap>({})
    const socketRef = useRef<WebSocket | null>(null)
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
    const isUnmountedRef = useRef(false)

    // Batch stake updates to reduce re-renders
    const pendingStakesRef = useRef<Record<string, number>>({})
    const pendingPricesRef = useRef<CellPricesMap>({})
    const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const flushUpdates = useCallback(() => {
        const pendingStakes = pendingStakesRef.current
        const pendingPrices = pendingPricesRef.current

        if (Object.keys(pendingStakes).length > 0) {
            pendingStakesRef.current = {}
            setCellStakes(prev => ({ ...prev, ...pendingStakes }))
        }

        if (Object.keys(pendingPrices).length > 0) {
            pendingPricesRef.current = {}
            setCellPrices(prev => ({ ...prev, ...pendingPrices }))
        }
    }, [])

    const cleanupSocket = useCallback((socket: WebSocket | null) => {
        if (socket) {
            // Remove all handlers before closing to prevent memory leaks
            socket.onopen = null
            socket.onmessage = null
            socket.onclose = null
            socket.onerror = null
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.close()
            }
        }
    }, [])

    useEffect(() => {
        isUnmountedRef.current = false

        const connect = () => {
            // Don't reconnect if component is unmounted
            if (isUnmountedRef.current) return

            const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
            const socket = new WebSocket(`${wsUrl}/api/grid/ws`)

            socket.onopen = () => {
                // Connected to Grid WebSocket
            }

            socket.onmessage = (event) => {
                try {
                    const message: GridUpdateMessage = JSON.parse(event.data)

                    if (message.type === 'stake_update') {
                        // Batch stake updates instead of updating state immediately
                        pendingStakesRef.current[message.data.cell_id] = message.data.total_stake
                    }

                    if (message.type === 'cell_prices') {
                        // Batch cell price updates
                        for (const price of message.data.prices) {
                            pendingPricesRef.current[price.cell_id] = price
                        }
                    }

                    if (message.type === 'cell_resolved') {
                        window.dispatchEvent(new CustomEvent('cell_resolved', { detail: message.data }))
                    }

                    // Flush every 500ms to batch multiple updates
                    if (!flushTimeoutRef.current) {
                        flushTimeoutRef.current = setTimeout(() => {
                            flushTimeoutRef.current = null
                            flushUpdates()
                        }, 500)
                    }
                } catch {
                    // Ignore malformed messages
                }
            }

            socket.onclose = () => {
                // Clean up old socket
                cleanupSocket(socketRef.current)
                socketRef.current = null

                // Only reconnect if not unmounted
                if (!isUnmountedRef.current) {
                    reconnectTimeoutRef.current = setTimeout(connect, 3000)
                }
            }

            socket.onerror = () => {
                socket.close()
            }

            socketRef.current = socket
        }

        connect()

        return () => {
            isUnmountedRef.current = true
            cleanupSocket(socketRef.current)
            socketRef.current = null
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current)
            }
            if (flushTimeoutRef.current) {
                clearTimeout(flushTimeoutRef.current)
                flushTimeoutRef.current = null
            }
            // Flush any remaining updates
            flushUpdates()
        }
    }, [cleanupSocket, flushUpdates])

    return { cellStakes, cellPrices }
}
