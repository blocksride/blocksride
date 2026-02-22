import React, { useMemo } from 'react'
import { Grid, Cell, CellPrice } from '../../../types/grid'

interface CellPricesMap {
    [cellId: string]: CellPrice
}

interface GridCellsProps {
    width: number
    height: number
    grid: Grid | null
    cells: Cell[]
    visibleTimeRange: { start: number; end: number }
    visiblePriceRange: { min: number; max: number }
    selectedCells: string[]
    betResults: Record<string, string>
    cellStakes?: Record<string, number>
    cellPrices?: CellPricesMap
    recentCellIds?: Record<string, boolean>
    frozenWindows?: number
    getX: (t: number) => number
    getY: (p: number) => number
    onCellClick: (cellId: string, isFuture: boolean, cellData?: unknown) => void
    onFrozenCellClick?: (windowIndex: number) => void
    contestEndTime?: number // Contest end time in ms (undefined = no restriction, e.g., practice mode)
}

export const GridCells: React.FC<GridCellsProps> = ({
    width,
    height,
    grid,
    cells,
    visibleTimeRange,
    visiblePriceRange,
    selectedCells,
    betResults,
    cellStakes,
    cellPrices,
    recentCellIds,
    frozenWindows = 2,
    getX,
    getY,
    onCellClick,
    onFrozenCellClick,
    contestEndTime,
}) => {
    const { start: viewportStart, end: viewportEnd } = visibleTimeRange
    const { min: visibleMinPrice, max: visibleMaxPrice } = visiblePriceRange
    const now = Date.now()

    const gridCells = useMemo(() => {
        if (!grid) return []

        const windowDuration = (grid.timeframe_sec || 60) * 1000
        const priceInterval = grid.price_interval || 1
        const anchorPrice = grid.anchor_price

        if (windowDuration <= 0 || priceInterval <= 0) return []

        const cellLookup = new Map<string, Cell>()
        cells.forEach((cell) => {
            const wIdx = cell.window_index
            const bIdx = cell.price_band_index
            cellLookup.set(`${wIdx}_${bIdx}`, cell)
        })

        const slots: {
            isReal: boolean
            id: string
            virtualId: string
            x: number
            y: number
            w: number
            h: number
            t: number
            p: number
            p_high: number
            t_end: number
            cellData?: Cell
        }[] = []

        const gridStartTime = new Date(grid.start_time).getTime()
        const timeOffset = gridStartTime % windowDuration
        const startWindowT =
            Math.floor((viewportStart - timeOffset) / windowDuration) *
            windowDuration +
            timeOffset

        const startBand = Math.floor(
            (visibleMinPrice - anchorPrice) / priceInterval
        )
        const startPrice = anchorPrice + startBand * priceInterval

        for (let t = startWindowT; t < viewportEnd; t += windowDuration) {
            const x = getX(t)
            const w = getX(t + windowDuration) - x

            if (x + w < 0 || x > width) continue

            const wi = Math.floor((t - gridStartTime) / windowDuration)

            for (let p = startPrice; p < visibleMaxPrice; p += priceInterval) {
                const y1 = getY(p + priceInterval)
                const y2 = getY(p)
                const h = y2 - y1

                if (y1 > height || y2 < 0) continue

                const bi = Math.round((p - anchorPrice) / priceInterval)

                const lookupKey = `${wi}_${bi}`
                const realCell = cellLookup.get(lookupKey)

                const virtualId = `future_${wi}_${bi}`

                if (realCell) {
                    slots.push({
                        isReal: true,
                        id: realCell.cell_id,
                        virtualId: virtualId,
                        x,
                        y: y1,
                        w,
                        h,
                        t,
                        p,
                        p_high: p + priceInterval,
                        t_end: t + windowDuration,
                        cellData: realCell,
                    })
                } else {
                    slots.push({
                        isReal: false,
                        id: virtualId,
                        virtualId: virtualId,
                        x,
                        y: y1,
                        w,
                        h,
                        t,
                        p,
                        p_high: p + priceInterval,
                        t_end: t + windowDuration,
                    })
                }
            }
        }
        return slots
    }, [
        grid,
        cells,
        viewportStart,
        viewportEnd,
        visibleMinPrice,
        visibleMaxPrice,
        width,
        height,
        getX,
        getY,
    ])

    // Check if we need to show the past indicator (cells before current time)
    const isPastCell = (slotTime: number) => slotTime + ((grid?.timeframe_sec || 60) * 1000) < now

    return (
        <>
            {/* Define pattern for locked cells */}
            <defs>
                <pattern id="frozenPattern" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(113, 113, 122, 0.2)" strokeWidth="1" />
                </pattern>
                <pattern id="contestEndedPattern" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(239, 68, 68, 0.15)" strokeWidth="2" />
                </pattern>
            </defs>

            {gridCells.map((slot) => {
                const isSelected =
                    selectedCells.includes(slot.id) ||
                    selectedCells.includes(slot.virtualId)

                // Calculate window index and check if frozen
                const gridStartTime = grid ? new Date(grid.start_time).getTime() : 0
                const windowDuration = (grid?.timeframe_sec || 60) * 1000
                const currentWindowIndex = Math.floor((now - gridStartTime) / windowDuration)
                const windowIndex = Math.floor((slot.t - gridStartTime) / windowDuration)

                // Window is frozen if it's within frozenWindows count from current
                const isFrozen = windowIndex <= currentWindowIndex + frozenWindows
                const isPast = isPastCell(slot.t)
                // Cell is after contest end if its end time extends beyond contest end time
                const isAfterContestEnd = contestEndTime !== undefined && slot.t_end > contestEndTime
                const isPlayable = !isFrozen && !isSelected && !isAfterContestEnd

                const status = betResults[slot.id] || betResults[slot.virtualId]
                const isResolving = status === 'pending' && now > slot.t_end
                const isRecent = Boolean(recentCellIds?.[slot.id] || recentCellIds?.[slot.virtualId])

                let className = "fill-transparent stroke-transparent transition-colors duration-200"

                // Determine cursor
                let cursor = 'default'
                if (isSelected) {
                    cursor = 'not-allowed'
                } else if (isFrozen) {
                    cursor = 'not-allowed'
                } else if (isAfterContestEnd) {
                    cursor = 'not-allowed'
                } else if (isPlayable) {
                    cursor = 'pointer'
                }

                const style: React.CSSProperties = { cursor }

                const liveStake = cellStakes ? (cellStakes[slot.id] || 0) : 0
                const staticStake = slot.cellData?.total_stake || 0
                const currentTotalStake = Math.max(liveStake, staticStake)

                // Track if this is a frozen cell without user bet (for special rendering)
                let isFrozenNoUserBet = false
                // Track if this cell is after contest end (for special rendering)
                let isContestEndedCell = false

                // User's bets always show their status regardless of frozen state
                if (isResolving) {
                    className = "fill-yellow-500/20 stroke-yellow-500 animate-pulse"
                } else if (status) {
                    if (status === 'won') {
                        className = "fill-trade-up/40 stroke-trade-up stroke-2 animate-cell-glow"
                    } else if (status === 'lost') {
                        className = "fill-trade-down/20 stroke-trade-down/50 opacity-70"
                    } else if (status === 'winning') {
                        className = "fill-trade-up/50 stroke-trade-up stroke-2 animate-pulse"
                    } else {
                        className = "fill-primary/30 stroke-primary"
                    }
                } else if (isSelected) {
                    className = "fill-primary/30 stroke-primary"
                } else if (isAfterContestEnd) {
                    isContestEndedCell = true
                    // Will use special rendering below for cells beyond contest end
                } else if (isFrozen) {
                    isFrozenNoUserBet = true
                    // Will use special rendering below
                } else if (currentTotalStake > 0) {
                    const maxStake = 1000
                    const intensity = Math.min(1, Math.log10(currentTotalStake + 1) / Math.log10(maxStake + 1))
                    style.fill = `rgba(255, 140, 0, ${intensity * 0.5})`
                    style.stroke = `rgba(255, 140, 0, ${Math.min(1, intensity + 0.2)})`
                    className = "transition-colors duration-500"
                }

                if (isRecent && !status && !isResolving) {
                    className = `${className} animate-cell-pulse`
                }

                const rectX = slot.x
                const rectY = Math.min(slot.y, slot.y + slot.h)
                const rectW = Math.max(0, slot.w)
                const rectH = Math.max(0, slot.h)

                // For frozen cells without user bets, render a cleaner locked appearance
                if (isFrozenNoUserBet) {
                    // Past cells: minimal appearance, no grid lines, just show bets if any
                    if (isPast) {
                        return (
                            <g key={slot.id} style={{ cursor: 'default' }}>
                                {/* Very subtle dark overlay for past */}
                                <rect
                                    x={rectX}
                                    y={rectY}
                                    width={rectW}
                                    height={rectH}
                                    fill="rgba(0, 0, 0, 0.3)"
                                />
                                {/* Show stake if any */}
                                {currentTotalStake > 0 && (
                                    <text
                                        x={rectX + rectW / 2}
                                        y={rectY + rectH / 2}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        className="text-[9px] font-mono fill-zinc-600 pointer-events-none select-none"
                                    >
                                        ${currentTotalStake >= 1000
                                            ? currentTotalStake.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
                                            : currentTotalStake.toFixed(0)}
                                    </text>
                                )}
                            </g>
                        )
                    }

                    // Locked (upcoming) cells: minimal styling, FrozenZoneMask handles overlay
                    return (
                        <g key={slot.id} style={{ cursor: 'not-allowed' }}>
                            {/* Subtle diagonal lines pattern only */}
                            <rect
                                x={rectX}
                                y={rectY}
                                width={rectW}
                                height={rectH}
                                fill="url(#frozenPattern)"
                                className="transition-opacity duration-300"
                            />
                            {/* Show stake if any */}
                            {currentTotalStake > 0 && (
                                <text
                                    x={rectX + rectW / 2}
                                    y={rectY + rectH / 2}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    className="text-[9px] font-mono fill-zinc-500 pointer-events-none select-none"
                                >
                                    ${currentTotalStake >= 1000
                                        ? currentTotalStake.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
                                        : currentTotalStake.toFixed(0)}
                                </text>
                            )}
                            {/* Click handler */}
                            <rect
                                x={rectX}
                                y={rectY}
                                width={rectW}
                                height={rectH}
                                fill="transparent"
                                onClick={() => {
                                    if (onFrozenCellClick) {
                                        onFrozenCellClick(windowIndex)
                                    }
                                }}
                            />
                        </g>
                    )
                }

                // Cells after contest end: distinct locked appearance with red-tinted pattern
                if (isContestEndedCell) {
                    return (
                        <g key={slot.id} style={{ cursor: 'not-allowed' }}>
                            {/* Dark overlay with red-tinted diagonal pattern */}
                            <rect
                                x={rectX}
                                y={rectY}
                                width={rectW}
                                height={rectH}
                                fill="rgba(0, 0, 0, 0.4)"
                            />
                            <rect
                                x={rectX}
                                y={rectY}
                                width={rectW}
                                height={rectH}
                                fill="url(#contestEndedPattern)"
                                className="transition-opacity duration-300"
                            />
                            {/* Border to indicate locked state */}
                            <rect
                                x={rectX}
                                y={rectY}
                                width={rectW}
                                height={rectH}
                                fill="transparent"
                                stroke="rgba(239, 68, 68, 0.2)"
                                strokeWidth={1}
                            />
                        </g>
                    )
                }

                const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
                const touchPadding = isMobile ? 4 : 0

                // Get cell price info for playable cells
                const cellPrice = cellPrices?.[slot.id]
                const probability = cellPrice?.probability
                // Add bounds: min probability 0.1% to avoid Infinity, max multiplier 100x
                const multiplier = probability && probability > 0.001 ? Math.min(1 / probability, 100) : null
                const showPricing = isPlayable && probability && multiplier && rectW > 30 && rectH > 24

                return (
                    <g key={slot.id}>
                        <rect
                            x={rectX - touchPadding}
                            y={rectY - touchPadding}
                            width={rectW + touchPadding * 2}
                            height={rectH + touchPadding * 2}
                            className={className}
                            strokeWidth={isSelected || isResolving ? 2 : 1}
                            style={style}
                            onClick={() => {
                                // Haptic feedback on mobile
                                if (isMobile && 'vibrate' in navigator && isPlayable) {
                                    navigator.vibrate(10)
                                }

                                if (isFrozen && !isSelected && onFrozenCellClick) {
                                    onFrozenCellClick(windowIndex)
                                } else if (isPlayable) {
                                    if (slot.isReal) {
                                        onCellClick(slot.id, false, slot.cellData)
                                    } else {
                                        onCellClick(slot.id, true, {
                                            t_start: new Date(slot.t).toISOString(),
                                            t_end: new Date(slot.t_end).toISOString(),
                                            p_low: slot.p,
                                            p_high: slot.p_high,
                                        })
                                    }
                                }
                            }}
                        />
                        {/* Show probability and multiplier for playable cells */}
                        {showPricing && (
                            <>
                                <text
                                    x={rectX + rectW / 2}
                                    y={rectY + rectH / 2 - 6}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    className="text-[9px] font-mono fill-primary/80 pointer-events-none select-none"
                                >
                                    {(probability * 100).toFixed(0)}%
                                </text>
                                <text
                                    x={rectX + rectW / 2}
                                    y={rectY + rectH / 2 + 6}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    className="text-[10px] font-mono font-bold fill-trade-up pointer-events-none select-none"
                                >
                                    {multiplier.toFixed(1)}x
                                </text>
                            </>
                        )}
                        {/* Show stake if any (takes priority over pricing display) */}
                        {currentTotalStake > 0 && !showPricing && (
                            <text
                                x={rectX + rectW / 2}
                                y={rectY + rectH / 2}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="text-[10px] font-mono font-bold fill-foreground/90 pointer-events-none select-none drop-shadow-md"
                            >
                                ${currentTotalStake >= 1000
                                    ? currentTotalStake.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
                                    : currentTotalStake.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </text>
                        )}
                    </g>
                )
            })}
        </>
    )
}
