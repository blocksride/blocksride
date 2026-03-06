import { useState, useEffect, useRef, useCallback } from 'react'
import { createPublicClient, http, parseAbiItem } from 'viem'
import { api } from '../services/apiService'
import type { Grid, Cell, Position } from '../types/grid'
import { useAuth } from '../contexts/AuthContext'
import { betService } from '../services/betService'
import { activeChain } from '@/providers/Web3Provider'

const BET_PLACED_EVENT = parseAbiItem(
    'event BetPlaced(bytes32 indexed poolId, uint256 indexed windowId, uint256 indexed cellId, address user, uint256 amount)',
)

const estimateFromBlock = (latestBlock: bigint, grid: Grid | null) => {
    if (!grid) {
        return latestBlock > 120_000n ? latestBlock - 120_000n : 0n
    }

    const gridStartSec = Math.floor(new Date(grid.start_time).getTime() / 1000)
    const nowSec = Math.floor(Date.now() / 1000)
    const ageSec = Math.max(0, nowSec - gridStartSec)
    const approxBlocks = BigInt(Math.ceil(ageSec / 2) + 5_000) // Base blocks ~2s + safety
    return latestBlock > approxBlocks ? latestBlock - approxBlocks : 0n
}

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
    const { authenticated, walletAddress } = useAuth()

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

                let data: Position[] = []
                if (isPracticeMode) {
                    // Practice mode remains API-backed.
                    const response = await api.getPositions(true)
                    data = response.data
                } else {
                    // Real mode: read user bets directly from on-chain logs in browser.
                    if (!walletAddress) return

                    const pools = await betService.getPools()
                    const pool = pools.find(p => p.assetId === selectedAsset)
                    if (!pool) return

                    const publicClient = createPublicClient({
                        chain: activeChain,
                        transport: http(),
                    })

                    const latestBlock = await publicClient.getBlockNumber()
                    const fromBlock = estimateFromBlock(latestBlock, grid)

                    const logs = await publicClient.getLogs({
                        address: pool.poolKey.hooks as `0x${string}`,
                        event: BET_PLACED_EVENT,
                        args: {
                            poolId: pool.poolId as `0x${string}`,
                        },
                        fromBlock,
                        toBlock: latestBlock,
                    })

                    data = logs
                        .filter((log) => (log.args.user || '').toLowerCase() === walletAddress.toLowerCase())
                        .map((log) => {
                            const windowId = Number(log.args.windowId ?? 0n)
                            const cellId = Number(log.args.cellId ?? 0n)
                            const amount = Number(log.args.amount ?? 0n) / 1_000_000
                            const slotId = `${windowId}_${cellId}`

                            return {
                                position_id: `${log.transactionHash}-${log.logIndex}`,
                                user_id: walletAddress,
                                asset_id: selectedAsset,
                                cell_id: slotId,
                                stake: amount,
                                state: 'ACTIVE',
                                is_practice: false,
                            } as Position
                        })
                }

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
    }, [selectedAsset, grid, authenticated, isPracticeMode, walletAddress])  // Removed cells.length - we listen to cells_refreshed instead

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
