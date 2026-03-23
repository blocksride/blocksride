import React, { useMemo } from 'react'
import { Grid, Cell, PricePoint } from '../../types/grid'
import type { Pool } from '../../services/betService'
import { getAbsoluteCellId, getGridEpochMs, getWindowDurationMs, getWindowIdAtTime } from '../../lib/gridSlots'
import { GridBackground } from './canvas/GridBackground'
import { PriceChart } from './canvas/PriceChart'
import { GridCells } from './canvas/GridCells'
import { CurrentPriceIndicator } from './canvas/CurrentPriceIndicator'
import { LivePriceElements } from './canvas/LivePriceElements'
import { FrozenZoneMask } from './canvas/FrozenZoneMask'
import { Crosshair } from './canvas/Crosshair'

interface GridCanvasProps {
    width: number
    height: number
    grid: Grid | null
    pool: Pool | null
    cells: Cell[]
    prices: PricePoint[]
    currentPrice: number | null
    selectedCells: string[]
    visibleTimeRange: { start: number; end: number }
    visiblePriceRange: { min: number; max: number }
    mousePos: { x: number; y: number } | null
    isDragging: boolean
    onCellClick: (cellId: number, windowId: number) => void
    betResults: Record<string, string>
    cellStakes?: Record<string, number>
    /** On-chain parimutuel multipliers keyed by "${windowId}_${cellId}" */
    multipliers?: Record<string, number>
    recentCellIds?: Record<string, boolean>
    contestEndTime?: number // Contest end time in ms (undefined = no restriction)
}

const GridCanvasInner: React.FC<GridCanvasProps> = ({
    width,
    height,
    grid,
    pool,
    cells,
    prices,
    currentPrice,
    selectedCells,
    visibleTimeRange,
    visiblePriceRange,
    mousePos,
    isDragging,
    onCellClick,
    betResults,
    cellStakes,
    multipliers,
    recentCellIds,
    contestEndTime,
}) => {
    const { start: viewportStart, end: viewportEnd } = visibleTimeRange
    const { min: visibleMinPrice, max: visibleMaxPrice } = visiblePriceRange

    const viewportDuration = viewportEnd - viewportStart
    const visiblePriceDiff = visibleMaxPrice - visibleMinPrice
    const now = Date.now()
    const frozenWindows = 3

    const getX = (t: number) => {
        return ((t - viewportStart) / viewportDuration) * width
    }

    const getY = (p: number) => {
        return height - ((p - visibleMinPrice) / visiblePriceDiff) * height
    }

    const timeSteps = useMemo(() => {
        if (!grid) return []
        const steps: number[] = []
        const windowDuration = getWindowDurationMs(pool, grid)
        const gridStartTime = getGridEpochMs(pool, grid)
        const offset = gridStartTime % windowDuration

        const startWindow =
            Math.floor((viewportStart - offset) / windowDuration) * windowDuration +
            offset

        if (windowDuration <= 0) return []

        for (let t = startWindow; t <= viewportEnd; t += windowDuration) {
            steps.push(t)
        }
        return steps
    }, [grid, pool, viewportStart, viewportEnd])

    const priceSteps = useMemo(() => {
        if (!grid) return []
        const steps: number[] = []
        const priceInterval = grid.price_interval || 2
        const anchorPrice = grid.anchor_price

        const startBand = Math.floor(
            (visibleMinPrice - anchorPrice) / priceInterval
        )
        const startPrice = anchorPrice + startBand * priceInterval

        if (priceInterval <= 0) return []

        for (let p = startPrice; p <= visibleMaxPrice; p += priceInterval) {
            steps.push(p)
        }
        return steps
    }, [grid, visibleMinPrice, visibleMaxPrice])

    if (!grid) return null

    const windowDuration = getWindowDurationMs(pool, grid)
    const activeCellId = currentPrice !== null ? getAbsoluteCellId(currentPrice, grid.price_interval || 2) : undefined
    const gridStartTime = getGridEpochMs(pool, grid)
    const currentWindowIndex = getWindowIdAtTime(now, pool, grid)
    const currentWindowStart = gridStartTime + currentWindowIndex * windowDuration
    const currentWindowEnd = currentWindowStart + windowDuration
    const frozenEndTime = currentWindowStart + (frozenWindows + 1) * windowDuration

    const clampX = (x: number) => Math.min(width, Math.max(0, x))
    const settledStartX = 0
    const settledEndX = clampX(getX(currentWindowStart))
    const nowStartX = clampX(getX(currentWindowStart))
    const nowEndX = clampX(getX(currentWindowEnd))
    const frozenStartX = clampX(getX(currentWindowEnd))
    const frozenEndX = clampX(getX(frozenEndTime))
    const bettableStartX = frozenEndX
    const bettableEndX = width
    const zoneLabelY = height - 6

    return (
        <svg width={width} height={height} className="block bg-background">
            {/* Zone bands */}
            {settledEndX > settledStartX && (
                <rect
                    x={settledStartX}
                    y={0}
                    width={settledEndX - settledStartX}
                    height={height}
                    className="fill-background"
                />
            )}
            {nowEndX > nowStartX && (
                <rect
                    x={nowStartX}
                    y={0}
                    width={nowEndX - nowStartX}
                    height={height}
                    className="fill-secondary/20"
                />
            )}
            {frozenEndX > frozenStartX && (
                <rect
                    x={frozenStartX}
                    y={0}
                    width={frozenEndX - frozenStartX}
                    height={height}
                    className="fill-primary/10"
                />
            )}
            {bettableEndX > bettableStartX && (
                <rect
                    x={bettableStartX}
                    y={0}
                    width={bettableEndX - bettableStartX}
                    height={height}
                    className="fill-primary/5"
                />
            )}
            {bettableStartX > 0 && bettableStartX < width && (
                <line
                    x1={bettableStartX}
                    x2={bettableStartX}
                    y1={0}
                    y2={height}
                    className="stroke-primary/40"
                    strokeWidth="2"
                />
            )}

            <GridBackground
                width={width}
                height={height}
                timeSteps={timeSteps}
                priceSteps={priceSteps}
                getX={getX}
                getY={getY}
            />

            <PriceChart
                width={width}
                height={height}
                prices={prices}
                grid={grid}
                visibleTimeRange={visibleTimeRange}
                visiblePriceRange={visiblePriceRange}
                getX={getX}
                getY={getY}
            />

            <LivePriceElements
                width={width}
                height={height}
                viewportStart={viewportStart}
                viewportEnd={viewportEnd}
                visibleMinPrice={visibleMinPrice}
                visibleMaxPrice={visibleMaxPrice}
                lastPricePoint={prices.length > 0 ? prices[prices.length - 1] : null}
                currentPrice={currentPrice}
            />

            <GridCells
                width={width}
                height={height}
                grid={grid}
                pool={pool}
                cells={cells}
                visibleTimeRange={visibleTimeRange}
                visiblePriceRange={visiblePriceRange}
                selectedCells={selectedCells}
                betResults={betResults}
                cellStakes={cellStakes}
                multipliers={multipliers}
                recentCellIds={recentCellIds}
                activeCellId={activeCellId}
                getX={getX}
                getY={getY}
                onCellClick={onCellClick}
                contestEndTime={contestEndTime}
            />

            <FrozenZoneMask
                width={width}
                height={height}
                viewportStart={viewportStart}
                viewportEnd={viewportEnd}
                gridStartTime={gridStartTime}
                windowDuration={windowDuration}
                frozenWindows={frozenWindows}
            />

            <CurrentPriceIndicator
                width={width}
                currentPrice={currentPrice}
                getY={getY}
            />

            {/* Zone labels */}
            <g className="pointer-events-none">
                {settledEndX > settledStartX + 24 && (
                    <text
                        x={(settledStartX + settledEndX) / 2}
                        y={zoneLabelY}
                        textAnchor="middle"
                        fill="currentColor"
                        className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Settled
                    </text>
                )}
                {nowEndX > nowStartX + 24 && (
                    <text
                        x={(nowStartX + nowEndX) / 2}
                        y={zoneLabelY}
                        textAnchor="middle"
                        fill="currentColor"
                        className="text-[9px] font-mono uppercase tracking-[0.2em] text-foreground"
                    >
                        Now
                    </text>
                )}
                {frozenEndX > frozenStartX + 24 && (
                    <text
                        x={(frozenStartX + frozenEndX) / 2}
                        y={zoneLabelY}
                        textAnchor="middle"
                        fill="currentColor"
                        className="text-[9px] font-mono uppercase tracking-[0.2em] text-primary/40"
                    >
                        Frozen
                    </text>
                )}
                {bettableEndX > bettableStartX + 24 && (
                    <text
                        x={(bettableStartX + bettableEndX) / 2}
                        y={zoneLabelY}
                        textAnchor="middle"
                        fill="currentColor"
                        className="text-[9px] font-mono uppercase tracking-[0.2em] text-primary/70"
                    >
                        Bettable
                    </text>
                )}
            </g>

            <Crosshair
                width={width}
                height={height}
                mousePos={mousePos}
                isDragging={isDragging}
                visibleTimeRange={visibleTimeRange}
                visiblePriceRange={visiblePriceRange}
                currentPrice={currentPrice}
            />
        </svg>
    )
}

