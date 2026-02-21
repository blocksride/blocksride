import React from 'react'

interface GridBackgroundProps {
  width: number
  height: number
  timeSteps: number[]
  priceSteps: number[]
  getX: (t: number) => number
  getY: (p: number) => number
}

export const GridBackground: React.FC<GridBackgroundProps> = ({
  width,
  height,
  timeSteps,
  priceSteps,
  getX,
  getY,
}) => {
  return (
    <>
      { }
      {timeSteps.map((t) => {
        const x = getX(t)
        if (!isFinite(x)) return null
        return (
          <React.Fragment key={`vt-${t}`}>
            <line
              x1={x}
              y1={0}
              x2={x}
              y2={height}
              className="stroke-foreground/20"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            {height > 20 && (
              <text
                x={x + 5}
                y={height - 10}
                fontSize="10"
                className="fill-foreground font-mono font-bold"
              >
                {new Date(t).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}
              </text>
            )}
          </React.Fragment>
        )
      })}

      { }
      {priceSteps.map((p) => {
        const y = getY(p)
        if (!isFinite(y)) return null
        return (
          <React.Fragment key={`hp-${p}`}>
            <line
              x1={0}
              y1={y}
              x2={width}
              y2={y}
              className="stroke-foreground/20"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            {width > 40 && (
              <text
                x={width - 8}
                y={y - 5}
                fontSize="10"
                textAnchor="end"
                className="fill-foreground font-mono font-bold"
              >
                {p.toFixed(2)}
              </text>
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}
