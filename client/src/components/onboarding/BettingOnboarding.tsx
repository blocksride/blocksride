import React, { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useOnboarding } from '@/contexts/OnboardingContext'
import {
    Target,
    MousePointerClick,
    Coins,
    Trophy,
    Zap,
    Terminal,
    ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Terminal-style grid visualization
const TerminalGrid = () => {
    const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)
    const [priceY, setPriceY] = useState(50)
    const [priceHistory, setPriceHistory] = useState<number[]>([50, 52, 48, 51, 49, 53, 50])
    const [clickedCell] = useState<{ row: number; col: number } | null>({ row: 1, col: 3 })

    const cols = 5
    const rows = 4
    const cellWidth = 48
    const cellHeight = 36
    const width = cols * cellWidth
    const height = rows * cellHeight

    useEffect(() => {
        const priceInterval = setInterval(() => {
            setPriceY(prev => {
                const change = (Math.random() - 0.5) * 12
                const newY = Math.max(10, Math.min(height - 10, prev + change))
                setPriceHistory(h => [...h.slice(-6), newY])
                return newY
            })
        }, 500)

        const cellInterval = setInterval(() => {
            const row = Math.floor(Math.random() * rows)
            const col = 2 + Math.floor(Math.random() * (cols - 2))
            setActiveCell({ row, col })
        }, 1200)

        return () => {
            clearInterval(priceInterval)
            clearInterval(cellInterval)
        }
    }, [height])

    const pricePath = priceHistory.map((y, i) => {
        const x = (i / (priceHistory.length - 1)) * width * 0.6
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')

    return (
        <div className="relative mx-auto" style={{ width: width + 50, height: height + 40 }}>
            {/* Scan line overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.1)_2px,rgba(255,255,255,0.1)_4px)]" />

            <svg
                width={width + 50}
                height={height + 40}
                className="relative"
            >
                {/* Grid background */}
                <rect
                    x={20}
                    y={8}
                    width={width}
                    height={height}
                    fill="transparent"
                    stroke="rgb(39, 39, 42)"
                    strokeWidth={1}
                />

                {/* Grid lines */}
                {Array.from({ length: cols + 1 }).map((_, i) => (
                    <line
                        key={`v-${i}`}
                        x1={20 + i * cellWidth}
                        y1={8}
                        x2={20 + i * cellWidth}
                        y2={8 + height}
                        stroke="rgb(39, 39, 42)"
                        strokeWidth={0.5}
                    />
                ))}
                {Array.from({ length: rows + 1 }).map((_, i) => (
                    <line
                        key={`h-${i}`}
                        x1={20}
                        y1={8 + i * cellHeight}
                        x2={20 + width}
                        y2={8 + i * cellHeight}
                        stroke="rgb(39, 39, 42)"
                        strokeWidth={0.5}
                    />
                ))}

                {/* Past cells (locked) */}
                {Array.from({ length: rows }).map((_, row) =>
                    Array.from({ length: 2 }).map((_, col) => (
                        <rect
                            key={`past-${row}-${col}`}
                            x={21 + col * cellWidth}
                            y={9 + row * cellHeight}
                            width={cellWidth - 2}
                            height={cellHeight - 2}
                            fill="rgb(39, 39, 42)"
                            fillOpacity={0.5}
                        />
                    ))
                )}

                {/* Interactive cells */}
                {Array.from({ length: rows }).map((_, row) =>
                    Array.from({ length: cols - 2 }).map((_, col) => {
                        const actualCol = col + 2
                        const isClicked = clickedCell?.row === row && clickedCell?.col === actualCol
                        const isHovered = activeCell?.row === row && activeCell?.col === actualCol

                        return (
                            <g key={`cell-${row}-${actualCol}`}>
                                <rect
                                    x={21 + actualCol * cellWidth}
                                    y={9 + row * cellHeight}
                                    width={cellWidth - 2}
                                    height={cellHeight - 2}
                                    fill={isClicked
                                        ? 'rgb(34, 197, 94)'
                                        : isHovered
                                            ? 'rgba(34, 197, 94, 0.15)'
                                            : 'transparent'
                                    }
                                    fillOpacity={isClicked ? 0.3 : 1}
                                    stroke={isClicked || isHovered ? 'rgb(34, 197, 94)' : 'transparent'}
                                    strokeWidth={isClicked ? 2 : 1}
                                    className="transition-all duration-150"
                                />
                                {isClicked && (
                                    <text
                                        x={21 + actualCol * cellWidth + cellWidth / 2}
                                        y={9 + row * cellHeight + cellHeight / 2}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        className="text-[9px] font-mono font-bold"
                                        fill="rgb(34, 197, 94)"
                                    >
                                        $10
                                    </text>
                                )}
                            </g>
                        )
                    })
                )}

                {/* Price line */}
                <path
                    d={pricePath}
                    fill="none"
                    stroke="rgb(34, 197, 94)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform="translate(20, 8)"
                />

                {/* Current price indicator */}
                <circle
                    cx={20 + width * 0.6}
                    cy={8 + priceY}
                    r={3}
                    fill="rgb(34, 197, 94)"
                    className="animate-pulse"
                />
                <line
                    x1={20 + width * 0.6}
                    y1={8 + priceY}
                    x2={20 + width}
                    y2={8 + priceY}
                    stroke="rgb(34, 197, 94)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    strokeOpacity={0.4}
                />

                {/* Time labels */}
                {['PAST', '', 'NOW', '+1M', '+2M'].map((label, i) => (
                    <text
                        key={`time-${i}`}
                        x={20 + i * cellWidth + cellWidth / 2}
                        y={height + 24}
                        textAnchor="middle"
                        className="text-[8px] font-mono uppercase tracking-wider"
                        fill="rgb(113, 113, 122)"
                    >
                        {label}
                    </text>
                ))}

                {/* Cursor on hovered cell */}
                {activeCell && activeCell.col >= 2 && (
                    <g transform={`translate(${20 + activeCell.col * cellWidth + cellWidth / 2}, ${8 + activeCell.row * cellHeight + cellHeight / 2})`}>
                        <MousePointerClick className="w-4 h-4 -translate-x-2 -translate-y-2 text-green-500 animate-bounce" />
                    </g>
                )}
            </svg>
        </div>
    )
}

// Stake selector visualization
const StakeSelector = () => {
    const [selectedIndex, setSelectedIndex] = useState(1)
    const stakes = [5, 10, 25, 50]

    useEffect(() => {
        const interval = setInterval(() => {
            setSelectedIndex(prev => (prev + 1) % 4)
        }, 800)
        return () => clearInterval(interval)
    }, [])

    return (
        <div className="space-y-6">
            {/* Stake buttons */}
            <div className="flex gap-2 justify-center">
                {stakes.map((stake, i) => (
                    <div
                        key={stake}
                        className={cn(
                            "w-14 h-12 rounded border flex flex-col items-center justify-center transition-all duration-200 font-mono",
                            selectedIndex === i
                                ? 'bg-green-500/20 border-green-500 text-green-400 scale-105 -translate-y-1 shadow-lg shadow-green-500/20'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                        )}
                    >
                        <span className="text-sm font-bold">${stake}</span>
                    </div>
                ))}
            </div>

            {/* Balance display */}
            <div className="mx-auto w-fit">
                <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded">
                    <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-0.5">Balance</div>
                    <div className="text-xl font-mono font-bold text-white tabular-nums">$1,000.00</div>
                </div>
            </div>
        </div>
    )
}

// Win animation
const WinAnimation = () => {
    const [phase, setPhase] = useState<'bet' | 'wait' | 'win'>('bet')

    useEffect(() => {
        const cycle = () => {
            setPhase('bet')
            setTimeout(() => setPhase('wait'), 1200)
            setTimeout(() => setPhase('win'), 2400)
        }
        cycle()
        const interval = setInterval(cycle, 4000)
        return () => clearInterval(interval)
    }, [])

    return (
        <div className="relative h-44 flex items-center justify-center">
            {/* Win particles */}
            {phase === 'win' && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {[...Array(8)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute w-1.5 h-1.5 rounded-full bg-green-500 animate-ping"
                            style={{
                                left: `${25 + Math.random() * 50}%`,
                                top: `${25 + Math.random() * 50}%`,
                                animationDelay: `${i * 0.08}s`,
                                animationDuration: '0.8s'
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Main display */}
            <div className="relative">
                {/* Outer ring */}
                <div className={cn(
                    "absolute -inset-6 rounded-lg border transition-all duration-300",
                    phase === 'win'
                        ? 'border-green-500/50 bg-green-500/5'
                        : 'border-zinc-800'
                )} />

                {/* Center box */}
                <div className={cn(
                    "relative w-20 h-20 rounded-lg flex flex-col items-center justify-center transition-all duration-200 border",
                    phase === 'win'
                        ? 'bg-green-500/20 border-green-500'
                        : phase === 'wait'
                            ? 'bg-zinc-800 border-zinc-700'
                            : 'bg-zinc-900 border-zinc-800'
                )}>
                    {phase === 'bet' && (
                        <>
                            <MousePointerClick className="w-6 h-6 text-zinc-500 mb-1" />
                            <span className="text-[10px] font-mono text-zinc-500">BET</span>
                        </>
                    )}
                    {phase === 'wait' && (
                        <>
                            <div className="w-5 h-5 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin mb-1" />
                            <span className="text-[10px] font-mono text-zinc-500">WAIT</span>
                        </>
                    )}
                    {phase === 'win' && (
                        <>
                            <Trophy className="w-6 h-6 text-green-500 mb-1" />
                            <span className="text-[10px] font-mono text-green-500">WIN!</span>
                        </>
                    )}
                </div>

                {/* Payout */}
                {phase === 'win' && (
                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap">
                        <span className="text-lg font-mono font-bold text-green-500">+$25.00</span>
                    </div>
                )}
            </div>
        </div>
    )
}

interface OnboardingStep {
    id: string
    title: string
    subtitle: string
    visual: React.ReactNode
    command: string
}

const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: 'grid',
        title: 'SELECT CELL',
        subtitle: 'Pick a time + price range',
        visual: <TerminalGrid />,
        command: 'Click any future cell to predict where price will be'
    },
    {
        id: 'stake',
        title: 'SET STAKE',
        subtitle: 'Choose your position size',
        visual: <StakeSelector />,
        command: 'Start small with Practice Mode - zero risk to learn'
    },
    {
        id: 'win',
        title: 'COLLECT WINS',
        subtitle: 'Price in cell = payout',
        visual: <WinAnimation />,
        command: 'More stake in a cell = bigger potential returns'
    }
]

export function BettingOnboarding() {
    const {
        isOnboardingActive,
        skipOnboarding,
        completeOnboarding
    } = useOnboarding()

    const [currentStep, setCurrentStep] = useState(0)
    const totalSteps = ONBOARDING_STEPS.length

    useEffect(() => {
        if (isOnboardingActive) {
            setCurrentStep(0)
        }
    }, [isOnboardingActive])

    const step = ONBOARDING_STEPS[currentStep]
    const isLastStep = currentStep === totalSteps - 1

    const handleNext = useCallback(() => {
        if (isLastStep) {
            completeOnboarding()
        } else {
            setCurrentStep(prev => prev + 1)
        }
    }, [isLastStep, completeOnboarding])

    const handleSkip = useCallback(() => {
        skipOnboarding()
    }, [skipOnboarding])

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOnboardingActive) return
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
                e.preventDefault()
                handleNext()
            }
            if (e.key === 'Escape') {
                handleSkip()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOnboardingActive, handleNext, handleSkip])

    if (!isOnboardingActive) return null

    return (
        <Dialog open={isOnboardingActive} onOpenChange={() => {}}>
            <DialogContent
                className="max-w-sm p-0 gap-0 overflow-hidden bg-zinc-950 border-zinc-800 rounded-lg [&>button]:hidden"
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                aria-describedby={undefined}
            >
                <DialogTitle className="sr-only">Trading Tutorial</DialogTitle>

                {/* Terminal Header */}
                <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-green-500" />
                            <span className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider">
                                Quick Start
                            </span>
                            <span className="text-[10px] font-mono text-zinc-600">
                                [{currentStep + 1}/{totalSteps}]
                            </span>
                        </div>
                        <button
                            onClick={handleSkip}
                            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-wider"
                        >
                            [ESC] Skip
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-green-500 transition-all duration-300"
                            style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="px-4 py-5">
                    {/* Step indicator */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                            {step.id === 'grid' && <Target className="w-4 h-4 text-green-500" />}
                            {step.id === 'stake' && <Coins className="w-4 h-4 text-green-500" />}
                            {step.id === 'win' && <Zap className="w-4 h-4 text-green-500" />}
                        </div>
                        <div>
                            <h2 className="text-base font-mono font-bold text-white uppercase tracking-wide">
                                {step.title}
                            </h2>
                            <p className="text-xs text-zinc-500">{step.subtitle}</p>
                        </div>
                    </div>

                    {/* Visual */}
                    <div className="min-h-[200px] flex items-center justify-center py-2">
                        {step.visual}
                    </div>

                    {/* Command hint */}
                    <div className="mt-4 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded">
                        <div className="flex items-start gap-2">
                            <span className="text-green-500 font-mono text-xs">$</span>
                            <p className="text-xs font-mono text-zinc-400 leading-relaxed">
                                {step.command}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 pb-4 pt-1">
                    <Button
                        className={cn(
                            "w-full h-11 font-mono font-bold uppercase tracking-wider text-sm gap-2 rounded",
                            "bg-green-500 hover:bg-green-400 text-zinc-950",
                            "transition-all hover:shadow-lg hover:shadow-green-500/20"
                        )}
                        onClick={handleNext}
                    >
                        {isLastStep ? (
                            <>
                                <Zap className="w-4 h-4" />
                                Start Trading
                            </>
                        ) : (
                            <>
                                Continue
                                <ArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </Button>
                    <p className="text-center mt-2 text-[10px] font-mono text-zinc-600">
                        Press <span className="text-zinc-500">[ENTER]</span> or <span className="text-zinc-500">[SPACE]</span> to continue
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    )
}
