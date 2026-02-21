import { useState, useEffect } from 'react'

interface Dimensions {
    width: number
    height: number
}

interface TimeBoundary {
    start: number // Contest start time in ms
    end: number   // Contest end time in ms
}

export function useGridViewport(
    currentPrice: number | null,
    selectedTimeframe: number,
    containerRef: React.RefObject<HTMLDivElement>,
    interactive: boolean = true,
    priceInterval: number = 5, // Grid's price interval for cell sizing
    anchorPrice: number | null = null, // Grid's anchor price for fixed centering
    timeBoundary: TimeBoundary | null = null // Contest time boundaries (null = no restriction, e.g., practice mode)
) {
    const [viewportTimeRange, setViewportTimeRange] = useState(10 * 60 * 1000) // 10 minutes default
    const [viewportCenterTime, setViewportCenterTime] = useState<number | null>(
        null
    )
    // Default to showing ~10 price bands - user can pan to see more
    const [viewportPriceRange, setViewportPriceRange] = useState(() => Math.max(10, priceInterval * 10))
    const [viewportCenterPrice, setViewportCenterPrice] = useState<number | null>(
        null
    )

    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, hasMoved: false })
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
        null
    )
    const [dimensions, setDimensions] = useState<Dimensions>({
        width: 0,
        height: 600,
    })
    const [pinchState, setPinchState] = useState<{
        active: boolean
        initialDistance: number
        initialTimeRange: number
        initialPriceRange: number
    } | null>(null)

    // Use ref for continuous time tracking, only update state every 5 seconds
    // This prevents re-renders every second while still keeping viewport in sync
    const [nowTick, setNowTick] = useState(Date.now())
    useEffect(() => {
        const interval = setInterval(() => setNowTick(Date.now()), 5000)
        return () => clearInterval(interval)
    }, [])

    const now = nowTick
    const centerTime = viewportCenterTime ?? now
    // Use current price for initial centering so the chart is visible, fall back to anchor price
    const centerPrice = viewportCenterPrice ?? (currentPrice || anchorPrice || 3000)

    // Clamp center time to contest boundaries if set
    const clampedCenterTime = timeBoundary
        ? Math.max(
            timeBoundary.start + viewportTimeRange / 2,
            Math.min(timeBoundary.end - viewportTimeRange / 2, centerTime)
          )
        : centerTime

    const visibleStart = clampedCenterTime - viewportTimeRange / 2
    const visibleEnd = clampedCenterTime + viewportTimeRange / 2
    const visibleMinPrice = centerPrice - viewportPriceRange / 2
    const visibleMaxPrice = centerPrice + viewportPriceRange / 2

    // Helper to clamp time within boundaries
    const clampTime = (time: number): number => {
        if (!timeBoundary) return time
        const minCenter = timeBoundary.start + viewportTimeRange / 2
        const maxCenter = timeBoundary.end - viewportTimeRange / 2
        return Math.max(minCenter, Math.min(maxCenter, time))
    }

    useEffect(() => {
        // Show 10x the timeframe (e.g., 60 sec timeframe = 10 minutes visible)
        setViewportTimeRange(selectedTimeframe * 10 * 1000)
        // Show ~10 price bands - user can pan to see more
        const idealRange = Math.max(10, priceInterval * 10)
        setViewportPriceRange(idealRange)
        setViewportCenterTime(null)
        setViewportCenterPrice(null)
    }, [selectedTimeframe, priceInterval])

    useEffect(() => {
        if (!containerRef.current) return
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect
                setDimensions((prev) => {
                    if (prev.width === width && prev.height === height) return prev
                    return { width, height }
                })
            }
        })
        resizeObserver.observe(containerRef.current)
        return () => resizeObserver.disconnect()
    }, [containerRef])

    useEffect(() => {
        if (!interactive) return
        const container = containerRef.current
        if (!container) return
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault()
            if (e.ctrlKey || e.metaKey) {
                const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9
                setViewportTimeRange((prev) =>
                    Math.max(30000, Math.min(24 * 60 * 60 * 1000, prev * zoomFactor))
                )
                // Min zoom: show at least 10 bands, Max zoom: show up to 100 bands
                const minPriceRange = Math.max(10, priceInterval * 10)
                const maxPriceRange = Math.max(200, priceInterval * 100)
                setViewportPriceRange((prev) =>
                    Math.max(minPriceRange, Math.min(maxPriceRange, prev * zoomFactor))
                )
                if (viewportCenterTime === null) setViewportCenterTime(now)
                if (viewportCenterPrice === null)
                    setViewportCenterPrice(currentPrice || anchorPrice || 3000)
            } else {
                // Scroll: shift+wheel for horizontal, regular wheel for vertical
                if (e.shiftKey) {
                    const timeDelta = (e.deltaY / 100) * viewportTimeRange * 0.1
                    setViewportCenterTime(clampTime(clampedCenterTime + timeDelta))
                } else {
                    // Vertical scrolling - move price range
                    const priceDelta = (e.deltaY / 100) * viewportPriceRange * 0.1
                    if (viewportCenterPrice === null) {
                        setViewportCenterPrice((currentPrice || anchorPrice || 3000) + priceDelta)
                    } else {
                        setViewportCenterPrice(centerPrice + priceDelta)
                    }
                }
            }
        }
        container.addEventListener('wheel', handleWheel, { passive: false })

        return () => container.removeEventListener('wheel', handleWheel)
    }, [
        containerRef,
        viewportTimeRange,
        viewportPriceRange,
        viewportCenterTime,
        viewportCenterPrice,
        currentPrice,
        anchorPrice,
        now,
        centerTime,
        centerPrice,
        interactive,
        priceInterval
    ])

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true)
        setDragStart({ x: e.clientX, y: e.clientY, hasMoved: false })
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        }
        if (!isDragging) return

        const deltaX = Math.abs(e.clientX - dragStart.x)
        const deltaY = Math.abs(e.clientY - dragStart.y)

        if ((deltaX > 5 || deltaY > 5) && !dragStart.hasMoved) {
            setDragStart((prev) => ({ ...prev, hasMoved: true }))
        }

        if (dragStart.hasMoved) {
            // Horizontal dragging - move time
            const timeDelta =
                -((e.clientX - dragStart.x) / dimensions.width) * viewportTimeRange
            setViewportCenterTime(clampTime(clampedCenterTime + timeDelta))

            // Vertical dragging - move price
            const priceDelta =
                ((e.clientY - dragStart.y) / dimensions.height) * viewportPriceRange
            if (viewportCenterPrice === null) {
                setViewportCenterPrice((currentPrice || anchorPrice || 3000) + priceDelta)
            } else {
                setViewportCenterPrice(centerPrice + priceDelta)
            }

            setDragStart({ x: e.clientX, y: e.clientY, hasMoved: true })
        }
    }

    const handleMouseUp = () => {
        setIsDragging(false)
        // Reset hasMoved to allow clicks after dragging
        setDragStart(prev => ({ ...prev, hasMoved: false }))
    }
    const handleMouseLeave = () => {
        setIsDragging(false)
        setMousePos(null)
        // Reset hasMoved when mouse leaves
        setDragStart(prev => ({ ...prev, hasMoved: false }))
    }


    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            // Pinch zoom
            const touch1 = e.touches[0]
            const touch2 = e.touches[1]
            const distance = Math.hypot(
                touch1.clientX - touch2.clientX,
                touch1.clientY - touch2.clientY
            )
            setPinchState({
                active: true,
                initialDistance: distance,
                initialTimeRange: viewportTimeRange,
                initialPriceRange: viewportPriceRange,
            })
            setIsDragging(false)
        } else if (e.touches.length === 1) {
            setIsDragging(true)
            setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY, hasMoved: false })
            setPinchState(null)
        }
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        if (pinchState?.active && e.touches.length === 2) {
            // Pinch zoom
            const touch1 = e.touches[0]
            const touch2 = e.touches[1]
            const currentDistance = Math.hypot(
                touch1.clientX - touch2.clientX,
                touch1.clientY - touch2.clientY
            )

            const scale = pinchState.initialDistance / currentDistance

            // Apply zoom with constraints
            const newTimeRange = Math.max(
                30000, // Min 30 seconds
                Math.min(24 * 60 * 60 * 1000, pinchState.initialTimeRange * scale) // Max 24 hours
            )
            const newPriceRange = Math.max(
                Math.max(10, priceInterval * 10), // Min 10x price interval
                Math.min(Math.max(200, priceInterval * 100), pinchState.initialPriceRange * scale)
            )

            setViewportTimeRange(newTimeRange)
            setViewportPriceRange(newPriceRange)

            // Lock center during pinch
            if (viewportCenterTime === null) setViewportCenterTime(now)
            if (viewportCenterPrice === null) setViewportCenterPrice(currentPrice || anchorPrice || 3000)

        } else if (isDragging && e.touches.length === 1) {
            const touch = e.touches[0]
            const deltaX = Math.abs(touch.clientX - dragStart.x)
            const deltaY = Math.abs(touch.clientY - dragStart.y)

            if ((deltaX > 5 || deltaY > 5) && !dragStart.hasMoved) {
                setDragStart((prev) => ({ ...prev, hasMoved: true }))
            }

            if (dragStart.hasMoved) {
                // Horizontal dragging - move time
                const timeDelta =
                    -((touch.clientX - dragStart.x) / dimensions.width) * viewportTimeRange
                setViewportCenterTime(clampTime(clampedCenterTime + timeDelta))

                // Vertical dragging - move price
                const priceDelta =
                    ((touch.clientY - dragStart.y) / dimensions.height) * viewportPriceRange
                if (viewportCenterPrice === null) {
                    setViewportCenterPrice((currentPrice || anchorPrice || 3000) + priceDelta)
                } else {
                    setViewportCenterPrice(centerPrice + priceDelta)
                }

                setDragStart({ x: touch.clientX, y: touch.clientY, hasMoved: true })
            }
        }
    }

    const handleTouchEnd = () => {
        setIsDragging(false)
        setPinchState(null)
        // Reset hasMoved to allow taps after dragging
        setDragStart(prev => ({ ...prev, hasMoved: false }))
    }

    const resetViewport = () => {
        setViewportCenterTime(null)
        setViewportCenterPrice(null)
        setViewportTimeRange(selectedTimeframe * 10 * 1000)
        setViewportPriceRange(Math.max(10, priceInterval * 10))
    }

    return {
        viewportTimeRange,
        viewportPriceRange,
        viewportCenterTime,
        viewportCenterPrice,
        setViewportCenterTime,
        setViewportCenterPrice,
        setViewportTimeRange,
        setViewportPriceRange,
        visibleStart,
        visibleEnd,
        visibleMinPrice,
        visibleMaxPrice,
        dimensions,
        isDragging,
        dragStart,
        mousePos,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleMouseLeave,
        handleTouchStart,
        handleTouchMove,
        handleTouchEnd,
        resetViewport,
        timeBoundary, // Expose for grid rendering
    }
}
