import React from 'react'

interface CurrentPriceIndicatorProps {
    width: number
    currentPrice: number | null
    getY: (p: number) => number
}

// Static price indicator - only horizontal line and price label
// Time-dependent elements (vertical line, circle, time label) are in LivePriceElements
export const CurrentPriceIndicator: React.FC<CurrentPriceIndicatorProps> = ({
    width,
    currentPrice,
    getY,
}) => {
    if (!currentPrice) return null

    return (
        <>
            {/* Horizontal price line */}
            <line
                x1={0}
                x2={width}
                y1={getY(currentPrice)}
                y2={getY(currentPrice)}
                className="stroke-primary"
                strokeWidth="1"
                strokeDasharray="6 3"
                opacity="0.6"
            />
            {/* Dot on the y-axis */}
            <circle
                cx={0}
                cy={getY(currentPrice)}
                r={3.5}
                className="fill-primary"
                opacity="0.8"
            />
        </>
    )
}
