import { useEffect, useRef, useState, useCallback } from 'react'

interface StakeUpdateMessage {
    type: 'stake_update'
    data: {
        cell_id: string
        total_stake: number
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

type GridUpdateMessage = StakeUpdateMessage | CellResolvedMessage

export const useGridSocket = () => {
    const [cellStakes, setCellStakes] = useState<Record<string, number>>({})
    const socketRef = useRef<WebSocket | null>(null)
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
    const isUnmountedRef = useRef(false)
    const pendingStakesRef = useRef<Record<string, number>>({})
    const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const flushUpdates = useCallback(() => {
        const pendingStakes = pendingStakesRef.current
        if (Object.keys(pendingStakes).length > 0) {
            pendingStakesRef.current = {}
            setCellStakes(prev => ({ ...prev, ...pendingStakes }))
        }
    }, [])

    const cleanupSocket = useCallback((socket: WebSocket | null) => {
        if (socket) {
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
            if (isUnmountedRef.current) return

            const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
            const socket = new WebSocket(`${wsUrl}/api/grid/ws`)

            socket.onmessage = (event) => {
                try {
                    const message: GridUpdateMessage = JSON.parse(event.data)

                    if (message.type === 'stake_update') {
                        pendingStakesRef.current[message.data.cell_id] = message.data.total_stake
                    }

                    if (message.type === 'cell_resolved') {
                        window.dispatchEvent(new CustomEvent('cell_resolved', { detail: message.data }))
                    }

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
                cleanupSocket(socketRef.current)
                socketRef.current = null
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
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
            if (flushTimeoutRef.current) {
                clearTimeout(flushTimeoutRef.current)
                flushTimeoutRef.current = null
            }
            flushUpdates()
        }
    }, [cleanupSocket, flushUpdates])

    return { cellStakes }
}
