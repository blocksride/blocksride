import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { api } from '../services/apiService'
import type { Grid, Cell, Position } from '../types/grid'
import { normalizeSlotKey, getWindowEndMs } from '../lib/gridSlots'
import { useAuth } from '../contexts/AuthContext'
import { betService } from '../services/betService'
import type { Pool } from '../services/betService'

// userWindowStake(bytes32 poolId, uint256 windowId, address user) → uint256
// Auto-generated getter for the public mapping
const USER_WINDOW_STAKE_ABI = [
    {
        type: 'function',
        name: 'userWindowStake',
        stateMutability: 'view',
        inputs: [
            { name: 'poolId', type: 'bytes32' },
            { name: 'windowId', type: 'uint256' },
            { name: 'user', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
] as const

// getUserStakes(PoolKey, windowId, user, cellIds[]) → uint256[]
const GET_USER_STAKES_ABI = [
    {
        type: 'function',
        name: 'getUserStakes',
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
            { name: 'user', type: 'address' },
            { name: 'cellIds', type: 'uint256[]' },
        ],
        outputs: [{ name: 'stakes', type: 'uint256[]' }],
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

// Price bands to scan per window when looking for user cells.
// ETH at $2/band: covers $1,000 → $6,000 price range.
const CELL_SCAN_MIN = 500
const CELL_SCAN_MAX = 3000
const CELL_SCAN_IDS = Array.from(
    { length: CELL_SCAN_MAX - CELL_SCAN_MIN + 1 },
    (_, i) => BigInt(CELL_SCAN_MIN + i),
)

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

    // Load pool config (needed for contract calls)
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

    // ── Real mode: Step 1 — scan past windows for user stake ─────────────────
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

    // Window IDs to scan: last 200 windows + current + next 5
    const scanWindowIds = useMemo(() => {
        if (isPracticeMode || !activePool || !walletAddress) return []
        const nowSec = Math.floor(Date.now() / 1000)
        const currentWindowId = Math.floor(nowSec / activePool.windowDurationSec)
        const ids: number[] = []
        for (let i = -200; i <= 5; i++) {
            const wid = currentWindowId + i
            if (wid > 0) ids.push(wid)
        }
        return ids
    }, [isPracticeMode, activePool, walletAddress])

    const userWindowStakeContracts = useMemo(() => {
        if (!activePool || !walletAddress || scanWindowIds.length === 0) return []
        return scanWindowIds.map(windowId => ({
            address: activePool.poolKey.hooks as `0x${string}`,
            abi: USER_WINDOW_STAKE_ABI,
            functionName: 'userWindowStake' as const,
            args: [
                activePool.poolId as `0x${string}`,
                BigInt(windowId),
                walletAddress as `0x${string}`,
            ] as const,
        }))
    }, [activePool, walletAddress, scanWindowIds])

    const { data: windowStakeData } = useReadContracts({
        contracts: userWindowStakeContracts,
        query: {
            enabled: userWindowStakeContracts.length > 0,
            refetchInterval: 15_000,
        },
    })

    // Windows where user has stake > 0
    const bettedWindowIds = useMemo(() => {
        if (!windowStakeData) return []
        return scanWindowIds.filter((_, idx) => {
            const r = windowStakeData[idx]
            return r?.status === 'success' && (r.result as bigint) > 0n
        })
    }, [windowStakeData, scanWindowIds])

    // ── Real mode: Step 2 — find cells within each betted window ─────────────
    const getUserStakesContracts = useMemo(() => {
        if (!activePool || !poolKey || !walletAddress || bettedWindowIds.length === 0) return []
        return bettedWindowIds.map(windowId => ({
            address: activePool.poolKey.hooks as `0x${string}`,
            abi: GET_USER_STAKES_ABI,
            functionName: 'getUserStakes' as const,
            args: [
                poolKey,
                BigInt(windowId),
                walletAddress as `0x${string}`,
                CELL_SCAN_IDS,
            ] as const,
        }))
    }, [activePool, poolKey, walletAddress, bettedWindowIds])

    const { data: userStakesData } = useReadContracts({
        contracts: getUserStakesContracts,
        query: {
            enabled: getUserStakesContracts.length > 0,
            refetchInterval: 10_000,
        },
    })

    // Derive positions from on-chain stake data
    useEffect(() => {
        if (isPracticeMode || !userStakesData || !walletAddress || !activePool) return

        const newPositions: Position[] = []
        const placedCellIds: string[] = []
        const priceInterval = grid?.price_interval ?? 2

        userStakesData.forEach((result, windowIdx) => {
            if (result.status !== 'success' || !result.result) return
            const stakes = result.result as bigint[]
            const windowId = bettedWindowIds[windowIdx]
            if (windowId === undefined) return

            stakes.forEach((stake, cellIdx) => {
                if (!stake || stake === 0n) return

                const cellIdNum = CELL_SCAN_MIN + cellIdx
                const cellKey = `${windowId}_${cellIdNum}`

                // Check if there's a matching synthetic cell (for time/price info)
                const matchingCell = cellsRef.current.find(c => c.cell_id === cellKey)
                const tStartSec = windowId * activePool.windowDurationSec
                const tEndSec = tStartSec + activePool.windowDurationSec
                const pLow = cellIdNum * priceInterval
                const pHigh = pLow + priceInterval

                // Use synthetic cell data if available, else compute from on-chain facts
                void matchingCell

                placedCellIds.push(cellKey)
                newPositions.push({
                    position_id: `onchain-${cellKey}`,
                    user_id: walletAddress,
                    asset_id: selectedAsset,
                    cell_id: cellKey,
                    stake: Number(stake) / 1_000_000,
                    state: 'ACTIVE',
                    is_practice: false,
                } as Position)

                // Inject a synthetic cell entry if missing so time-based logic works
                if (!matchingCell) {
                    const syntheticCell: Cell = {
                        cell_id: cellKey,
                        grid_id: grid?.grid_id ?? `${selectedAsset}-live`,
                        p_low: pLow,
                        p_high: pHigh,
                        t_start: new Date(tStartSec * 1000).toISOString(),
                        t_end: new Date(tEndSec * 1000).toISOString(),
                    }
                    cellsRef.current = [...cellsRef.current.filter(c => c.cell_id !== cellKey), syntheticCell]
                }
            })
        })

        setPositions(newPositions)
        setTotalActiveStake(newPositions.reduce((sum, p) => sum + p.stake, 0))

        // Only set pending for cells not yet resolved
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
    }, [userStakesData, isPracticeMode, walletAddress, activePool, bettedWindowIds, selectedAsset, grid])

    // ── Time-based winning state ──────────────────────────────────────────────
    useEffect(() => {
        if (!grid || selectedCells.length === 0) return
        const interval = setInterval(() => {
            const now = Date.now()
            const updates: Record<string, 'won' | 'lost' | 'pending' | 'winning'> = {}
            const currentCells = cellsRef.current

            selectedCells.forEach(cellId => {
                const currentStatus = betResults[cellId]
                if (currentStatus === 'won' || currentStatus === 'lost') return

                const canonicalCellId = normalizeSlotKey(cellId, currentCells)
                const cell = currentCells.find(c =>
                    normalizeSlotKey(c.cell_id, currentCells) === canonicalCellId || c.cell_id === cellId
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
    }, [selectedCells, grid, currentPrice, betResults])

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
