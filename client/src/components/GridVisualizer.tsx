import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { api } from '../services/apiService'
import { GridCanvas } from './grid/GridCanvas'
import { GridSkeleton } from './grid/GridSkeleton'
import { PositionSummary } from './grid/PositionSummary'
import { BetHistory } from './grid/BetHistory'
import { TradeControls } from './grid/TradeControls'
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
} from 'lucide-react'

import { useGridSocket } from '../hooks/useGridSocket'
import { useBetQuote } from '../hooks/useBetQuote'

const BET_CONFIRMATION_KEY = 'blip_bet_confirmation_enabled'
const SIDEBAR_COLLAPSED_KEY = 'blip_sidebar_collapsed'

interface GridVisualizerProps {
    assetId?: string
}

export const GridVisualizer: React.FC<GridVisualizerProps> = ({
    assetId: initialAssetId = 'ETH-USD',
}) => {
    const selectedAsset = initialAssetId
    const [currentStake, setCurrentStake] = useState<number>(() => {
        const stored = localStorage.getItem('blip_active_chip')
        const parsed = stored ? parseFloat(stored) : NaN
        return isNaN(parsed) ? 5 : parsed
    })
    const [pendingStake, setPendingStake] = useState(0)

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
    const [pendingBetCellId, setPendingBetCellId] = useState<string | null>(null)
    const [pendingBetInfo, setPendingBetInfo] = useState<{
        priceRange: string
        timeWindow: string
    } | null>(null)
    const [isBetLoading, setIsBetLoading] = useState(false)
    const [betConfirmationEnabled] = useState(() => {
        return localStorage.getItem(BET_CONFIRMATION_KEY) === 'true'
    })

    const selectedTimeframe = 60
    const { isPracticeMode, selectedContest, timeRemaining, exitToSelection } = useContest()
    const [showContestEnded, setShowContestEnded] = useState(false)

    const timeBoundary = useMemo(() => {
        if (isPracticeMode || !selectedContest) return null
        return {
            start: new Date(selectedContest.start_time).getTime(),
            end: new Date(selectedContest.end_time).getTime(),
        }
    }, [isPracticeMode, selectedContest])

    const { grid, cells } = useGridState(selectedAsset, selectedTimeframe)
    const { prices, currentPrice } = useGridPrices(selectedAsset, grid)
    const {
        positions, betResults, selectedCells, totalActiveStake,
        addOptimisticCell, removeOptimisticCell, updateCellId,
    } = useGridPositions(selectedAsset, grid, cells, currentPrice, isPracticeMode)

    const { cellStakes: socketCellStakes, cellPrices } = useGridSocket()
    const { showConfetti, trigger: triggerConfetti, reset: resetConfetti } = useConfetti()

    const [quoteCellId, setQuoteCellId] = useState<string | null>(null)
    const { quote: betQuote, loading: quoteLoading } = useBetQuote(
        quoteCellId,
        selectedAsset,
        currentStake
    )

    const prevBetResultsRef = useRef<Record<string, string>>({})
    const hasPlacedBetRef = useRef(false)
    const betResultsRef = useRef(betResults)
    betResultsRef.current = betResults
    const isPlacingBetRef = useRef(false)
    const placedCellsRef = useRef<Set<string>>(new Set())

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
        if (newWins.length > 0) triggerConfetti()
        prevBetResultsRef.current = { ...betResults }
    }, [betResults, triggerConfetti])

    useEffect(() => {
        if (!isPracticeMode && timeRemaining === 0 && selectedContest) {
            setShowContestEnded(true)
        }
    }, [timeRemaining, isPracticeMode, selectedContest])

    const handleContestEndedExit = useCallback(() => {
        setShowContestEnded(false)
        exitToSelection()
    }, [exitToSelection])

    const cellStakes = React.useMemo(() => {
        const combined: Record<string, number> = { ...socketCellStakes }
        positions.forEach(p => {
            combined[p.cell_id] = (combined[p.cell_id] || 0) + p.stake
        })
        return combined
    }, [socketCellStakes, positions])

    const containerRef = useRef<HTMLDivElement>(null)
    const viewport = useGridViewport(
        currentPrice,
        selectedTimeframe,
        containerRef,
        true,
        grid?.price_interval || 5,
        grid?.anchor_price || null,
        timeBoundary
    )

    const { user, refreshUser, authenticated } = useAuth()
    const practiceBalance = user?.practice_balance ?? 1000
    const platformBalance = user?.balance ?? 0
    const userBalance = isPracticeMode ? practiceBalance : platformBalance
    const availableBalance = Math.max(0, userBalance - totalActiveStake - pendingStake)

    // Toggle sidebar collapse
    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed(prev => {
            const next = !prev
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
            return next
        })
    }, [])

    const executeBet = useCallback(async (cellId: string, stake: number) => {
        isPlacingBetRef.current = true
        placedCellsRef.current.add(cellId)
        addOptimisticCell(cellId)
        setPendingStake(prev => prev + stake)
        setIsBetLoading(true)

        // Find cell for price label
        const cell = cells.find(c => c.cell_id === cellId)
        const priceLabel = cell
            ? `$${cell.p_low.toLocaleString()} – $${cell.p_high.toLocaleString()}`
            : undefined

        try {
            const response = await api.createPosition(cellId, selectedAsset, stake, isPracticeMode)
            const position = response.data

            if (position.cell_id && position.cell_id !== cellId) {
                updateCellId(cellId, position.cell_id)
                placedCellsRef.current.delete(cellId)
                placedCellsRef.current.add(position.cell_id)
            }

            prevBetResultsRef.current = { ...betResultsRef.current }
            hasPlacedBetRef.current = true
            setPendingStake(prev => Math.max(0, prev - stake))
            refreshUser()
            window.dispatchEvent(new CustomEvent('position_updated'))
            setShowBetConfirmation(false)
            setPendingBetCellId(null)
            setPendingBetInfo(null)
            setQuoteCellId(null)

            // Show undo toast (3 second window)
            setUndoToast({
                amount: stake,
                priceLabel,
                undoFn: () => {
                    // Optimistically roll back the visual state.
                    // When relay API is wired: DELETE /api/relay/bet/:intentId goes here.
                    removeOptimisticCell(position.cell_id || cellId)
                    placedCellsRef.current.delete(position.cell_id || cellId)
                    setPendingStake(prev => Math.max(0, prev - stake))
                    refreshUser()
                },
            })
        } catch {
            toast.error('Failed to place bet')
            removeOptimisticCell(cellId)
            placedCellsRef.current.delete(cellId)
            setPendingStake(prev => Math.max(0, prev - stake))
        } finally {
            isPlacingBetRef.current = false
            setIsBetLoading(false)
        }
    }, [
        isPracticeMode, selectedAsset, refreshUser,
        addOptimisticCell, removeOptimisticCell, updateCellId, cells,
    ])

    const handleCellClick = useCallback(async (cellId: string) => {
        if (viewport.dragStart.hasMoved) return
        if (isPlacingBetRef.current) return
        if (placedCellsRef.current.has(cellId)) {
            toast.error('Bet Already Placed', {
                description: 'Bets are final and cannot be removed once placed.',
                duration: 3000,
            })
            return
        }

        const cell = cells.find(c => c.cell_id === cellId)
        if (cell) {
            const now = Date.now()
            const tEnd = new Date(cell.t_end).getTime()
            if (now > tEnd) {
                toast.error('Cell Expired', {
                    description: 'Cannot place bet on a cell whose time window has ended.',
                    duration: 3000,
                })
                return
            }
        }

        if (!isPracticeMode && !authenticated) {
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

        if (selectedCells.includes(cellId)) {
            toast.error('Bet Already Placed', {
                description: 'Bets are final and cannot be removed once placed.',
                duration: 3000,
            })
            return
        }

        if (currentStake > availableBalance) {
            toast.error('Insufficient Balance', {
                description: `You only have $${availableBalance.toFixed(2)} available`,
            })
            return
        }

        setQuoteCellId(cellId)

        if (betConfirmationEnabled && cell) {
            const priceRange = `$${cell.p_low.toFixed(2)} – $${cell.p_high.toFixed(2)}`
            const startTime = new Date(cell.t_start)
            const endTime = new Date(cell.t_end)
            const timeWindow = `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            setPendingBetCellId(cellId)
            setPendingBetInfo({ priceRange, timeWindow })
            setShowBetConfirmation(true)
            return
        }

        await executeBet(cellId, currentStake)
    }, [
        viewport.dragStart.hasMoved, isPracticeMode, authenticated,
        selectedCells, currentStake, availableBalance, cells,
        betConfirmationEnabled, executeBet,
    ])

    const handleBetConfirm = useCallback(() => {
        if (pendingBetCellId) executeBet(pendingBetCellId, currentStake)
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

            {/* Contest ended overlay */}
            {showContestEnded && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-card border border-border rounded-lg p-8 max-w-md mx-4 text-center shadow-2xl">
                        <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-trade-up" />
                        <h2 className="text-2xl font-bold text-foreground mb-2">Contest Ended</h2>
                        <p className="text-muted-foreground mb-6">
                            {selectedContest?.name || 'The contest'} has ended. Your positions have been settled.
                        </p>
                        <button
                            onClick={handleContestEndedExit}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-semibold transition-colors"
                        >
                            Return to Contest Hub
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

            <div className="flex-1 flex relative overflow-hidden">
                {/* ── Grid canvas ─────────────────────────────────────────── */}
                <main className="flex-1 relative flex flex-col bg-background min-w-0">
                    {/* Contest timer */}
                    {!isPracticeMode && selectedContest && timeRemaining !== null && (
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
                                    cellPrices={cellPrices}
                                    contestEndTime={timeBoundary?.end}
                                />
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
                                isPractice={isPracticeMode}
                                betQuote={betQuote}
                                quoteLoading={quoteLoading}
                                selectedCellId={quoteCellId}
                            />

                            <PositionSummary
                                selectedCells={selectedCells}
                                betResults={betResults}
                                positions={positions}
                            />

                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                                <BetHistory
                                    betResults={betResults}
                                    cells={cells}
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
                                    isPractice={isPracticeMode}
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
                                        cells={cells}
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
