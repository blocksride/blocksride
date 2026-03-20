import React, { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useOnboarding } from '@/contexts/OnboardingContext'
import {
    Target,
    LayoutGrid,
    Zap,
    ArrowRight,
    CheckCircle2,
    Terminal,
    TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Step 1: Pick a Price Range ─────────────────────────────────────────────────
const PickPriceVisual = () => {
    const [selectedRow, setSelectedRow] = useState(1)

    const rows = [
        { label: '$3,850 – $3,900', prob: 18 },
        { label: '$3,800 – $3,850', prob: 34 },
        { label: '$3,750 – $3,800', prob: 27 },
        { label: '$3,700 – $3,750', prob: 14 },
        { label: '$3,650 – $3,700', prob: 7 },
    ]

    useEffect(() => {
        const id = setInterval(() => {
            setSelectedRow(prev => (prev + 1) % rows.length)
        }, 1400)
        return () => clearInterval(id)
    }, [rows.length])

    return (
        <div className="w-full space-y-1.5">
            <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-2 flex justify-between px-1">
                <span>Price Range</span>
                <span>Pool Weight</span>
            </div>
            {rows.map((row, i) => {
                const isSelected = i === selectedRow
                return (
                    <div
                        key={i}
                        className="flex items-center gap-2 px-2.5 py-2 rounded border transition-all duration-300"
                        style={{
                            borderColor: isSelected ? 'rgba(245,158,11,0.5)' : 'rgb(39,39,42)',
                            backgroundColor: isSelected ? 'rgba(245,158,11,0.08)' : 'transparent',
                        }}
                    >
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-300"
                            style={{ backgroundColor: isSelected ? '#f59e0b' : 'rgb(63,63,70)' }} />
                        <span className="text-[10px] font-mono flex-1"
                            style={{ color: isSelected ? '#f5f5f4' : 'rgb(113,113,122)' }}>
                            {row.label}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <div className="h-1 w-16 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                        width: `${row.prob}%`,
                                        backgroundColor: isSelected ? '#f59e0b' : 'rgb(63,63,70)',
                                    }}
                                />
                            </div>
                            <span className="text-[9px] font-mono w-6 text-right"
                                style={{ color: isSelected ? '#f59e0b' : 'rgb(113,113,122)' }}>
                                {row.prob}%
                            </span>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// ── Step 2: Select a Box ───────────────────────────────────────────────────────
const SelectBoxVisual = () => {
    const cols = 5
    const rows = 4
    const cellW = 46
    const cellH = 30
    const svgW = cols * cellW
    const svgH = rows * cellH

    const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null)
    const [tick, setTick] = useState(0)

    // highlight row 1 (middle price band) cycling through columns 2–4
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 900)
        return () => clearInterval(id)
    }, [])

    useEffect(() => {
        const col = 2 + (tick % 3)
        setSelectedCell({ r: 1, c: col })
    }, [tick])

    const priceLabels = ['$3,850', '$3,800', '$3,750', '$3,700']
    const timeLabels = ['PAST', 'PAST', 'NOW', '+1M', '+2M']

    return (
        <div className="w-full">
            <svg width={svgW + 52} height={svgH + 28} className="mx-auto block">
                {/* Grid */}
                {Array.from({ length: rows }).map((_, r) =>
                    Array.from({ length: cols }).map((_, c) => {
                        const isPast = c < 2
                        const isSelected = selectedCell?.r === r && selectedCell?.c === c
                        return (
                            <rect
                                key={`${r}-${c}`}
                                x={50 + c * cellW + 1} y={r * cellH + 1}
                                width={cellW - 2} height={cellH - 2}
                                fill={
                                    isSelected ? 'rgba(245,158,11,0.2)'
                                    : isPast ? 'rgba(39,39,42,0.6)'
                                    : 'transparent'
                                }
                                stroke={
                                    isSelected ? 'rgba(245,158,11,0.7)'
                                    : 'rgb(39,39,42)'
                                }
                                strokeWidth={isSelected ? 1.5 : 0.5}
                            />
                        )
                    })
                )}

                {/* Selected cell pulse dot */}
                {selectedCell && (
                    <circle
                        cx={50 + selectedCell.c * cellW + cellW / 2}
                        cy={selectedCell.r * cellH + cellH / 2}
                        r={4}
                        fill="#f59e0b"
                        className="animate-pulse"
                    />
                )}

                {/* Price labels */}
                {priceLabels.map((label, i) => (
                    <text key={i}
                        x={46} y={i * cellH + cellH / 2 + 1}
                        textAnchor="end" dominantBaseline="middle"
                        fill="rgb(113,113,122)" fontSize={7} fontFamily="monospace"
                    >
                        {label}
                    </text>
                ))}

                {/* Time labels */}
                {timeLabels.map((label, i) => (
                    <text key={i}
                        x={50 + i * cellW + cellW / 2} y={svgH + 16}
                        textAnchor="middle"
                        fill="rgb(113,113,122)" fontSize={7} fontFamily="monospace"
                    >
                        {label}
                    </text>
                ))}
            </svg>
            <p className="text-center text-[10px] font-mono text-zinc-500 mt-1">
                Tap any future box to select your window
            </p>
        </div>
    )
}

// ── Step 3: Place Your Bet ─────────────────────────────────────────────────────
const PlaceBetVisual = () => {
    const [amount, setAmount] = useState(0)
    const [phase, setPhase] = useState<'input' | 'signing' | 'done'>('input')

    useEffect(() => {
        let t1: ReturnType<typeof setTimeout>
        let t2: ReturnType<typeof setTimeout>
        let t3: ReturnType<typeof setTimeout>

        const run = () => {
            setPhase('input')
            setAmount(0)

            // count up amount
            let v = 0
            const inc = setInterval(() => {
                v += 5
                setAmount(v)
                if (v >= 20) clearInterval(inc)
            }, 120)

            t1 = setTimeout(() => setPhase('signing'), 1800)
            t2 = setTimeout(() => setPhase('done'), 3000)
            t3 = setTimeout(run, 5200)
        }

        run()
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
    }, [])

    return (
        <div className="w-full space-y-3">
            {/* Selected box summary */}
            <div className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded flex items-center justify-between">
                <div>
                    <div className="text-[8px] font-mono text-zinc-500 uppercase">Selected Box</div>
                    <div className="text-[11px] font-mono text-white mt-0.5">$3,800 – $3,850 · +1 min</div>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            </div>

            {/* Amount */}
            <div className="px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded">
                <div className="text-[8px] font-mono text-zinc-500 uppercase mb-1.5">Bet Amount</div>
                <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-mono font-bold text-white tabular-nums">${amount}</span>
                    <span className="text-[10px] font-mono text-zinc-500">USDC</span>
                </div>
            </div>

            {/* Action */}
            <div className={cn(
                'px-3 py-2.5 rounded border flex items-center gap-2 transition-all duration-300',
                phase === 'input' && 'border-amber-500/40 bg-amber-500/10',
                phase === 'signing' && 'border-blue-500/40 bg-blue-500/10',
                phase === 'done' && 'border-emerald-500/40 bg-emerald-500/10',
            )}>
                {phase === 'done'
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    : <Zap className={cn('w-4 h-4 flex-shrink-0', phase === 'signing' ? 'text-blue-400 animate-pulse' : 'text-amber-400')} />
                }
                <span className={cn(
                    'text-[10px] font-mono font-bold uppercase tracking-wider',
                    phase === 'input' && 'text-amber-400',
                    phase === 'signing' && 'text-blue-400',
                    phase === 'done' && 'text-emerald-400',
                )}>
                    {phase === 'input' && 'Place Bet'}
                    {phase === 'signing' && 'Signing…'}
                    {phase === 'done' && 'Bet Live On-Chain ✓'}
                </span>
            </div>
        </div>
    )
}

// ── Step definitions ───────────────────────────────────────────────────────────
interface OnboardingStep {
    id: string
    title: string
    subtitle: string
    visual: React.ReactNode
    command: string
    Icon: React.ComponentType<{ className?: string }>
}

const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: 'price',
        title: 'PICK A PRICE RANGE',
        subtitle: 'Choose where you think ETH will be',
        visual: <PickPriceVisual />,
        command: 'Each row is a price band. Pick the range you expect ETH to land in — higher pools mean bigger competition and bigger rewards.',
        Icon: TrendingUp,
    },
    {
        id: 'box',
        title: 'SELECT A BOX',
        subtitle: 'Choose your time window on the grid',
        visual: <SelectBoxVisual />,
        command: 'Each column is a 1-minute window. Tap a future box where your price range meets your target window.',
        Icon: LayoutGrid,
    },
    {
        id: 'bet',
        title: 'PLACE YOUR BET',
        subtitle: 'Set your amount and go on-chain',
        visual: <PlaceBetVisual />,
        command: 'Sign once with your embedded wallet — no gas needed. Win when price closes inside your box at settlement.',
        Icon: Target,
    },
]

