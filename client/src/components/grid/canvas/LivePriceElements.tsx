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
    const extensionLineRef = useRef<SVGLineElement>(null)
    const extensionAreaRef = useRef<SVGPathElement>(null)

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

        </>
    )
}
