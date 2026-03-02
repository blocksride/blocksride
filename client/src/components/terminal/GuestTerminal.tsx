import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Grid, Cell, Position } from '@/types/grid'
import { usePublicPriceFeed } from '@/hooks/usePublicPriceFeed'
import { useGridViewport } from '@/hooks/useGridViewport'
import { GridCanvas } from '@/components/grid/GridCanvas'
import { GridSkeleton } from '@/components/grid/GridSkeleton'
import { TradeControls } from '@/components/grid/TradeControls'
import { PositionSummary } from '@/components/grid/PositionSummary'
import { BetHistory } from '@/components/grid/BetHistory'
import { Button } from '@/components/ui/button'

interface GuestTerminalProps {
    assetId: string
}

const ASSET_META: Record<string, { defaultPrice: number; priceInterval: number }> = {
    'ETH-USD': { defaultPrice: 3000, priceInterval: 2 },
    'BTC-USD': { defaultPrice: 50000, priceInterval: 2 },
}

export const GuestTerminal = ({ assetId }: GuestTerminalProps) => {
    const navigate = useNavigate()
    const assetMeta = ASSET_META[assetId] || ASSET_META['ETH-USD']
    const { prices, currentPrice } = usePublicPriceFeed(assetId)

    const [stake, setStake] = useState(10)
    const [currentTime, setCurrentTime] = useState(new Date())
    const [anchorPrice, setAnchorPrice] = useState(() => {
        return Math.round(assetMeta.defaultPrice / assetMeta.priceInterval) * assetMeta.priceInterval
    })
    const anchorSetRef = useRef(false)
    const gridStartRef = useRef<number | null>(null)

    useEffect(() => {
        anchorSetRef.current = false
        setAnchorPrice(Math.round(assetMeta.defaultPrice / assetMeta.priceInterval) * assetMeta.priceInterval)
        gridStartRef.current = null
    }, [assetId, assetMeta.defaultPrice, assetMeta.priceInterval])

    useEffect(() => {
        if (anchorSetRef.current) return
        if (currentPrice === null) return
        anchorSetRef.current = true
        setAnchorPrice(Math.round(currentPrice / assetMeta.priceInterval) * assetMeta.priceInterval)
    }, [currentPrice, assetMeta.priceInterval])

    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
        return () => window.clearInterval(timer)
    }, [])

    const selectedTimeframe = 60

    if (gridStartRef.current === null) {
        gridStartRef.current = Date.now() - selectedTimeframe * 6 * 1000
    }

    const grid = useMemo<Grid>(() => {
        const startMs = gridStartRef.current ?? Date.now()
        const endMs = startMs + selectedTimeframe * 140 * 1000
        return {
            grid_id: 'guest-grid',
            asset_id: assetId,
            timeframe_sec: selectedTimeframe,
            start_time: new Date(startMs).toISOString(),
            end_time: new Date(endMs).toISOString(),
            anchor_price: anchorPrice,
            price_interval: assetMeta.priceInterval,
        }
    }, [assetId, anchorPrice, assetMeta.priceInterval])

    const containerRef = useRef<HTMLDivElement>(null)
    const viewport = useGridViewport(
        currentPrice ?? anchorPrice ?? assetMeta.defaultPrice,
        selectedTimeframe,
        containerRef,
        true,
        assetMeta.priceInterval,
        anchorPrice,
        null
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

    const promptConnect = useCallback(() => {
        navigate('/', { state: { autoSignIn: true } })
    }, [navigate])

    const handleCellClick = useCallback(() => {
        promptConnect()
    }, [promptConnect])

    const guestCells: Cell[] = []
    const guestPositions: Position[] = []
    const guestBetResults: Record<string, 'won' | 'lost' | 'pending' | 'winning'> = {}

    return (
        <div className="flex-1 min-h-0 flex">
            <main className="flex-1 relative flex flex-col bg-background min-w-0">
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex flex-1 min-h-0">
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
                            {currentPrice === null ? (
                                <GridSkeleton />
                            ) : (
                                <>
                                    <GridCanvas
                                        width={viewport.dimensions.width}
                                        height={viewport.dimensions.height}
                                        grid={grid}
                                        cells={guestCells}
                                        prices={prices}
                                        currentPrice={currentPrice}
                                        selectedCells={[]}
                                        visibleTimeRange={{ start: viewport.visibleStart, end: viewport.visibleEnd }}
                                        visiblePriceRange={{ min: viewport.visibleMinPrice, max: viewport.visibleMaxPrice }}
                                        mousePos={viewport.mousePos}
                                        isDragging={viewport.isDragging}
                                        onCellClick={handleCellClick}
                                        betResults={guestBetResults}
                                        recentCellIds={{}}
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
                                            Re-center View
                                        </button>
                                    )}
                                </>
                            )}

                        </div>

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

            <aside className="hidden md:flex flex-col shrink-0 bg-card border-l border-border w-[300px] relative">
                <TradeControls
                    stake={stake}
                    onStakeChange={setStake}
                    balance={0}
                    isPractice={false}
                    selectedCellId={null}
                />
                <PositionSummary
                    selectedCells={[]}
                    betResults={guestBetResults}
                    positions={guestPositions}
                />
                <div className="flex-1">
                    <BetHistory
                        betResults={guestBetResults}
                        cells={guestCells}
                        positions={guestPositions}
                    />
                </div>

                <div
                    className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center text-center p-6"
                    role="button"
                    tabIndex={0}
                    onClick={promptConnect}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            promptConnect()
                        }
                    }}
                >
                    <div className="border border-border bg-card/90 p-4 rounded-lg shadow-lg">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Guest Mode
                        </div>
                        <div className="text-sm font-semibold text-foreground mt-2">
                            Connect to trade
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Sign in with Privy to place bets and view balances.
                        </div>
                        <Button
                            size="sm"
                            className="mt-3"
                            onClick={(event) => {
                                event.stopPropagation()
                                navigate('/', { state: { autoSignIn: true } })
                            }}
                        >
                            Connect to trade
                        </Button>
                    </div>
                </div>
            </aside>
        </div>
    )
}
