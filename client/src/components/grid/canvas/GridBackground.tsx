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
          </React.Fragment>
        )
      })}
    </>
  )
}
