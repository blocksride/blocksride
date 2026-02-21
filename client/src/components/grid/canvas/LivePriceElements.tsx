import React, { useRef, useEffect } from 'react'
import { PricePoint } from '../../../types/grid'

interface LivePriceElementsProps {
    width: number
    height: number
    viewportStart: number
    viewportEnd: number
    visibleMinPrice: number
    visibleMaxPrice: number
    lastPricePoint: PricePoint | null
    currentPrice: number | null
}

export const LivePriceElements: React.FC<LivePriceElementsProps> = ({
    width,
    height,
    viewportStart,
    viewportEnd,
    visibleMinPrice,
    visibleMaxPrice,
    lastPricePoint,
    currentPrice,
}) => {
    const nowLineRef = useRef<SVGLineElement>(null)
    const circleRef = useRef<SVGCircleElement>(null)
    const extensionLineRef = useRef<SVGLineElement>(null)
    const extensionAreaRef = useRef<SVGPathElement>(null)
    const timeLabelGroupRef = useRef<SVGGElement>(null)
    const timeLabelTextRef = useRef<SVGTextElement>(null)

    // Store viewport params in refs to avoid recreating RAF callback
    const paramsRef = useRef({
        width,
        height,
        viewportStart,
        viewportEnd,
        visibleMinPrice,
        visibleMaxPrice,
        lastPricePoint,
        currentPrice,
    })

    // Update params ref when props change
    useEffect(() => {
        paramsRef.current = {
            width,
            height,
            viewportStart,
            viewportEnd,
            visibleMinPrice,
            visibleMaxPrice,
            lastPricePoint,
            currentPrice,
        }
    }, [width, height, viewportStart, viewportEnd, visibleMinPrice, visibleMaxPrice, lastPricePoint, currentPrice])

    useEffect(() => {
        let animationId: number

        const animate = () => {
            const {
                width: w,
                height: h,
                viewportStart: vStart,
                viewportEnd: vEnd,
                visibleMinPrice: minP,
                visibleMaxPrice: maxP,
                lastPricePoint: lastPoint,
                currentPrice: curPrice,
            } = paramsRef.current

            const now = Date.now()
            const viewportDuration = vEnd - vStart
            const visiblePriceDiff = maxP - minP

            // Calculate X position for current time
            const getX = (t: number) => ((t - vStart) / viewportDuration) * w
            const getY = (p: number) => h - ((p - minP) / visiblePriceDiff) * h

            const nowX = getX(now)
            const priceY = curPrice !== null ? getY(curPrice) : null

            // Update vertical "now" line
            if (nowLineRef.current) {
                nowLineRef.current.setAttribute('x1', String(nowX))
                nowLineRef.current.setAttribute('x2', String(nowX))
            }

            // Update circle at intersection
            if (circleRef.current && priceY !== null) {
                circleRef.current.setAttribute('cx', String(nowX))
                circleRef.current.setAttribute('cy', String(priceY))
                circleRef.current.style.display = ''
            } else if (circleRef.current) {
                circleRef.current.style.display = 'none'
            }

            // Update extension line from last price point to now
            if (extensionLineRef.current && lastPoint && curPrice !== null) {
                const lastX = getX(lastPoint.time)
                const lastY = getY(lastPoint.price)
                extensionLineRef.current.setAttribute('x1', String(lastX))
                extensionLineRef.current.setAttribute('y1', String(lastY))
                extensionLineRef.current.setAttribute('x2', String(nowX))
                extensionLineRef.current.setAttribute('y2', String(priceY!))
                extensionLineRef.current.style.display = ''
            } else if (extensionLineRef.current) {
                extensionLineRef.current.style.display = 'none'
            }

            // Update extension area fill
            if (extensionAreaRef.current && lastPoint && curPrice !== null) {
                const lastX = getX(lastPoint.time)
                const lastY = getY(lastPoint.price)
                const path = `M ${lastX} ${h} L ${lastX} ${lastY} L ${nowX} ${priceY} L ${nowX} ${h} Z`
                extensionAreaRef.current.setAttribute('d', path)
                extensionAreaRef.current.style.display = ''
            } else if (extensionAreaRef.current) {
                extensionAreaRef.current.style.display = 'none'
            }

            // Update time label
            if (timeLabelGroupRef.current && timeLabelTextRef.current) {
                const labelX = nowX - 28
                const labelY = h - 25
                timeLabelGroupRef.current.setAttribute('transform', `translate(${labelX}, ${labelY})`)

                const timeStr = new Date(now).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                })
                timeLabelTextRef.current.textContent = timeStr
            }

            animationId = requestAnimationFrame(animate)
        }

        animationId = requestAnimationFrame(animate)

        return () => {
            cancelAnimationFrame(animationId)
        }
    }, [])

    if (currentPrice === null) return null

    return (
        <>
            {/* Extension area fill - rendered first so it's behind the line */}
            <path
                ref={extensionAreaRef}
                fill="url(#chartGradient)"
            />

            {/* Extension line from last price point to now */}
            <line
                ref={extensionLineRef}
                className="stroke-primary"
                strokeWidth="2"
                strokeLinejoin="round"
            />

            {/* Vertical "now" line */}
            <line
                ref={nowLineRef}
                x1={0}
                x2={0}
                y1={0}
                y2={height}
                className="stroke-primary"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.8"
            />

            {/* Circle at current time/price intersection */}
            <circle
                ref={circleRef}
                cx={0}
                cy={0}
                r="4"
                className="fill-primary stroke-background"
                strokeWidth="1.5"
            />

            {/* Time label */}
            <g ref={timeLabelGroupRef} transform="translate(0, 0)">
                <rect width="56" height="20" rx="3" className="fill-primary" />
                <text
                    ref={timeLabelTextRef}
                    x="28"
                    y="14"
                    className="fill-primary-foreground"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="bold"
                    style={{ fontFamily: 'monospace' }}
                >
                    00:00:00
                </text>
            </g>
        </>
    )
}
