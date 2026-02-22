import React, { useEffect, useRef, useState } from 'react'

interface UndoToastProps {
    /** Amount staked, shown in the message */
    amount: number
    /** Price range label e.g. "$3,000–$3,002" */
    priceLabel?: string
    /** Milliseconds before auto-dismiss (default 3000) */
    duration?: number
    /** Called when user taps Undo within the window */
    onUndo: () => void
    /** Called when timer expires or is dismissed */
    onExpire: () => void
}

/**
 * Temporary "Bet placed – undo?" toast shown for `duration` ms after placement.
 * Features an SVG arc countdown ring that fills clockwise over the duration.
 * Calls onUndo() if the user taps "Undo" within the window.
 */
export const UndoToast: React.FC<UndoToastProps> = ({
    amount,
    priceLabel,
    duration = 3000,
    onUndo,
    onExpire,
}) => {
    const [ms, setMs] = useState(duration)
    const startRef = useRef<number>(Date.now())
    const rafRef = useRef<number>(0)
    const doneRef = useRef(false)

    useEffect(() => {
        const tick = () => {
            const elapsed = Date.now() - startRef.current
            const remaining = Math.max(0, duration - elapsed)
            setMs(remaining)
            if (remaining <= 0 && !doneRef.current) {
                doneRef.current = true
                onExpire()
                return
            }
            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafRef.current)
    }, [duration, onExpire])

    const handleUndo = () => {
        if (doneRef.current) return
        doneRef.current = true
        cancelAnimationFrame(rafRef.current)
        onUndo()
    }

    // SVG ring geometry
    const RADIUS = 11
    const CIRC = 2 * Math.PI * RADIUS
    const progress = 1 - ms / duration         // 0 → 1 as time passes
    const dashOffset = CIRC * (1 - progress)   // arc shrinks as time runs out
    const secondsLeft = Math.ceil(ms / 1000)

    return (
        <div
            role="status"
            aria-live="polite"
            className={[
                'fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50',
                'flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl',
                'bg-card border border-border/60 border-l-2 border-l-primary',
                'text-sm text-foreground font-mono',
                'animate-slide-up',
            ].join(' ')}
            style={{ minWidth: 260 }}
        >
            {/* Countdown ring */}
            <svg
                width="28" height="28" viewBox="0 0 28 28"
                className="shrink-0 -rotate-90"
                aria-hidden="true"
            >
                {/* Track */}
                <circle
                    cx="14" cy="14" r={RADIUS}
                    fill="none"
                    stroke="hsl(var(--border))"
                    strokeWidth="2.5"
                />
                {/* Progress arc */}
                <circle
                    cx="14" cy="14" r={RADIUS}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={CIRC}
                    strokeDashoffset={dashOffset}
                    style={{ transition: 'stroke-dashoffset 80ms linear' }}
                />
                {/* Centre digit — counter-rotated back to upright */}
                <text
                    x="14" y="14"
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{
                        transform: 'rotate(90deg)',
                        transformOrigin: '14px 14px',
                        fill: 'hsl(var(--primary))',
                        fontSize: '9px',
                        fontWeight: 700,
                        fontFamily: 'inherit',
                    }}
                >
                    {secondsLeft}
                </text>
            </svg>

            {/* Text */}
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="font-semibold text-foreground leading-tight">
                    {priceLabel
                        ? `Bet $${amount.toFixed(2)} on ${priceLabel}`
                        : `Bet $${amount.toFixed(2)}`}
                </span>
            </div>

            {/* Undo link */}
            <button
                onClick={handleUndo}
                className={[
                    'ml-1 shrink-0 text-primary text-xs font-bold',
                    'underline underline-offset-2 hover:text-primary/70 transition-colors',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded',
                ].join(' ')}
                aria-label="Undo bet placement"
            >
                Undo {secondsLeft}...
            </button>
        </div>
    )
}
