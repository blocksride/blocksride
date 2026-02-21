import React from 'react'

interface CrosshairProps {
    width: number
    height: number
    mousePos: { x: number; y: number } | null
    isDragging: boolean
    visibleTimeRange: { start: number; end: number }
    visiblePriceRange: { min: number; max: number }
    currentPrice: number | null
}

export const Crosshair: React.FC<CrosshairProps> = ({
    width,
    height,
    mousePos,
    isDragging,
    visibleTimeRange,
    visiblePriceRange,
    currentPrice,
}) => {
    if (!mousePos || isDragging || !currentPrice) return null

    const { start: viewportStart, end: viewportEnd } = visibleTimeRange
    const { min: visibleMinPrice, max: visibleMaxPrice } = visiblePriceRange

    const viewportDuration = viewportEnd - viewportStart
    const visiblePriceDiff = visibleMaxPrice - visibleMinPrice

    // Calculate Y position based on current price instead of mouse
    const priceY = height - ((currentPrice - visibleMinPrice) / visiblePriceDiff) * height

    return (
        <g pointerEvents="none">
            <line
                x1={mousePos.x}
                x2={mousePos.x}
                y1={0}
                y2={height}
                className="stroke-muted-foreground"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.8"
            />
            <line
                x1={0}
                x2={width}
                y1={priceY}
                y2={priceY}
                className="stroke-muted-foreground"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.8"
            />
            { /* Time label */}
            <g transform={`translate(${mousePos.x - 28}, ${height - 20})`}>
                <rect width="56" height="20" rx="3" className="fill-secondary" />
                <text
                    x="28"
                    y="14"
                    className="fill-secondary-foreground"
                    textAnchor="middle"
                    fontSize="10"
                    style={{ fontFamily: 'monospace' }}
                >
                    {(() => {
                        const t = viewportStart + (mousePos.x / width) * viewportDuration
                        return new Date(t).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                        })
                    })()}
                </text>
            </g>
            { /* Price label - now shows current price */}
            <g transform={`translate(${width - 55}, ${priceY - 10})`}>
                <rect width="55" height="20" rx="3" className="fill-secondary" />
                <text
                    x="27.5"
                    y="14"
                    className="fill-secondary-foreground"
                    textAnchor="middle"
                    fontSize="10"
                    style={{ fontFamily: 'monospace' }}
                >
                    {currentPrice.toFixed(2)}
                </text>
            </g>
        </g>
    )
}