// Memoize GridCanvas to prevent re-renders when props haven't meaningfully changed
export const GridCanvas = React.memo(GridCanvasInner, (prevProps, nextProps) => {
    // Always re-render if dimensions change
    if (prevProps.width !== nextProps.width || prevProps.height !== nextProps.height) {
        return false
    }

    // Always re-render if currentPrice changes (for price indicator)
    if (prevProps.currentPrice !== nextProps.currentPrice) {
        return false
    }

    // Re-render if viewport changes significantly
    if (
        prevProps.visibleTimeRange.start !== nextProps.visibleTimeRange.start ||
        prevProps.visibleTimeRange.end !== nextProps.visibleTimeRange.end ||
        prevProps.visiblePriceRange.min !== nextProps.visiblePriceRange.min ||
        prevProps.visiblePriceRange.max !== nextProps.visiblePriceRange.max
    ) {
        return false
    }

    // Re-render if selection or results change
    if (
        prevProps.selectedCells !== nextProps.selectedCells ||
        prevProps.betResults !== nextProps.betResults ||
        prevProps.cellStakes !== nextProps.cellStakes ||
        prevProps.multipliers !== nextProps.multipliers ||
        prevProps.contestEndTime !== nextProps.contestEndTime
    ) {
        return false
    }

    // Re-render if cells or on-chain pool config changes
    if (prevProps.cells !== nextProps.cells || prevProps.pool !== nextProps.pool) {
        return false
    }

    // Re-render if mouse position changes (for crosshair)
    if (
        prevProps.mousePos?.x !== nextProps.mousePos?.x ||
        prevProps.mousePos?.y !== nextProps.mousePos?.y ||
        prevProps.isDragging !== nextProps.isDragging
    ) {
        return false
    }

    // For prices, only re-render if array length changed significantly (new data loaded)
    // Small updates from WebSocket are handled by the price indicator via currentPrice
    if (Math.abs(prevProps.prices.length - nextProps.prices.length) > 10) {
        return false
    }

    // No significant changes - skip re-render
    return true
})
