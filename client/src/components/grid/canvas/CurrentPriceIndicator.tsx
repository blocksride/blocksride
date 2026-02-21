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
                strokeDasharray="2 2"
                opacity="0.8"
            />
            {/* Price label on the right */}
            <g transform={`translate(${width - 55}, ${getY(currentPrice) - 11})`}>
                <path
                    d="M0 2C0 0.895431 0.895431 0 2 0H55V22H2C0.895431 22 0 21.1046 0 20V2Z"
                    className="fill-primary"
                />
                <text
                    x="27.5"
                    y="15"
                    className="fill-primary-foreground"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="bold"
                    style={{ fontFamily: 'monospace' }}
                >
                    {currentPrice.toFixed(2)}
                </text>
            </g>
        </>
    )
}
