import React, { useRef, useEffect } from 'react'

interface FrozenZoneMaskProps {
    width: number
    height: number
    viewportStart: number
    viewportEnd: number
    gridStartTime: number
    windowDuration: number
    frozenWindows: number
}

// Animated overlay that smoothly shows the frozen zone boundary
export const FrozenZoneMask: React.FC<FrozenZoneMaskProps> = ({
    width,
    height,
    viewportStart,
    viewportEnd,
    gridStartTime,
    windowDuration,
    frozenWindows,
}) => {
    const overlayRef = useRef<SVGRectElement>(null)
    const lineRef = useRef<SVGLineElement>(null)

    const paramsRef = useRef({
        width,
        height,
        viewportStart,
        viewportEnd,
        gridStartTime,
        windowDuration,
        frozenWindows,
    })

    useEffect(() => {
        paramsRef.current = {
            width,
            height,
            viewportStart,
            viewportEnd,
            gridStartTime,
            windowDuration,
            frozenWindows,
        }
    }, [width, height, viewportStart, viewportEnd, gridStartTime, windowDuration, frozenWindows])

    useEffect(() => {
        let animationId: number

        const animate = () => {
            const {
                width: w,
                viewportStart: vStart,
                viewportEnd: vEnd,
                gridStartTime: gStart,
                windowDuration: wDuration,
                frozenWindows: fWindows,
            } = paramsRef.current

            const now = Date.now()
            const viewportDuration = vEnd - vStart

            // Calculate the frozen boundary time
            // Frozen windows are: current window + frozenWindows ahead
            const currentWindowIndex = Math.floor((now - gStart) / wDuration)
            const frozenBoundaryTime = gStart + (currentWindowIndex + fWindows + 1) * wDuration

            // Convert to X position
            const getX = (t: number) => ((t - vStart) / viewportDuration) * w
            const boundaryX = getX(frozenBoundaryTime)

            // Update the overlay rect (covers frozen area)
            if (overlayRef.current) {
                // The frozen area is from the left edge to the boundary
                const overlayWidth = Math.max(0, Math.min(boundaryX, w))
                overlayRef.current.setAttribute('width', String(overlayWidth))
            }

            // Update the boundary line
            if (lineRef.current) {
                lineRef.current.setAttribute('x1', String(boundaryX))
                lineRef.current.setAttribute('x2', String(boundaryX))
                // Only show line if it's within viewport
                lineRef.current.style.display = (boundaryX > 0 && boundaryX < w) ? '' : 'none'
            }

            animationId = requestAnimationFrame(animate)
        }

        animationId = requestAnimationFrame(animate)

        return () => {
            cancelAnimationFrame(animationId)
        }
    }, [])

    return (
        <>
            {/* Subtle overlay for frozen zone - just a tint, cells handle their own styling */}
            <rect
                ref={overlayRef}
                x={0}
                y={0}
                width={0}
                height={height}
                fill="rgba(234, 179, 8, 0.02)"
                pointerEvents="none"
            />
            {/* Animated boundary line */}
            <line
                ref={lineRef}
                x1={0}
                x2={0}
                y1={0}
                y2={height}
                stroke="rgba(234, 179, 8, 0.3)"
                strokeWidth="2"
                strokeDasharray="4 4"
                pointerEvents="none"
            />
        </>
    )
}
