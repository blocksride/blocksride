import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { GridCanvas } from './grid/GridCanvas'
import { GridSkeleton } from './grid/GridSkeleton'
import { PositionSummary } from './grid/PositionSummary'
import { BetHistory } from './grid/BetHistory'
import { TradeControls } from './grid/TradeControls'
import { ContestRequirements } from './contest/ContestRequirements'
import { UndoToast } from './grid/UndoToast'
import { Confetti, useConfetti } from '@/components/ui/confetti'
import { BetConfirmation } from '@/components/ConfirmationDialog'
import { useAuth } from '../contexts/AuthContext'
import { useContest, formatTimeRemaining } from '../contexts/ContestContext'
import { useGridState } from '../hooks/useGridState'
import { useGridPrices } from '../hooks/useGridPrices'
import { useGridPositions } from '../hooks/useGridPositions'
import { useGridViewport } from '../hooks/useGridViewport'
import { toast } from 'sonner'
import {
    Crosshair,
    Clock,
    AlertTriangle,
    PanelRightClose,
    PanelRightOpen,
    History,
    Activity,
    DollarSign,
    Check,
    X,
} from 'lucide-react'

import { useBetQuote } from '../hooks/useBetQuote'
import { usePoolMultipliers } from '../hooks/usePoolMultipliers'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useWallets } from '@privy-io/react-auth'
import { createWalletClient, custom } from 'viem'
import { activeChain, expectedChainId } from '@/providers/Web3Provider'
import { betService, type BetStatus, type Pool } from '../services/betService'
import { getCellPriceRange, getSlotKey, getWindowEndMs, getWindowStartMs, normalizeSlotKey } from '../lib/gridSlots'
import { getRuntimeNetworkConfig } from '@/lib/networkConfig'

const BET_CONFIRMATION_KEY = 'blocksride_bet_confirmation_enabled'
const SIDEBAR_COLLAPSED_KEY = 'blocksride_sidebar_collapsed'

// Decode composite "windowId_cellId" key into "$pLow – $pHigh" range string
function formatCellRange(cellId: string, priceInterval: number): string {
    const parts = cellId.split('_')
    if (parts.length === 2) {
        const bandCellId = parseInt(parts[1], 10)
        if (!isNaN(bandCellId)) {
            const pLow = bandCellId * priceInterval
            const pHigh = (bandCellId + 1) * priceInterval
            return `$${pLow.toLocaleString()} – $${pHigh.toLocaleString()}`
        }
    }
    return cellId
}

function formatTimeAgo(dateStr: string | undefined): string {
    if (!dateStr) return ''
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
}

function getWindowLabel(cellId: string, windowIndex?: number): string {
    if (windowIndex !== undefined) return `Wnd #${windowIndex}`
    const parts = cellId.split('_')
    if (parts.length === 2 && !isNaN(parseInt(parts[0], 10))) return `Wnd #${parts[0]}`
    return ''
}

interface GridVisualizerProps {
    assetId?: string
}

