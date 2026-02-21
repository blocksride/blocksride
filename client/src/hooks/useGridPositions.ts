import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../services/apiService'
import type { Grid, Cell, Position } from '../types/grid'
import { useAuth } from '../contexts/AuthContext'

export function useGridPositions(
    selectedAsset: string,
    grid: Grid | null,
    cells: Cell[],
    currentPrice: number | null,
    isPracticeMode?: boolean
) {
    const [positions, setPositions] = useState<Position[]>([])
    const [betResults, setBetResults] = useState<
        Record<string, 'won' | 'lost' | 'pending' | 'winning'>
    >({})
    const [selectedCells, setSelectedCells] = useState<string[]>([])
    const [totalActiveStake, setTotalActiveStake] = useState(0)
    const { authenticated } = useAuth()

    // Use ref to always have latest cells without triggering dependency
    const cellsRef = useRef<Cell[]>(cells)
    cellsRef.current = cells

    // Track cells that have been touched by price (sticky winning state)
    const touchedCellsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        setBetResults({})
        setSelectedCells([])
        touchedCellsRef.current = new Set() // Reset touched cells on grid change
    }, [grid, authenticated])

    useEffect(() => {
        let isMounted = true

        const loadPositions = async () => {
            try {
                if (!grid || !authenticated) return

                const currentCells = cellsRef.current

                // Fetch user's positions (for tracking their own bets)
                // Filter by practice mode to show only relevant positions
                const { data } = await api.getPositions(isPracticeMode)

                // Check if still mounted before updating state
                if (!isMounted) return

                const activeStake = data
                    .filter(p => p.state === 'ACTIVE' || p.state === 'PENDING')
                    .reduce((sum, p) => sum + p.stake, 0)
                setTotalActiveStake(activeStake)

                // Show all positions - don't filter by cell IDs since new cells may not be loaded yet
                setPositions(data)

                const results: Record<string, 'won' | 'lost' | 'pending' | 'winning'> = {}
                const placedCellIds: string[] = []

                data.forEach((p) => {
                    placedCellIds.push(p.cell_id)

                    const cell = currentCells.find(c => c.cell_id === p.cell_id)

                    if (cell && cell.result) {

                        results[p.cell_id] = cell.result === 'WIN' ? 'won' : 'lost'
                    } else if (p.result) {

                        results[p.cell_id] = p.result === 'WIN' ? 'won' : 'lost'
                    } else if (p.state === 'RESOLVED') {



                        if (p.payout && p.payout > 0) {
                            results[p.cell_id] = 'won'
                        } else {
                            results[p.cell_id] = 'lost'
                        }
                    } else {
                        results[p.cell_id] = 'pending'
                    }
                })

                setBetResults(results)
                setSelectedCells((prev) => {
                    const currentPlaced = new Set(placedCellIds)

                    // Keep optimistic cells that might not be in positions yet (race condition)
                    // or virtual IDs that haven't been updated to real IDs yet
                    const keptOptimistic = prev.filter((id) => {
                        // Keep if it's in the loaded positions
                        if (currentPlaced.has(id)) {
                            return true
                        }

                        // Keep virtual IDs temporarily - they'll be cleaned up by updateCellId
                        if (id.startsWith('future_')) {
                            return true
                        }

                        return false
                    })

                    // Add all position cell IDs
                    placedCellIds.forEach((id) => {
                        if (!keptOptimistic.includes(id)) {
                            keptOptimistic.push(id)
                        }
                    })

                    return Array.from(new Set(keptOptimistic))
                })
            } catch {
                // Failed to load positions
            }
        }

        loadPositions()

        // Debounce position reloads to prevent multiple rapid API calls
        let debounceTimeout: ReturnType<typeof setTimeout> | null = null
        const debouncedLoadPositions = () => {
            if (debounceTimeout) {
                clearTimeout(debounceTimeout)
            }
            debounceTimeout = setTimeout(() => {
                if (isMounted) {
                    loadPositions()
                }
            }, 100) // Wait 100ms before loading to batch rapid events
        }

        // Listen for various events that require position reload
        // cells_refreshed: fired after cells are refreshed when position is placed
        // cell_resolved: fired when a cell's result is determined
        // position_updated: fired immediately after bet is placed (before cells refresh)
        window.addEventListener('cells_refreshed', debouncedLoadPositions)
        window.addEventListener('cell_resolved', debouncedLoadPositions)
        window.addEventListener('position_updated', debouncedLoadPositions)

        return () => {
            isMounted = false
            if (debounceTimeout) {
                clearTimeout(debounceTimeout)
            }
            window.removeEventListener('cells_refreshed', debouncedLoadPositions)
            window.removeEventListener('cell_resolved', debouncedLoadPositions)
            window.removeEventListener('position_updated', debouncedLoadPositions)
        }
    }, [selectedAsset, grid, authenticated, isPracticeMode])  // Removed cells.length - we listen to cells_refreshed instead

    useEffect(() => {
        if (!grid || selectedCells.length === 0) return
        const interval = setInterval(() => {
            const now = Date.now()
            const updates: Record<string, 'won' | 'lost' | 'pending' | 'winning'> = {}

            selectedCells.forEach((cellId) => {
                // Skip already resolved cells (from backend)
                const currentStatus = betResults[cellId]
                if (currentStatus === 'won' || currentStatus === 'lost')
                    return

                const cell = cells.find((c) => c.cell_id === cellId)
                if (!cell) return

                const tStart = new Date(cell.t_start).getTime()
                const tEnd = new Date(cell.t_end).getTime()

                // Before window starts - keep as pending
                if (now < tStart) return

                let newStatus: 'won' | 'lost' | 'pending' | 'winning' | null = null

                // During active window - check if price is in range
                if (now >= tStart && now <= tEnd) {
                    if (
                        currentPrice !== null &&
                        currentPrice >= cell.p_low &&
                        currentPrice <= cell.p_high
                    ) {
                        // Price touched the cell - mark as touched and winning
                        touchedCellsRef.current.add(cellId)
                        newStatus = 'winning'
                    } else if (touchedCellsRef.current.has(cellId)) {
                        // Price exited but cell was touched - STAY winning (sticky)
                        newStatus = 'winning'
                    } else {
                        // Price not in range and never touched - still pending
                        newStatus = 'pending'
                    }
                }

                // After window ends - resolve instantly based on whether cell was touched
                if (now > tEnd) {
                    if (touchedCellsRef.current.has(cellId)) {
                        newStatus = 'won'
                    } else {
                        newStatus = 'lost'
                    }
                }

                // Only add to updates if status actually changed
                if (newStatus !== null && newStatus !== currentStatus) {
                    updates[cellId] = newStatus
                }
            })

            // Only update state if there are actual changes
            if (Object.keys(updates).length > 0) {
                setBetResults((prev) => ({ ...prev, ...updates }))
            }
        }, 500)
        return () => clearInterval(interval)
    }, [selectedCells, cells, grid, currentPrice, betResults])

    const addOptimisticCell = useCallback((cellId: string) => {
        setSelectedCells(prev => {
            if (prev.includes(cellId)) return prev
            return [...prev, cellId]
        })
    }, [])

    const removeOptimisticCell = useCallback((cellId: string) => {
        setSelectedCells(prev => prev.filter(id => id !== cellId))
    }, [])

    const updateCellId = useCallback((oldId: string, newId: string) => {
        setSelectedCells(prev => {
            // If already has newId, just remove oldId
            if (prev.includes(newId)) {
                return prev.filter(id => id !== oldId)
            }
            // Replace oldId with newId
            return prev.map(id => id === oldId ? newId : id)
        })
    }, [])

    return {
        positions,
        betResults,
        selectedCells,
        setSelectedCells,
        totalActiveStake,
        addOptimisticCell,
        removeOptimisticCell,
        updateCellId,
    }
}
