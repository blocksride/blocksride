import React from 'react'

interface BlocksrideLogoProps {
    /** Height of the mark in px. Width scales automatically (~1.6 ratio). */
    size?: number
    /** 'color' = amber mark (default), 'white' = all white, 'dark' = all #1C1915 */
    variant?: 'color' | 'white' | 'dark'
    /** Show the "blocksride" wordmark next to the mark */
    wordmark?: boolean
    className?: string
}

const AMBER   = '#D97706'
const AMBER_D = '#92400E'
const WHITE   = '#EDE8E0'
const DARK    = '#1C1915'

export const BlocksrideLogo: React.FC<BlocksrideLogoProps> = ({
    size = 32,
    variant = 'color',
    wordmark = false,
    className = '',
}) => {
    // Colour map per variant
    const body  = variant === 'color' ? AMBER   : variant === 'white' ? WHITE : DARK
    const axle  = variant === 'color' ? AMBER_D : variant === 'white' ? 'rgba(255,255,255,0.5)' : 'rgba(28,25,21,0.5)'
    const wheel = variant === 'color' ? AMBER   : variant === 'white' ? WHITE : DARK
    const line  = body

    // Mark viewBox is 96×60; derive width from height
    const markW = Math.round(size * (96 / 60))
    const markH = size

    // Wordmark font size relative to mark height
    const fontSize = Math.round(size * 0.52)

    return (
        <div className={`flex items-center gap-[0.5em] ${className}`} style={{ fontSize }}>
            {/* Mark */}
            <svg
                width={markW}
                height={markH}
                viewBox="0 0 96 60"
                fill="none"
                aria-hidden="true"
            >
                {/* Speed lines */}
                <line x1="2"  y1="20" x2="14" y2="20" stroke={line} strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
                <line x1="2"  y1="27" x2="10" y2="27" stroke={line} strokeWidth="2"   strokeLinecap="round" opacity="0.3"/>
                <line x1="2"  y1="34" x2="12" y2="34" stroke={line} strokeWidth="1.5" strokeLinecap="round" opacity="0.15"/>
                {/* Block body */}
                <rect x="16" y="8" width="64" height="30" rx="5" fill={body}/>
                {/* Axle */}
                <rect x="24" y="36" width="48" height="4" rx="2" fill={axle}/>
                {/* Left wheel */}
                <circle cx="32" cy="50" r="9" stroke={wheel} strokeWidth="3" fill="none"/>
                <circle cx="32" cy="50" r="2.5" fill={wheel}/>
                {/* Right wheel */}
                <circle cx="64" cy="50" r="9" stroke={wheel} strokeWidth="3" fill="none"/>
                <circle cx="64" cy="50" r="2.5" fill={wheel}/>
            </svg>

            {/* Optional wordmark */}
            {wordmark && (
                <span
                    style={{
                        fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: variant === 'white' ? WHITE : variant === 'dark' ? DARK : 'currentColor',
                        lineHeight: 1,
                    }}
                >
                    blocks
                    <span style={{ color: variant === 'dark' ? DARK : AMBER }}>ride</span>
                </span>
            )}
        </div>
    )
}