// ── Main component ─────────────────────────────────────────────────────────────
export function BettingOnboarding() {
    const { isOnboardingActive, skipOnboarding, completeOnboarding } = useOnboarding()

    const [currentStep, setCurrentStep] = useState(0)
    const totalSteps = ONBOARDING_STEPS.length

    useEffect(() => {
        if (isOnboardingActive) setCurrentStep(0)
    }, [isOnboardingActive])

    const step = ONBOARDING_STEPS[currentStep]
    const isLastStep = currentStep === totalSteps - 1
    const StepIcon = step.Icon

    const handleNext = useCallback(() => {
        if (isLastStep) completeOnboarding()
        else setCurrentStep(prev => prev + 1)
    }, [isLastStep, completeOnboarding])

    const handleSkip = useCallback(() => skipOnboarding(), [skipOnboarding])

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOnboardingActive) return
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
                e.preventDefault()
                handleNext()
            }
            if (e.key === 'Escape') handleSkip()
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
                <DialogTitle className="sr-only">How to Bet</DialogTitle>

                {/* Terminal header */}
                <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-primary" />
                            <span className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider">
                                How to Bet
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
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="px-4 py-5">
                    {/* Step header */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
                            <StepIcon className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-base font-mono font-bold text-white uppercase tracking-wide">
                                {step.title}
                            </h2>
                            <p className="text-xs text-zinc-500">{step.subtitle}</p>
                        </div>
                    </div>

                    {/* Visual area */}
                    <div className="min-h-[200px] flex items-center justify-center py-2">
                        {step.visual}
                    </div>

                    {/* Command hint */}
                    <div className="mt-4 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded">
                        <div className="flex items-start gap-2">
                            <span className="text-primary font-mono text-xs flex-shrink-0">$</span>
                            <p className="text-xs font-mono text-zinc-400 leading-relaxed">{step.command}</p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 pb-4 pt-1">
                    <Button
                        className={cn(
                            'w-full h-11 font-mono font-bold uppercase tracking-wider text-sm gap-2 rounded',
                            'bg-primary hover:bg-primary/90 text-primary-foreground',
                            'transition-all hover:shadow-lg hover:shadow-primary/20'
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
                        Press <span className="text-zinc-500">[ENTER]</span> or{' '}
                        <span className="text-zinc-500">[SPACE]</span> to continue
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    )
}
