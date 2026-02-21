import React, { useMemo } from 'react'
import { Grid } from '../../../types/grid'
import { PricePoint } from '../../../types/grid'

interface PriceChartProps {
    width: number
    height: number
    prices: PricePoint[]
    grid: Grid | null
    visibleTimeRange: { start: number; end: number }
    visiblePriceRange: { min: number; max: number }
    getX: (t: number) => number
    getY: (p: number) => number
}

export const PriceChart: React.FC<PriceChartProps> = ({
    width,
    height,
    prices,
    grid,
    visibleTimeRange,
    getX,
    getY,
}) => {
    const { start: viewportStart, end: viewportEnd } = visibleTimeRange

    const viewportDuration = viewportEnd - viewportStart

    // Only render historical price data - live extension is handled by LivePriceElements
    const polylinePoints = useMemo(() => {
        if (prices.length === 0) return ''
        const bufferTime = viewportDuration * 0.5
        const visiblePrices = prices.filter(
            (p) =>
                p.time >= viewportStart - bufferTime &&
                p.time <= viewportEnd + bufferTime
        )

        // Build points string - no extension to "now"
        const points = visiblePrices
            .map((p) => `${getX(p.time)},${getY(p.price)}`)
            .join(' ')

        return points
    }, [
        prices,
        viewportStart,
        viewportEnd,
        viewportDuration,
        getX,
        getY,
    ])

    // Only render historical area - live extension is handled by LivePriceElements
    const areaPath = useMemo(() => {
        if (prices.length === 0) return ''

        const bufferTime = viewportDuration * 0.5
        const visiblePrices = prices.filter(
            (p) =>
                p.time >= viewportStart - bufferTime &&
                p.time <= viewportEnd + bufferTime
        )

        if (visiblePrices.length === 0) return ''

        const first = visiblePrices[0]
        const last = visiblePrices[visiblePrices.length - 1]
        const bottomY = height

        let path = `M ${getX(first.time)} ${bottomY} L ${getX(first.time)} ${getY(first.price)} `

        visiblePrices.forEach((p) => {
            path += `L ${getX(p.time)} ${getY(p.price)} `
        })

        // Close path at last historical price point - no extension to "now"
        path += `L ${getX(last.time)} ${bottomY} Z`

        return path
    }, [
        prices,
        viewportStart,
        viewportEnd,
        viewportDuration,
        height,
        getX,
        getY,
    ])

    return (
        <>
            <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" className="text-primary" stopColor="currentColor" stopOpacity="0.2" />
                    <stop offset="100%" className="text-primary" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>

            { }
            {grid && (
                <line
                    x1={0}
                    y1={getY(grid.anchor_price)}
                    x2={width}
                    y2={getY(grid.anchor_price)}
                    className="stroke-muted-foreground/50"
                    strokeDasharray="2 2"
                    strokeWidth="1"
                />
            )}

            { }
            <path d={areaPath} fill="url(#chartGradient)" />
            <polyline
                points={polylinePoints}
                fill="none"
                className="stroke-primary"
                strokeWidth="2"
                strokeLinejoin="round"
            />
        </>
    )
}
