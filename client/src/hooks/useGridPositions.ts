import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { api } from '../services/apiService'
import type { Grid, Cell, Position } from '../types/grid'
import { normalizeSlotKey, getWindowEndMs } from '../lib/gridSlots'
import { useAuth } from '../contexts/AuthContext'
import { betService } from '../services/betService'
import type { Pool } from '../services/betService'

const GET_USER_STAKE_ABI = [
    {
        type: 'function',
        name: 'getUserStake',
        stateMutability: 'view',
        inputs: [
            {
                name: 'key',
                type: 'tuple',
                components: [
                    { name: 'currency0', type: 'address' },
                    { name: 'currency1', type: 'address' },
                    { name: 'fee', type: 'uint24' },
                    { name: 'tickSpacing', type: 'int24' },
                    { name: 'hooks', type: 'address' },
                ],
            },
            { name: 'windowId', type: 'uint256' },
            { name: 'cellId', type: 'uint256' },
            { name: 'user', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
] as const

const GET_WINDOW_ABI = [
    {
        type: 'function',
        name: 'getWindow',
        stateMutability: 'view',
        inputs: [
            {
                name: 'poolKey',
                type: 'tuple',
                components: [
                    { name: 'currency0', type: 'address' },
                    { name: 'currency1', type: 'address' },
                    { name: 'fee', type: 'uint24' },
                    { name: 'tickSpacing', type: 'int24' },
                    { name: 'hooks', type: 'address' },
                ],
            },
            { name: 'windowId', type: 'uint256' },
        ],
        outputs: [
            { name: 'totalPool', type: 'uint256' },
            { name: 'settled', type: 'bool' },
            { name: 'voided', type: 'bool' },
            { name: 'winningCell', type: 'uint256' },
            { name: 'redemptionRate', type: 'uint256' },
        ],
    },
] as const

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
    const [activePool, setActivePool] = useState<Pool | null>(null)
    const { authenticated, walletAddress } = useAuth()

    const cellsRef = useRef<Cell[]>(cells)
    cellsRef.current = cells

    const touchedCellsRef = useRef<Set<string>>(new Set())

    // Reset on grid/auth change
    useEffect(() => {
        setBetResults({})
        setSelectedCells([])
        touchedCellsRef.current = new Set()
    }, [grid, authenticated])

    // Load pool config for real mode
    useEffect(() => {
        if (isPracticeMode) return
        betService.getPools()
            .then(pools => {
                const pool = pools.find(p => p.assetId === selectedAsset)
                if (pool) setActivePool(pool)
            })
            .catch(() => {})
    }, [selectedAsset, isPracticeMode])

    // ── Practice mode: API-backed positions ──────────────────────────────────
    useEffect(() => {
        if (!isPracticeMode) return
        let isMounted = true

        const load = async () => {
            if (!grid || !authenticated) return
            try {
                const response = await api.getPositions(true)
                if (!isMounted) return
                const data: Position[] = response.data

                const activeStake = data
                    .filter(p => p.state === 'ACTIVE' || p.state === 'PENDING')
                    .reduce((sum, p) => sum + p.stake, 0)
                setTotalActiveStake(activeStake)
                setPositions(data)

                const results: Record<string, 'won' | 'lost' | 'pending' | 'winning'> = {}
                const placedCellIds: string[] = []
                const currentCells = cellsRef.current

                data.forEach(p => {
                    const slotKey = normalizeSlotKey(p.cell_id, currentCells)
                    placedCellIds.push(slotKey)
                    const cell = currentCells.find(c => c.cell_id === p.cell_id)
                    if (cell?.result) {
                        results[slotKey] = cell.result === 'WIN' ? 'won' : 'lost'
                    } else if (p.result) {
                        results[slotKey] = p.result === 'WIN' ? 'won' : 'lost'
                    } else if (p.state === 'RESOLVED') {
                        results[slotKey] = p.payout && p.payout > 0 ? 'won' : 'lost'
                    } else {
                        results[slotKey] = 'pending'
                    }
                })

                setBetResults(results)
                setSelectedCells(prev => {
                    const placed = new Set(placedCellIds)
                    const kept = prev.filter(id => placed.has(id) || id.startsWith('future_'))
                    placedCellIds.forEach(id => { if (!kept.includes(id)) kept.push(id) })
                    return Array.from(new Set(kept))
                })
            } catch {
                // ignore
            }
        }

        load()

        let debounce: ReturnType<typeof setTimeout> | null = null
        const debouncedLoad = () => {
            if (debounce) clearTimeout(debounce)
            debounce = setTimeout(() => { if (isMounted) load() }, 100)
        }

        window.addEventListener('cells_refreshed', debouncedLoad)
        window.addEventListener('cell_resolved', debouncedLoad)
        window.addEventListener('position_updated', debouncedLoad)

        return () => {
            isMounted = false
            if (debounce) clearTimeout(debounce)
            window.removeEventListener('cells_refreshed', debouncedLoad)
            window.removeEventListener('cell_resolved', debouncedLoad)
            window.removeEventListener('position_updated', debouncedLoad)
        }
    }, [selectedAsset, grid, authenticated, isPracticeMode])

    // ── Real mode: getUserStake multicall for all visible cells ───────────────
    const poolKey = useMemo(() => {
        if (!activePool) return null
        return {
            currency0: activePool.poolKey.currency0 as `0x${string}`,
            currency1: activePool.poolKey.currency1 as `0x${string}`,
            fee: activePool.poolKey.fee,
            tickSpacing: activePool.poolKey.tickSpacing,
            hooks: activePool.poolKey.hooks as `0x${string}`,
        }
    }, [activePool])

    // Keep cells and contracts in the same order so rawStakeData[i] → stakeQueryCells[i]
    const { getUserStakeContracts, stakeQueryCells } = useMemo(() => {
        if (isPracticeMode || !activePool || !poolKey || !walletAddress || cells.length === 0) {
            return { getUserStakeContracts: [], stakeQueryCells: [] }
        }
        const contracts: {
            address: `0x${string}`
            abi: typeof GET_USER_STAKE_ABI
            functionName: 'getUserStake'
            args: readonly [typeof poolKey, bigint, bigint, `0x${string}`]
        }[] = []
        const validCells: Cell[] = []
        for (const cell of cells) {
            const parts = cell.cell_id.split('_')
            if (parts.length !== 2) continue
            const windowId = parseInt(parts[0], 10)
            const cellId = parseInt(parts[1], 10)
            if (isNaN(windowId) || isNaN(cellId)) continue
            contracts.push({
                address: activePool.poolKey.hooks as `0x${string}`,
                abi: GET_USER_STAKE_ABI,
                functionName: 'getUserStake' as const,
                args: [poolKey, BigInt(windowId), BigInt(cellId), walletAddress as `0x${string}`] as const,
            })
            validCells.push(cell)
        }
        return { getUserStakeContracts: contracts, stakeQueryCells: validCells }
    }, [isPracticeMode, activePool, poolKey, walletAddress, cells])

    const { data: rawStakeData } = useReadContracts({
        contracts: getUserStakeContracts,
        query: {
            enabled: getUserStakeContracts.length > 0,
            refetchInterval: 10_000,
        },
    })

    // Derive positions from on-chain stake data
    useEffect(() => {
        if (isPracticeMode || !rawStakeData || !walletAddress || cells.length === 0) return

        const newPositions: Position[] = []
        const placedCellIds: string[] = []

        rawStakeData.forEach((result, idx) => {
            if (result.status !== 'success') return
            const stake = result.result as bigint
            if (!stake || stake === 0n) return

            const cell = stakeQueryCells[idx]
            if (!cell) return

            const slotKey = normalizeSlotKey(cell.cell_id, cells)
            placedCellIds.push(slotKey)

            newPositions.push({
                position_id: `onchain-${cell.cell_id}`,
                user_id: walletAddress,
                asset_id: selectedAsset,
                cell_id: cell.cell_id,
                stake: Number(stake) / 1_000_000,
                state: 'ACTIVE',
                is_practice: false,
            } as Position)
        })

        setPositions(newPositions)
        setTotalActiveStake(newPositions.reduce((sum, p) => sum + p.stake, 0))

        // Set pending for cells not yet resolved
        setBetResults(prev => {
            const next = { ...prev }
            placedCellIds.forEach(id => {
                if (!next[id]) next[id] = 'pending'
            })
            return next
        })

        setSelectedCells(prev => {
            const placed = new Set(placedCellIds)
            const kept = prev.filter(id => placed.has(id) || id.startsWith('future_'))
            placedCellIds.forEach(id => { if (!kept.includes(id)) kept.push(id) })
            return Array.from(new Set(kept))
        })
    }, [rawStakeData, isPracticeMode, walletAddress, stakeQueryCells, selectedAsset])

    // ── Time-based winning state ──────────────────────────────────────────────
    useEffect(() => {
        if (!grid || selectedCells.length === 0) return
        const interval = setInterval(() => {
            const now = Date.now()
            const updates: Record<string, 'won' | 'lost' | 'pending' | 'winning'> = {}

            selectedCells.forEach(cellId => {
                const currentStatus = betResults[cellId]
                if (currentStatus === 'won' || currentStatus === 'lost') return

                const canonicalCellId = normalizeSlotKey(cellId, cells)
                const cell = cells.find(c =>
                    normalizeSlotKey(c.cell_id, cells) === canonicalCellId || c.cell_id === cellId
                )
                if (!cell) return

                const tStart = new Date(cell.t_start).getTime()
                const tEnd = new Date(cell.t_end).getTime()

                if (now < tStart) return

                let newStatus: 'won' | 'lost' | 'pending' | 'winning' | null = null

                if (now >= tStart && now <= tEnd) {
                    if (currentPrice !== null && currentPrice >= cell.p_low && currentPrice <= cell.p_high) {
                        touchedCellsRef.current.add(canonicalCellId)
                        newStatus = 'winning'
                    } else if (touchedCellsRef.current.has(canonicalCellId)) {
                        newStatus = 'winning'
                    } else {
                        newStatus = 'pending'
                    }
                }

                if (now > tEnd) {
                    newStatus = touchedCellsRef.current.has(canonicalCellId) ? 'won' : 'lost'
                }

                if (newStatus !== null && newStatus !== currentStatus) {
                    updates[canonicalCellId] = newStatus
                }
            })

            if (Object.keys(updates).length > 0) {
                setBetResults(prev => ({ ...prev, ...updates }))
            }
        }, 500)
        return () => clearInterval(interval)
    }, [selectedCells, cells, grid, currentPrice, betResults])

    // ── On-chain settlement via getWindow multicall ───────────────────────────
    const windowIdsToCheck = useMemo(() => {
        if (!activePool || !grid || isPracticeMode || positions.length === 0) return []
        const now = Date.now()
        const seen = new Set<number>()
        const result: number[] = []
        for (const p of positions) {
            const idx = p.cell_id.indexOf('_')
            if (idx < 0) continue
            const windowId = parseInt(p.cell_id.slice(0, idx))
            if (isNaN(windowId)) continue
            const windowEndMs = getWindowEndMs(windowId, activePool, grid)
            if (now > windowEndMs && !seen.has(windowId)) {
                seen.add(windowId)
                result.push(windowId)
            }
        }
        return result
    }, [positions, activePool, grid, isPracticeMode])

    const getWindowContracts = useMemo(() => {
        if (!activePool || !poolKey || windowIdsToCheck.length === 0) return []
        return windowIdsToCheck.map(windowId => ({
            address: activePool.poolKey.hooks as `0x${string}`,
            abi: GET_WINDOW_ABI,
            functionName: 'getWindow' as const,
            args: [poolKey, BigInt(windowId)] as const,
        }))
    }, [activePool, poolKey, windowIdsToCheck])

    type WindowResult = { status: 'success' | 'failure'; result?: unknown }
    const { data: rawWindowData } = useReadContracts({
        contracts: getWindowContracts,
        query: {
            enabled: getWindowContracts.length > 0,
            refetchInterval: 5_000,
        },
    })
    const windowData = rawWindowData as ReadonlyArray<WindowResult> | undefined

    useEffect(() => {
        if (!windowData || windowIdsToCheck.length === 0 || positions.length === 0) return

        const betUpdates: Record<string, 'won' | 'lost'> = {}
        let positionsChanged = false
        const updatedPositions = positions.map(p => ({ ...p }))

        windowData.forEach((wr, idx) => {
            if (wr.status !== 'success' || wr.result == null) return
            const r = wr.result as { settled: boolean; voided: boolean; winningCell: bigint; redemptionRate: bigint }
            if (!r.settled && !r.voided) return

            const windowId = windowIdsToCheck[idx]
            for (const pos of updatedPositions) {
                const underscoreIdx = pos.cell_id.indexOf('_')
                if (underscoreIdx < 0) continue
                if (parseInt(pos.cell_id.slice(0, underscoreIdx)) !== windowId) continue

                const userCellId = parseInt(pos.cell_id.slice(underscoreIdx + 1))
                const slotKey = normalizeSlotKey(pos.cell_id, cellsRef.current)
                const won = r.settled && !r.voided && Number(r.winningCell) === userCellId

                betUpdates[slotKey] = won ? 'won' : 'lost'

                if (pos.state !== 'RESOLVED') {
                    pos.state = 'RESOLVED'
                    pos.result = won ? 'WIN' : 'LOSS'
                    pos.payout = won
                        ? Math.round(pos.stake * Number(r.redemptionRate) / 1e18 * 100) / 100
                        : 0
                    positionsChanged = true
                }
            }
        })

        if (Object.keys(betUpdates).length > 0) {
            setBetResults(prev => ({ ...prev, ...betUpdates }))
        }
        if (positionsChanged) {
            setPositions(updatedPositions)
        }
    }, [windowData, windowIdsToCheck, positions])

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
            if (prev.includes(newId)) return prev.filter(id => id !== oldId)
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