export const GridVisualizer: React.FC<GridVisualizerProps> = ({
    assetId: initialAssetId = 'ETH-USD',
}) => {
    const selectedAsset = initialAssetId
    const [currentStake, setCurrentStake] = useState<number>(() => {
        const stored = localStorage.getItem('blocksride_active_chip')
        const parsed = stored ? parseFloat(stored) : NaN
        return isNaN(parsed) ? 5 : parsed
    })
    const [pendingStake, setPendingStake] = useState(0)
    const [recentCells, setRecentCells] = useState<Record<string, boolean>>({})
    const recentTimersRef = useRef<Record<string, number>>({})
    const [claimsOpen, setClaimsOpen] = useState(false)
    const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set())
    const [claimingIds, setClaimingIds] = useState<Set<string>>(new Set())
    const [currentTime, setCurrentTime] = useState(new Date())

    // Sidebar collapse (desktop)
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
        return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
    })

    // Mobile right-strip sidebar
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

    // Undo toast state
    const [undoToast, setUndoToast] = useState<{
        amount: number
        priceLabel?: string
        undoFn: () => void
    } | null>(null)

    // Bet confirmation dialog state
    const [showBetConfirmation, setShowBetConfirmation] = useState(false)
    const [pendingBetCellId, setPendingBetCellId] = useState<[number, number] | null>(null)
    const [pendingBetInfo, setPendingBetInfo] = useState<{
        priceRange: string
        timeWindow: string
    } | null>(null)
    const [isBetLoading, setIsBetLoading] = useState(false)
    const [betConfirmationEnabled] = useState(() => {
        return localStorage.getItem(BET_CONFIRMATION_KEY) === 'true'
    })

    const selectedTimeframe = 60
    const { selectedContest, timeRemaining, exitToSelection } = useContest()
    const { formatted: walletBalance } = useTokenBalance()
    const [showContestEnded, setShowContestEnded] = useState(false)
    const [showRequirements, setShowRequirements] = useState(false)

    const timeBoundary = useMemo(() => {
        if (!selectedContest) return null
        return {
            start: new Date(selectedContest.start_time).getTime(),
            end: new Date(selectedContest.end_time).getTime(),
        }
    }, [selectedContest])

    const { grid, cells } = useGridState(selectedAsset, selectedTimeframe)
    const { prices, currentPrice } = useGridPrices(selectedAsset, grid)
    const {
        positions, betResults, selectedCells, totalActiveStake, extraCells,
        addOptimisticCell, removeOptimisticCell,
    } = useGridPositions(selectedAsset, grid, cells, currentPrice)

    // Merge grid cells with synthetic cells for historical windows
    const allCells = useMemo(() => {
        if (extraCells.length === 0) return cells
        const ids = new Set(cells.map(c => c.cell_id))
        return [...cells, ...extraCells.filter(c => !ids.has(c.cell_id))]
    }, [cells, extraCells])

    const { showConfetti, trigger: triggerConfetti, reset: resetConfetti } = useConfetti()

    const [quoteCellId, setQuoteCellId] = useState<string | null>(null)

    const prevBetResultsRef = useRef<Record<string, string>>({})
    const hasPlacedBetRef = useRef(false)
    const betResultsRef = useRef(betResults)
    betResultsRef.current = betResults
    const isPlacingBetRef = useRef(false)
    const placedCellsRef = useRef<Set<string>>(new Set())

    const markRecentCell = useCallback((cellId: string) => {
        setRecentCells(prev => ({ ...prev, [cellId]: true }))
        if (typeof window === 'undefined') return
        if (recentTimersRef.current[cellId]) {
            window.clearTimeout(recentTimersRef.current[cellId])
        }
        recentTimersRef.current[cellId] = window.setTimeout(() => {
            setRecentCells(prev => {
                const next = { ...prev }
                delete next[cellId]
                return next
            })
            delete recentTimersRef.current[cellId]
        }, 2500)
    }, [])

    useEffect(() => {
        return () => {
            Object.values(recentTimersRef.current).forEach((id) => {
                if (typeof window !== 'undefined') {
                    window.clearTimeout(id)
                }
            })
            recentTimersRef.current = {}
        }
    }, [])

    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
        return () => window.clearInterval(timer)
    }, [])

    // Confetti on new wins
    useEffect(() => {
        if (!hasPlacedBetRef.current) {
            prevBetResultsRef.current = { ...betResults }
            return
        }
        const prev = prevBetResultsRef.current
        const newWins = Object.entries(betResults).filter(
            ([id, s]) => s === 'won' && prev[id] !== 'won'
        )
        if (newWins.length > 0) {
            triggerConfetti()
            const payout = newWins.reduce((sum, [cellId]) => {
                const position = positions.find(p => normalizeSlotKey(p.cell_id, cells) === cellId || p.cell_id === cellId)
                return position?.payout ? sum + position.payout : sum
            }, 0)
            if (payout > 0) {
                toast.success(`You won $${payout.toFixed(2)}!`)
            } else {
                toast.success('You won!')
            }
        }
        prevBetResultsRef.current = { ...betResults }
    }, [betResults, positions, cells, triggerConfetti])

    useEffect(() => {
        if (timeRemaining === 0 && selectedContest) {
            setShowContestEnded(true)
        }
    }, [timeRemaining, selectedContest])

    const handleContestEndedExit = useCallback(() => {
        setShowContestEnded(false)
        exitToSelection()
    }, [exitToSelection])

    const containerRef = useRef<HTMLDivElement>(null)
    // Shift initial view so bettable windows (frozen+1 onwards) appear in the centre.
    // With frozenWindows=3 and 60s windows: first bettable is at +4min, offset by +3min
    // puts the bettable zone roughly centred in the 10-minute viewport.
    const frozenWindowsCount = 3
    const initialTimeOffsetMs = (frozenWindowsCount - 1) * selectedTimeframe * 1000

    const viewport = useGridViewport(
        currentPrice,
        selectedTimeframe,
        containerRef,
        true,
        grid?.price_interval || 5,
        grid?.anchor_price || null,
        timeBoundary,
        initialTimeOffsetMs
    )

    const priceLabels = useMemo(() => {
        const count = 10
        const min = viewport.visibleMinPrice
        const max = viewport.visibleMaxPrice
        if (!isFinite(min) || !isFinite(max) || max <= min) return []
        const step = (max - min) / (count - 1)
        return Array.from({ length: count }, (_, i) => max - i * step)
    }, [viewport.visibleMinPrice, viewport.visibleMaxPrice])

    const livePriceIndex = useMemo(() => {
        if (currentPrice === null || priceLabels.length === 0) return -1
        let idx = 0
        let best = Math.abs(priceLabels[0] - currentPrice)
        priceLabels.forEach((p, i) => {
            const diff = Math.abs(p - currentPrice)
            if (diff < best) {
                best = diff
                idx = i
            }
        })
        return idx
    }, [currentPrice, priceLabels])

    const timeLabel = useMemo(() => {
        return currentTime.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        })
    }, [currentTime])

    const timeZoneLabel = useMemo(() => {
        const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date())
        return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    }, [])

    const { refreshUser, authenticated, walletAddress } = useAuth()
    const { wallets } = useWallets()
    const walletsRef = useRef(wallets)
    walletsRef.current = wallets

    const [pools, setPools] = useState<Pool[]>([])
    const poolsRef = useRef<Pool[]>([])
    poolsRef.current = pools
    useEffect(() => {
        betService.getPools().then(setPools).catch(() => {})
    }, [])

    const activePool = useMemo(
        () => pools.find(p => p.assetId === selectedAsset) ?? null,
        [pools, selectedAsset],
    )
    const { multipliers, windowTotals, cellStakes: onChainCellStakes } = usePoolMultipliers(
        activePool,
        grid,
        viewport.visibleMinPrice,
        viewport.visibleMaxPrice,
    )
    const cellStakes = React.useMemo(() => {
        const combined: Record<string, number> = { ...onChainCellStakes }
        positions.forEach(p => {
            const slotKey = normalizeSlotKey(p.cell_id, cells)
            combined[slotKey] = (combined[slotKey] || 0) + p.stake
        })
        return combined
    }, [onChainCellStakes, positions, cells])

    const { quote: betQuote, loading: quoteLoading } = useBetQuote({
        cellKey: quoteCellId,
        stake: currentStake,
        windowTotals,
        cellStakes: onChainCellStakes,
    })
    const userBalance = Number(walletBalance || '0')
    const availableBalance = Math.max(0, userBalance - totalActiveStake - pendingStake)

    const claimItems = useMemo(() => {
        const bw = grid?.price_interval || 2
        return positions
            .filter((p) =>
                (p.payout ?? 0) > 0 &&
                (betResults[normalizeSlotKey(p.cell_id, cells)] === 'won' || p.state === 'RESOLVED')
            )
            .map((p) => {
                const cell = cells.find((c) => c.cell_id === p.cell_id)
                const range = cell
                    ? `$${cell.p_low.toLocaleString()} – $${cell.p_high.toLocaleString()}`
                    : formatCellRange(p.cell_id, bw)
                const payout = p.payout ?? 0
                const stake = p.stake
                const multiplier = stake > 0 ? payout / stake : null
                const windowLabel = getWindowLabel(p.cell_id)
                const timeAgo = formatTimeAgo(p.resolved_at || p.created_at)
                return { id: p.position_id, range, payout, stake, multiplier, windowLabel, timeAgo }
            })
    }, [positions, betResults, cells, grid])

    const voidItems = useMemo(() => {
        const bw = grid?.price_interval || 2
        return positions
            .filter((p) => p.state === 'VOIDED')
            .map((p) => {
                const cell = cells.find((c) => c.cell_id === p.cell_id)
                const range = cell
                    ? `$${cell.p_low.toLocaleString()} – $${cell.p_high.toLocaleString()}`
                    : formatCellRange(p.cell_id, bw)
                const windowLabel = getWindowLabel(p.cell_id)
                const timeAgo = formatTimeAgo(p.created_at)
                return { id: p.position_id, range, payout: p.stake, stake: p.stake, windowLabel, timeAgo }
            })
    }, [positions, cells, grid])

    const unclaimedWins = useMemo(() => claimItems.filter(c => !claimedIds.has(c.id)), [claimItems, claimedIds])
    const unclaimedVoids = useMemo(() => voidItems.filter(v => !claimedIds.has(v.id)), [voidItems, claimedIds])
    const unclaimedCount = unclaimedWins.length + unclaimedVoids.length
    const unclaimedTotal = useMemo(
        () => unclaimedWins.reduce((s, c) => s + c.payout, 0) + unclaimedVoids.reduce((s, v) => s + v.payout, 0),
        [unclaimedWins, unclaimedVoids]
    )

    // Derive on-chain windowIds from a set of positionIds.
    // Parses composite "${windowId}_${cellId}" keys; falls back to DB cell window_index.
    const getWindowIds = useCallback((positionIds: string[]): number[] => {
        const windowIds = new Set<number>()
        for (const positionId of positionIds) {
            const position = positions.find(p => p.position_id === positionId)
            if (!position) continue
            const parts = normalizeSlotKey(position.cell_id, cells).split('_')
            if (parts.length >= 2) {
                const wid = parseInt(parts[0], 10)
                if (!isNaN(wid)) { windowIds.add(wid); continue }
            }
            const cell = cells.find(c => normalizeSlotKey(c.cell_id, cells) === normalizeSlotKey(position.cell_id, cells) || c.cell_id === position.cell_id)
            if (cell?.window_index !== undefined) windowIds.add(cell.window_index)
        }
        return [...windowIds]
    }, [positions, cells])

    const executeClaim = useCallback(async (positionIds: string[]) => {
        if (positionIds.length === 0) return

        setClaimingIds(prev => { const s = new Set(prev); positionIds.forEach(id => s.add(id)); return s })

        try {
            const pool = poolsRef.current.find(p => p.assetId === selectedAsset)
            if (!pool) {
                toast.error('Chain not configured', { description: 'No pool found for this asset.' })
                return
            }

            const windowIds = getWindowIds(positionIds)
            if (windowIds.length === 0) {
                toast.error('Cannot determine window IDs for claim')
                return
            }

            const activeWallet = walletsRef.current.find((w) => {
                const isPrivyWallet = (w.walletClientType || '').toLowerCase().includes('privy')
                if (!isPrivyWallet) return false
                if (!walletAddress) return true
                return (w.address || '').toLowerCase() === walletAddress.toLowerCase()
            })
            if (!activeWallet) {
                toast.error('Embedded wallet not ready', {
                    description: 'Sign in with Privy to claim wins/refunds.',
                })
                return
            }

            const provider = await activeWallet.getEthereumProvider()
            const walletClient = createWalletClient({
                account:   activeWallet.address as `0x${string}`,
                chain:     activeChain,
                transport: custom(provider),
            })

            await betService.signAndSubmitClaim(
                walletClient,
                activeWallet.address as `0x${string}`,
                pool,
                windowIds,
                expectedChainId,
            )

            setClaimedIds(prev => new Set([...prev, ...positionIds]))
            refreshUser()
            toast.success('Claim submitted', { description: 'Your payout is on its way.', duration: 4000 })
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            toast.error('Claim failed', { description: msg, duration: 5000 })
        } finally {
            setClaimingIds(prev => {
                const s = new Set(prev)
                positionIds.forEach(id => s.delete(id))
                return s
            })
        }
    }, [selectedAsset, refreshUser, getWindowIds, walletAddress])

    const handleClaim = useCallback((positionId: string) => {
        executeClaim([positionId])
    }, [executeClaim])

    const handleClaimAll = useCallback(() => {
        const allIds = [
            ...unclaimedWins.map(c => c.id),
            ...unclaimedVoids.map(v => v.id),
        ]
        executeClaim(allIds)
    }, [unclaimedWins, unclaimedVoids, executeClaim])

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('claims:update', {
            detail: { count: unclaimedCount, totalAmount: unclaimedTotal },
        }))
    }, [unclaimedCount, unclaimedTotal])

    useEffect(() => {
        const handler = () => setClaimsOpen((prev) => !prev)
        window.addEventListener('claims:toggle', handler)
        return () => window.removeEventListener('claims:toggle', handler)
    }, [])

    // Toggle sidebar collapse
    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed(prev => {
            const next = !prev
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
            return next
        })
    }, [])

    const executeBet = useCallback(async (cellId: number, windowId: number, stake: number) => {
        const slotKey = getSlotKey(windowId, cellId)
        isPlacingBetRef.current = true
        placedCellsRef.current.add(slotKey)
        addOptimisticCell(slotKey)
        markRecentCell(slotKey)
        setPendingStake(prev => prev + stake)
        setIsBetLoading(true)

        const bw = grid?.price_interval || 2
        const { low, high } = getCellPriceRange(cellId, bw)
        const priceLabel = `$${low.toLocaleString(undefined, { minimumFractionDigits: 2 })} – $${high.toLocaleString(undefined, { minimumFractionDigits: 2 })}`

        try {
            {
                // On-chain — sign EIP-712 BetIntent and schedule via relay
                const pool = poolsRef.current.find(p => p.assetId === selectedAsset)
                if (!pool) {
                    toast.error('Chain not configured', { description: 'No pool found for this asset.' })
                    throw new Error('no-pool')
                }

                // Force embedded Privy wallet for betting flows.
                // Do not fall back to injected wallets (e.g. MetaMask), which causes extra popups.
                const activeWallet = walletsRef.current.find((w) => {
                    const isPrivyWallet = (w.walletClientType || '').toLowerCase().includes('privy')
                    if (!isPrivyWallet) return false
                    if (!walletAddress) return true
                    return (w.address || '').toLowerCase() === walletAddress.toLowerCase()
                })
                if (!activeWallet) throw new Error('no-wallet')

                const provider = await activeWallet.getEthereumProvider()
                const walletClient = createWalletClient({
                    account:   activeWallet.address as `0x${string}`,
                    chain:     activeChain,
                    transport: custom(provider),
                })

                const amountUsdc = BigInt(Math.round(stake * 1_000_000))
                const { intentId } = await betService.signAndScheduleBet(
                    walletClient,
                    activeWallet.address as `0x${string}`,
                    pool,
                    cellId,
                    windowId,
                    amountUsdc,
                    expectedChainId,
                )

                prevBetResultsRef.current = { ...betResultsRef.current }
                hasPlacedBetRef.current = true
                setPendingStake(prev => Math.max(0, prev - stake))
                setShowBetConfirmation(false)
                setPendingBetCellId(null)
                setPendingBetInfo(null)
                setQuoteCellId(null)

                let cancelled = false
                setUndoToast({
                    amount: stake,
                    priceLabel,
                    undoFn: () => {
                        cancelled = true
                        betService.cancelBet(intentId).catch(() => {})
                        removeOptimisticCell(slotKey)
                        placedCellsRef.current.delete(slotKey)
                        setPendingStake(prev => Math.max(0, prev - stake))
                    },
                })

                const basescanBase = getRuntimeNetworkConfig().basescanTxBaseUrl

                betService.pollBetStatus(intentId, (status: BetStatus) => {
                    if (cancelled) return
                    if (status.state === 'confirmed') {
                        toast.success('Bet confirmed on-chain', {
                            description: `$${stake} on ${priceLabel}`,
                            action: {
                                label: 'View tx',
                                onClick: () => window.open(`${basescanBase}/${status.betTxHash}`, '_blank'),
                            },
                        })
                    } else if (status.state === 'failed') {
                        toast.error('Bet failed', {
                            description: status.error || 'Transaction reverted.',
                        })
                        removeOptimisticCell(slotKey)
                        placedCellsRef.current.delete(slotKey)
                    }
                })
            }
        } catch (err) {
            const responseMessage =
                typeof err === 'object' &&
                err !== null &&
                'response' in err &&
                typeof (err as { response?: { data?: unknown } }).response?.data === 'string'
                    ? (err as { response?: { data?: string } }).response?.data
                    : null
            const msg = responseMessage || (err instanceof Error ? err.message : '')

            // Detect user-initiated rejection (Privy dismissed, MetaMask rejected, etc.)
            const isUserRejection = /user (rejected|denied|cancelled|canceled)/i.test(msg) ||
                msg.includes('User rejected') ||
                msg.includes('user rejected') ||
                msg === 'window-closing'

            if (msg === 'no-wallet') {
                toast.error('Wallet not ready', {
                    description: 'Your embedded wallet is still loading — wait a moment and try again, or sign out and back in.',
                })
            } else if (!isUserRejection && msg !== 'no-pool') {
                toast.error('Failed to place bet', {
                    description: msg || 'Unexpected error while scheduling bet.',
                })
            }

            // Clean up all state so the cell is fully deselected
            removeOptimisticCell(slotKey)
            placedCellsRef.current.delete(slotKey)
            setPendingStake(prev => Math.max(0, prev - stake))
            setQuoteCellId(null)
            setShowBetConfirmation(false)
            setPendingBetCellId(null)
            setPendingBetInfo(null)
        } finally {
            isPlacingBetRef.current = false
            setIsBetLoading(false)
        }
    }, [
        selectedAsset,
        addOptimisticCell, removeOptimisticCell, markRecentCell, grid, walletAddress,
    ])

    const handleCellClick = useCallback(async (cellId: number, windowId: number) => {
        const slotKey = getSlotKey(windowId, cellId)
        if (viewport.dragStart.hasMoved) return
        if (isPlacingBetRef.current) return
        if (placedCellsRef.current.has(slotKey)) {
            toast.error('Bet Already Placed', {
                description: 'Bets are final and cannot be removed once placed.',
                duration: 3000,
            })
            return
        }

        // Expiry check from formula
        if (grid) {
            const tEnd = getWindowEndMs(windowId, activePool, grid)
            if (Date.now() > tEnd) {
                toast.error('Cell Expired', {
                    description: 'Cannot place bet on a cell whose time window has ended.',
                    duration: 3000,
                })
                return
            }
        }

        if (!authenticated) {
            toast.error('Wallet not connected', {
                description: 'Please connect your wallet to place bets.',
                action: {
                    label: 'Connect',
                    onClick: () => {
                        document.querySelector<HTMLButtonElement>('[data-wallet-trigger]')?.click()
                    },
                },
            })
            return
        }

        if (selectedCells.includes(slotKey)) {
            toast.error('Bet Already Placed', {
                description: 'Bets are final and cannot be removed once placed.',
                duration: 3000,
            })
            return
        }

        if (Number(walletBalance || '0') <= 0) {
            setShowRequirements(true)
            return
        }

        if (currentStake > availableBalance) {
            toast.error('Insufficient Balance', {
                description: `You only have $${availableBalance.toFixed(2)} available`,
            })
            return
        }

        setQuoteCellId(slotKey)

        if (betConfirmationEnabled) {
            const bw = grid?.price_interval || 2
            const { low, high } = getCellPriceRange(cellId, bw)
            const priceRange = `$${low.toFixed(2)} – $${high.toFixed(2)}`
            const tStart = new Date(getWindowStartMs(windowId, activePool, grid))
            const tEnd = new Date(getWindowEndMs(windowId, activePool, grid))
            const timeWindow = `${tStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${tEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            setPendingBetCellId([cellId, windowId])
            setPendingBetInfo({ priceRange, timeWindow })
            setShowBetConfirmation(true)
            return
        }

        await executeBet(cellId, windowId, currentStake)
    }, [
        viewport.dragStart.hasMoved, authenticated,
        selectedCells, currentStake, availableBalance, activePool, grid,
        betConfirmationEnabled, executeBet, walletBalance,
    ])

    const handleBetConfirm = useCallback(() => {
        if (pendingBetCellId) executeBet(pendingBetCellId[0], pendingBetCellId[1], currentStake)
    }, [pendingBetCellId, currentStake, executeBet])

    const handleBetCancel = useCallback(() => {
        setShowBetConfirmation(false)
        setPendingBetCellId(null)
        setPendingBetInfo(null)
        setQuoteCellId(null)
    }, [])

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full bg-background text-foreground font-sans overflow-hidden">
            <Confetti show={showConfetti} onComplete={resetConfetti} />

            {/* Ride ended overlay */}
            {showContestEnded && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-card border border-border rounded-lg p-8 max-w-md mx-4 text-center shadow-2xl">
                        <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-trade-up" />
                        <h2 className="text-2xl font-bold text-foreground mb-2">Ride Ended</h2>
                        <p className="text-muted-foreground mb-6">
                            {selectedContest?.name || 'The ride'} has ended. Your positions have been settled.
                        </p>
                        <button
                            onClick={handleContestEndedExit}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-semibold transition-colors"
                        >
                            Return to Ride Hub
                        </button>
                    </div>
                </div>
            )}

            {/* Undo toast */}
            {undoToast && (
                <UndoToast
                    amount={undoToast.amount}
                    priceLabel={undoToast.priceLabel}
                    duration={3000}
                    onUndo={() => {
                        undoToast.undoFn()
                        setUndoToast(null)
                        toast.success('Bet undone')
                    }}
                    onExpire={() => setUndoToast(null)}
                />
            )}

            {selectedContest && (
                <ContestRequirements
                    isOpen={showRequirements}
                    onClose={() => setShowRequirements(false)}
                    contest={selectedContest}
                    onRequirementsMet={() => setShowRequirements(false)}
                />
            )}

            <div className="flex-1 flex relative overflow-hidden">
                {/* Claims panel */}
                {claimsOpen && (
                    <>
                        <div
                            className="absolute inset-0 bg-black/50 z-40"
                            onClick={() => setClaimsOpen(false)}
                            aria-hidden="true"
                        />
                        <div className="absolute top-0 right-0 h-full w-[296px] bg-card border-l border-border z-50 flex flex-col animate-slide-in-right">
                            {/* Header */}
                            <div className="flex items-center gap-2 px-4 h-[50px] border-b border-border shrink-0">
                                <span className="text-[11px] font-bold tracking-[0.06em] uppercase text-muted-foreground flex-1">Pending Claims</span>
                                {unclaimedCount > 0 && (
                                    <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full bg-trade-up/12 border border-trade-up/22 text-trade-up">
                                        {unclaimedCount} item{unclaimedCount !== 1 ? 's' : ''}
                                    </span>
                                )}
                                <button
                                    onClick={() => setClaimsOpen(false)}
                                    className="w-[26px] h-[26px] flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
                                    aria-label="Close claims panel"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* Summary banner */}
                            {unclaimedCount > 0 && (
                                <div className={`border-b border-border px-4 py-3.5 flex items-center gap-3 shrink-0 ${unclaimedVoids.length > 0 ? 'bg-gradient-to-br from-trade-up/6 to-primary/3' : 'bg-trade-up/5'}`}>
                                    <div className="w-[34px] h-[34px] rounded-lg bg-trade-up/12 border border-trade-up/20 flex items-center justify-center text-sm shrink-0">⬡</div>
                                    <div>
                                        <div className="font-mono text-[22px] font-bold text-trade-up leading-none">+${unclaimedTotal.toFixed(2)}</div>
                                        <div className="text-[10px] text-muted-foreground mt-0.5 tracking-wide">
                                            {unclaimedWins.length > 0 && `${unclaimedWins.length} win${unclaimedWins.length !== 1 ? 's' : ''}`}
                                            {unclaimedWins.length > 0 && unclaimedVoids.length > 0 && ' · '}
                                            {unclaimedVoids.length > 0 && `${unclaimedVoids.length} void refund${unclaimedVoids.length !== 1 ? 's' : ''}`}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Scrollable list */}
                            <div className="flex-1 overflow-y-auto pb-2 min-h-0">
                                {claimItems.length === 0 && voidItems.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-2.5 text-center px-6 py-12">
                                        <div className="w-12 h-12 rounded-full bg-trade-up/8 border border-trade-up/15 flex items-center justify-center text-xl mb-1">✓</div>
                                        <p className="text-[13px] font-semibold text-muted-foreground">All caught up</p>
                                        <p className="text-[11px] text-muted-foreground/60 leading-relaxed max-w-[160px]">Winnings and refunds will appear here when your positions settle.</p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Wins */}
                                        {claimItems.length > 0 && (
                                            <>
                                                <div className="flex items-center gap-2 px-4 pt-2.5 pb-1.5">
                                                    <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-muted-foreground/60">Won</span>
                                                    <div className="flex-1 h-px bg-border" />
                                                </div>
                                                <div className="px-2.5 space-y-1.5">
                                                    {claimItems.map((claim) => {
                                                        const isClaimed = claimedIds.has(claim.id)
                                                        const isClaiming = claimingIds.has(claim.id)
                                                        return (
                                                            <div
                                                                key={claim.id}
                                                                className={`rounded-lg bg-background relative transition-opacity duration-300${isClaimed ? ' opacity-40' : isClaiming ? ' bg-trade-up/4' : ''}`}
                                                                style={{ border: '1px solid hsl(var(--border))', borderLeft: '3px solid hsl(var(--trade-up))' }}
                                                            >
                                                                {isClaimed && (
                                                                    <div className="absolute top-2.5 right-2.5 w-[22px] h-[22px] rounded-full bg-trade-up/15 border border-trade-up/30 flex items-center justify-center">
                                                                        <Check className="w-3 h-3 text-trade-up" />
                                                                    </div>
                                                                )}
                                                                <div className="px-3 py-[11px]">
                                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                                        <span className="font-mono text-[10px] text-muted-foreground">{claim.windowLabel}</span>
                                                                        {claim.timeAgo && <span className="text-[10px] text-muted-foreground/50">· {claim.timeAgo}</span>}
                                                                    </div>
                                                                    <p className="font-mono text-[13px] font-semibold text-foreground mb-2">{claim.range}</p>
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                                            <span className="font-mono text-[11px] text-muted-foreground">${claim.stake.toFixed(2)}</span>
                                                                            <span className="text-[10px] text-muted-foreground/40">→</span>
                                                                            <span className="font-mono text-[15px] font-bold text-trade-up">+${claim.payout.toFixed(2)}</span>
                                                                            {claim.multiplier && (
                                                                                <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-trade-up/10 border border-trade-up/18 text-trade-up/70 shrink-0">
                                                                                    {claim.multiplier.toFixed(1)}×
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        {!isClaimed && (
                                                                            isClaiming ? (
                                                                                <button disabled className="h-7 px-3 rounded border border-trade-up/30 bg-trade-up/8 text-[11px] font-bold text-trade-up flex items-center gap-1.5 opacity-65 cursor-not-allowed shrink-0">
                                                                                    <div className="w-3 h-3 rounded-full border-2 border-trade-up/30 border-t-trade-up animate-spin" />
                                                                                    <span>···</span>
                                                                                </button>
                                                                            ) : (
                                                                                <button
                                                                                    onClick={() => handleClaim(claim.id)}
                                                                                    className="h-7 px-3 rounded border border-trade-up/30 bg-trade-up/8 text-[11px] font-bold text-trade-up hover:bg-trade-up/20 transition-colors shrink-0"
                                                                                >
                                                                                    Claim
                                                                                </button>
                                                                            )
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </>
                                        )}

                                        {/* Void Refunds */}
                                        {voidItems.length > 0 && (
                                            <>
                                                <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                                                    <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-primary/55">Void Refunds</span>
                                                    <div className="flex-1 h-px bg-border" />
                                                </div>
                                                <div className="px-2.5 space-y-1.5">
                                                    {voidItems.map((item) => {
                                                        const isClaimed = claimedIds.has(item.id)
                                                        const isClaiming = claimingIds.has(item.id)
                                                        return (
                                                            <div
                                                                key={item.id}
                                                                className={`rounded-lg bg-background relative transition-opacity duration-300${isClaimed ? ' opacity-40' : ''}`}
                                                                style={{ border: '1px solid hsl(var(--border))', borderLeft: '3px solid hsl(var(--primary))' }}
                                                            >
                                                                {isClaimed && (
                                                                    <div className="absolute top-2.5 right-2.5 w-[22px] h-[22px] rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
                                                                        <Check className="w-3 h-3 text-primary" />
                                                                    </div>
                                                                )}
                                                                <div className="px-3 py-[11px]">
                                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                                        <span className="font-mono text-[10px] text-muted-foreground">{item.windowLabel}</span>
                                                                        {item.timeAgo && <span className="text-[10px] text-primary/55">· Oracle failure</span>}
                                                                    </div>
                                                                    <p className="font-mono text-[13px] font-semibold text-muted-foreground mb-2">{item.range}</p>
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                                            <span className="text-[11px] text-muted-foreground/60">Stake refund</span>
                                                                            <span className="text-[10px] text-muted-foreground/40">→</span>
                                                                            <span className="font-mono text-[15px] font-bold text-primary">+${item.payout.toFixed(2)}</span>
                                                                        </div>
                                                                        {!isClaimed && (
                                                                            isClaiming ? (
                                                                                <button disabled className="h-7 px-3 rounded border border-primary/30 bg-primary/8 text-[11px] font-bold text-primary flex items-center gap-1.5 opacity-65 cursor-not-allowed shrink-0">
                                                                                    <div className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                                                                                    <span>···</span>
                                                                                </button>
                                                                            ) : (
                                                                                <button
                                                                                    onClick={() => handleClaim(item.id)}
                                                                                    className="h-7 px-3 rounded border border-primary/30 bg-primary/8 text-[11px] font-bold text-primary hover:bg-primary/20 transition-colors shrink-0"
                                                                                >
                                                                                    Refund
                                                                                </button>
                                                                            )
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Footer: Claim All */}
                            <div className="p-3 border-t border-border shrink-0">
                                <button
                                    onClick={handleClaimAll}
                                    disabled={unclaimedCount === 0}
                                    className="w-full h-11 rounded-lg font-mono font-bold text-[13px] tracking-wide transition-opacity flex items-center justify-center gap-2"
                                    style={unclaimedCount > 0
                                        ? { background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)', color: '#fff', boxShadow: '0 4px 20px rgba(22,163,74,0.22)' }
                                        : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))', cursor: 'not-allowed' }
                                    }
                                >
                                    {unclaimedCount > 0 ? `⬡ Claim All · +$${unclaimedTotal.toFixed(2)}` : 'Nothing to claim'}
                                </button>
                            </div>
                        </div>
                    </>
                )}
                {/* ── Grid canvas ─────────────────────────────────────────── */}
                <main className="flex-1 relative flex flex-col bg-background min-w-0">
                    {/* Contest timer */}
                    {selectedContest && timeRemaining !== null && (
                        <div className="absolute top-3 left-3 z-20 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 flex items-center gap-2 shadow-lg">
                            <Clock className={`w-4 h-4 ${
                                timeRemaining <= 60 ? 'text-trade-down animate-pulse'
                                    : timeRemaining <= 300 ? 'text-primary'
                                        : 'text-muted-foreground'
                            }`} />
                            <span className={`font-mono text-sm font-semibold ${
                                timeRemaining <= 60 ? 'text-trade-down'
                                    : timeRemaining <= 300 ? 'text-primary'
                                        : 'text-foreground'
                            }`}>
                                {formatTimeRemaining(timeRemaining)}
                            </span>
                            {timeRemaining <= 60 && (
                                <span className="text-xs text-trade-down font-medium">ENDING</span>
                            )}
                        </div>
                    )}

                    <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex flex-1 min-h-0">
                            {/* Grid canvas */}
                            <div
                                ref={containerRef}
                                className="flex-1 relative overflow-hidden cursor-crosshair touch-none grid-canvas"
                                onMouseDown={viewport.handleMouseDown}
                                onMouseMove={viewport.handleMouseMove}
                                onMouseUp={viewport.handleMouseUp}
                                onMouseLeave={viewport.handleMouseLeave}
                                onTouchStart={viewport.handleTouchStart}
                                onTouchMove={viewport.handleTouchMove}
                                onTouchEnd={viewport.handleTouchEnd}
                            >
                                {!authenticated ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-background/50 backdrop-blur-sm z-10">
                                        <div className="p-6 rounded-lg bg-card border border-border text-center shadow-lg">
                                            <h3 className="text-lg font-semibold text-foreground mb-2">
                                                Authentication Required
                                            </h3>
                                            <p className="text-sm">Please login to view the live market grid</p>
                                        </div>
                                    </div>
                                ) : !grid ? (
                                    <GridSkeleton />
                                ) : (
                                    <>
                                    <GridCanvas
                                        width={viewport.dimensions.width}
                                        height={viewport.dimensions.height}
                                            grid={grid}
                                            pool={activePool}
                                            cells={cells}
                                            prices={prices}
                                            currentPrice={currentPrice}
                                            selectedCells={selectedCells}
                                            visibleTimeRange={{ start: viewport.visibleStart, end: viewport.visibleEnd }}
                                            visiblePriceRange={{ min: viewport.visibleMinPrice, max: viewport.visibleMaxPrice }}
                                            mousePos={viewport.mousePos}
                                            isDragging={viewport.isDragging}
                                            onCellClick={handleCellClick}
                                            betResults={betResults}
                                            cellStakes={cellStakes}
                                            multipliers={multipliers}
                                            recentCellIds={recentCells}
                                        contestEndTime={timeBoundary?.end}
                                    />
                                    <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
                                        <button
                                            onClick={viewport.zoomIn}
                                            className="w-8 h-8 rounded bg-card/90 border border-border text-foreground hover:bg-card flex items-center justify-center text-sm font-bold"
                                            aria-label="Zoom in"
                                        >
                                            +
                                        </button>
                                        <button
                                            onClick={viewport.zoomOut}
                                            className="w-8 h-8 rounded bg-card/90 border border-border text-foreground hover:bg-card flex items-center justify-center text-sm font-bold"
                                            aria-label="Zoom out"
                                        >
                                            -
                                        </button>
                                    </div>
                                    {(viewport.viewportCenterTime !== null || viewport.viewportCenterPrice !== null) && (
                                        <button
                                            onClick={viewport.resetViewport}
                                                className="absolute bottom-6 right-4 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg shadow-lg transition-all font-medium text-xs flex items-center gap-2"
                                            >
                                                <Crosshair className="w-4 h-4" />
                                                Re-center View
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Y-axis labels (right) */}
                            <div className="w-16 border-l border-border bg-card/60 flex flex-col justify-between px-2 py-3 text-[10px] font-mono">
                                {priceLabels.map((price, index) => (
                                    <div
                                        key={`${price}-${index}`}
                                        className={[
                                            'text-left',
                                            index === livePriceIndex
                                                ? 'text-primary font-semibold'
                                                : 'text-muted-foreground',
                                        ].join(' ')}
                                    >
                                        ${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                        {index === livePriceIndex ? ' \u2190' : ''}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Time bar */}
                        <div className="flex h-7 border-t border-border bg-card/60 items-center">
                            <div className="flex-1 flex items-center justify-between px-3 text-[10px] font-mono text-muted-foreground">
                                <span className="uppercase tracking-[0.2em]">Local time</span>
                                <span className="text-foreground">
                                    {timeLabel}
                                    {timeZoneLabel ? ` ${timeZoneLabel}` : ''}
                                </span>
                            </div>
                            <div className="w-16 border-l border-border" />
                        </div>
                    </div>
                </main>

                {/* ── Desktop sidebar ──────────────────────────────────────── */}
                <aside
                    className={[
                        'hidden md:flex flex-col shrink-0 bg-card border-l border-border transition-all duration-200',
                        sidebarCollapsed ? 'w-12' : 'w-[300px]',
                    ].join(' ')}
                >
                    {/* Collapse toggle */}
                    <button
                        onClick={toggleSidebar}
                        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        className="flex items-center justify-center h-10 border-b border-border text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors shrink-0"
                    >
                        {sidebarCollapsed
                            ? <PanelRightOpen className="w-4 h-4" />
                            : <PanelRightClose className="w-4 h-4" />}
                    </button>

                    {sidebarCollapsed ? (
                        /* Collapsed: icon strip */
                        <div className="flex flex-col items-center gap-4 pt-4">
                            <DollarSign className="w-4 h-4 text-muted-foreground" />
                            <Activity className="w-4 h-4 text-muted-foreground" />
                            <History className="w-4 h-4 text-muted-foreground" />
                        </div>
                    ) : (
                        /* Expanded: full sidebar content */
                        <>
                            <TradeControls
                                stake={currentStake}
                                onStakeChange={setCurrentStake}
                                balance={availableBalance}
                                betQuote={betQuote}
                                quoteLoading={quoteLoading}
                                selectedCellId={quoteCellId}
                            />

                            <PositionSummary
                                selectedCells={selectedCells}
                                betResults={betResults}
                                positions={positions}
                                cells={allCells}
                            />

                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                                <BetHistory
                                    betResults={betResults}
                                    cells={allCells}
                                    positions={positions}
                                />
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-border bg-card/50 shrink-0">
                                <div className="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                                    <img
                                        src="/logo/Coinbase_Wordmark.svg"
                                        alt="Coinbase"
                                        className="h-3 w-auto dark:brightness-0 dark:invert"
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </aside>

                {/* ── Mobile: right-strip + overlay sidebar ───────────────── */}
                <div className="md:hidden">
                    {/* Always-visible thin strip on the right */}
                    <button
                        onClick={() => setMobileSidebarOpen(true)}
                        className={[
                            'fixed right-0 top-1/2 -translate-y-1/2 z-40',
                            'w-9 flex flex-col items-center justify-center gap-1.5 py-4',
                            'bg-card/90 border-l border-border rounded-l-lg shadow-lg',
                            'text-muted-foreground hover:text-foreground transition-colors',
                        ].join(' ')}
                        aria-label="Open trade controls"
                    >
                        <DollarSign className="w-3.5 h-3.5" />
                        <div className="flex flex-col gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
                            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
                            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
                        </div>
                    </button>

                    {/* Slide-in overlay */}
                    {mobileSidebarOpen && (
                        <>
                            {/* Backdrop */}
                            <div
                                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                                onClick={() => setMobileSidebarOpen(false)}
                                aria-hidden="true"
                            />
                            {/* Panel */}
                            <div
                                className={[
                                    'fixed right-0 top-0 bottom-0 z-50 w-72',
                                    'bg-card border-l border-border flex flex-col shadow-2xl',
                                    'animate-slide-in-right',
                                ].join(' ')}
                            >
                                {/* Header */}
                                <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                        Trade
                                    </span>
                                    <button
                                        onClick={() => setMobileSidebarOpen(false)}
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                        aria-label="Close trade controls"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <TradeControls
                                    stake={currentStake}
                                    onStakeChange={setCurrentStake}
                                    balance={availableBalance}
                                    betQuote={betQuote}
                                    quoteLoading={quoteLoading}
                                    selectedCellId={quoteCellId}
                                />

                                <PositionSummary
                                    selectedCells={selectedCells}
                                    betResults={betResults}
                                    positions={positions}
                                />

                                <div className="flex-1 min-h-0 overflow-y-auto">
                                    <BetHistory
                                        betResults={betResults}
                                        cells={allCells}
                                        positions={positions}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Bet Confirmation Dialog */}
            <BetConfirmation
                open={showBetConfirmation}
                onOpenChange={(open) => { if (!open) handleBetCancel() }}
                stake={currentStake}
                asset={selectedAsset}
                priceRange={pendingBetInfo?.priceRange}
                onConfirm={handleBetConfirm}
                isLoading={isBetLoading}
            />
        </div>
    )
}

export default GridVisualizer
