import React, { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useOnboarding } from '@/contexts/OnboardingContext'
import {
    Crosshair,
    Shield,
    Megaphone,
    Rocket,
    Activity,
    Terminal,
    ArrowRight,
    Zap,
    CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Agent definitions (mirrors Demo page) ─────────────────────────────────────
const AGENTS = [
    {
        id: 'sniper',
        name: 'Sniper',
        emoji: '🎯',
        color: '#06b6d4',
        colorBg: 'rgba(6,182,212,0.15)',
        colorBorder: 'rgba(6,182,212,0.35)',
        Icon: Crosshair,
        deposit: 30,
        tp: 15,
        sl: 10,
    },
    {
        id: 'khamenei',
        name: 'Khamenei',
        emoji: '🧓',
        color: '#a855f7',
        colorBg: 'rgba(168,85,247,0.15)',
        colorBorder: 'rgba(168,85,247,0.35)',
        Icon: Shield,
        deposit: 50,
        tp: 25,
        sl: 15,
    },
    {
        id: 'trump',
        name: 'Trump',
        emoji: '🍊',
        color: '#f97316',
        colorBg: 'rgba(249,115,22,0.15)',
        colorBorder: 'rgba(249,115,22,0.35)',
        Icon: Megaphone,
        deposit: 20,
        tp: 40,
        sl: 20,
    },
] as const

// ── Step 1: Configure Agent ────────────────────────────────────────────────────
const ConfigureAgentVisual = () => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
        const id = setInterval(() => {
            setSelectedIndex(prev => (prev + 1) % AGENTS.length)
        }, 1600)
        return () => clearInterval(id)
    }, [])

    const selected = AGENTS[selectedIndex]

    return (
        <div className="w-full space-y-3">
            {/* Agent selector cards */}
            <div className="flex gap-2 justify-center">
                {AGENTS.map((agent, i) => {
                    const AgentIcon = agent.Icon
                    const isActive = i === selectedIndex
                    return (
                        <div
                            key={agent.id}
                            className="flex-1 p-2.5 rounded border transition-all duration-300"
                            style={{
                                borderColor: isActive ? agent.colorBorder : 'rgb(39,39,42)',
                                backgroundColor: isActive ? agent.colorBg : 'transparent',
                            }}
                        >
                            <div className="text-center text-lg mb-1">{agent.emoji}</div>
                            <div
                                className="text-[9px] font-mono font-bold text-center uppercase tracking-wider mb-1.5"
                                style={{ color: isActive ? agent.color : 'rgb(113,113,122)' }}
                            >
                                {agent.name}
                            </div>
                            <div className="flex justify-center">
                                <AgentIcon
                                    className="w-3 h-3 transition-colors duration-300"
                                    style={{ color: isActive ? agent.color : 'rgb(63,63,70)' }}
                                />
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Config panel for selected agent */}
            <div
                className="px-3 py-2.5 rounded border transition-all duration-300"
                style={{
                    borderColor: selected.colorBorder,
                    backgroundColor: selected.colorBg,
                }}
            >
                <div
                    className="text-[9px] font-mono uppercase tracking-wider mb-2"
                    style={{ color: selected.color }}
                >
                    {selected.name} · strategy config
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                        { label: 'DEPOSIT', value: `$${selected.deposit}` },
                        { label: 'TAKE PROFIT', value: `${selected.tp}%` },
                        { label: 'STOP LOSS', value: `${selected.sl}%` },
                    ].map(item => (
                        <div key={item.label}>
                            <div className="text-[8px] font-mono text-zinc-500 uppercase mb-0.5">{item.label}</div>
                            <div className="text-sm font-mono font-bold text-white">{item.value}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

// ── Step 2: Deploy ─────────────────────────────────────────────────────────────
const DEPLOY_LINES = [
    'Connecting to Base Sepolia',
    'Approving USDC allowance',
    'Deploying agent contract',
    'Setting strategy parameters',
    'Agent live on-chain ✓',
]

const DeployVisual = () => {
    // frame advances every 500ms; drives all derived state
    const [frame, setFrame] = useState(0)
    const total = DEPLOY_LINES.length

    useEffect(() => {
        const id = setInterval(() => {
            setFrame(f => (f + 1 > total + 5 ? 0 : f + 1))
        }, 500)
        return () => clearInterval(id)
    }, [total])

    const visibleLines = Math.min(frame, total)
    const isDone = frame >= total + 1

    return (
        <div className="w-full font-mono space-y-2">
            <div className="bg-zinc-900 border border-zinc-800 rounded p-3 min-h-[110px] space-y-1.5">
                {DEPLOY_LINES.slice(0, visibleLines).map((line, i) => {
                    const isCurrent = i === visibleLines - 1 && !isDone
                    const isSuccess = i === total - 1 && isDone
                    return (
                        <div key={i} className="text-[10px] flex items-center gap-1.5">
                            {isCurrent
                                ? <span className="inline-block w-1.5 h-3 bg-primary animate-pulse flex-shrink-0" />
                                : <span className="text-primary flex-shrink-0">{'>'}</span>
                            }
                            <span className={cn(
                                'transition-colors duration-300',
                                isSuccess ? 'text-primary font-bold' : 'text-zinc-400'
                            )}>
                                {line}
                            </span>
                        </div>
                    )
                })}
            </div>
            <div className={cn(
                'flex items-center justify-center gap-2 py-1 transition-opacity duration-500',
                isDone ? 'opacity-100' : 'opacity-0'
            )}>
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span className="text-xs font-mono text-primary font-bold">Deployment successful</span>
            </div>
        </div>
    )
}

// ── Step 3: Watch It Trade ─────────────────────────────────────────────────────
const AGENT_COLORS = ['#06b6d4', '#a855f7', '#f97316']

const WatchTradeVisual = () => {
    const cols = 5
    const rows = 3
    const cellW = 50
    const cellH = 34
    const svgW = cols * cellW
    const svgH = rows * cellH

    const [bets, setBets] = useState<{ row: number; col: number; color: string; amount: number }[]>([])
    const [priceY, setPriceY] = useState(svgH / 2)
    const [pnl, setPnl] = useState(0)

    useEffect(() => {
        const priceId = setInterval(() => {
            setPriceY(prev => Math.max(8, Math.min(svgH - 8, prev + (Math.random() - 0.5) * 14)))
        }, 600)

        const betId = setInterval(() => {
            const col = 2 + Math.floor(Math.random() * (cols - 2))
            const row = Math.floor(Math.random() * rows)
            const color = AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)]
            const amount = [5, 10, 15, 20][Math.floor(Math.random() * 4)]
            setBets(prev => {
                const next = [...prev, { row, col, color, amount }]
                return next.length > 7 ? next.slice(-7) : next
            })
            setPnl(prev => +(prev + (Math.random() > 0.38 ? amount * 0.9 : -amount * 0.6)).toFixed(2))
        }, 900)

        return () => { clearInterval(priceId); clearInterval(betId) }
    }, [svgH])

    return (
        <div className="w-full space-y-2">
            <svg width={svgW + 40} height={svgH + 28} className="mx-auto block">
                {/* Grid border */}
                <rect x={20} y={4} width={svgW} height={svgH} fill="transparent" stroke="rgb(39,39,42)" strokeWidth={1} />
                {/* Vertical lines */}
                {Array.from({ length: cols + 1 }).map((_, i) => (
                    <line key={`v-${i}`}
                        x1={20 + i * cellW} y1={4}
                        x2={20 + i * cellW} y2={4 + svgH}
                        stroke="rgb(39,39,42)" strokeWidth={0.5} />
                ))}
                {/* Horizontal lines */}
                {Array.from({ length: rows + 1 }).map((_, i) => (
                    <line key={`h-${i}`}
                        x1={20} y1={4 + i * cellH}
                        x2={20 + svgW} y2={4 + i * cellH}
                        stroke="rgb(39,39,42)" strokeWidth={0.5} />
                ))}
                {/* Past columns (locked) */}
                {Array.from({ length: rows }).map((_, row) =>
                    [0, 1].map(col => (
                        <rect key={`lock-${row}-${col}`}
                            x={21 + col * cellW} y={5 + row * cellH}
                            width={cellW - 2} height={cellH - 2}
                            fill="rgb(39,39,42)" fillOpacity={0.5} />
                    ))
                )}
                {/* Active bets */}
                {bets.map((bet, i) => (
                    <g key={i}>
                        <rect
                            x={21 + bet.col * cellW} y={5 + bet.row * cellH}
                            width={cellW - 2} height={cellH - 2}
                            fill={bet.color} fillOpacity={0.2}
                            stroke={bet.color} strokeWidth={1}
                        />
                        <text
                            x={20 + bet.col * cellW + cellW / 2}
                            y={4 + bet.row * cellH + cellH / 2}
                            textAnchor="middle" dominantBaseline="middle"
                            fill={bet.color} fontSize={8}
                            fontFamily="monospace" fontWeight="bold"
                        >
                            ${bet.amount}
                        </text>
                    </g>
                ))}
                {/* Live price line */}
                <line
                    x1={20} y1={4 + priceY}
                    x2={20 + svgW} y2={4 + priceY}
                    stroke="hsl(38,92%,45%)" strokeWidth={1} strokeDasharray="3 2"
                />
                <circle
                    cx={20 + svgW} cy={4 + priceY} r={3}
                    fill="hsl(38,92%,45%)"
                    className="animate-pulse"
                />
                {/* Time labels */}
                {['PAST', '', 'NOW', '+1M', '+2M'].map((label, i) => (
                    <text key={i}
                        x={20 + i * cellW + cellW / 2} y={svgH + 20}
                        textAnchor="middle"
                        fill="rgb(113,113,122)" fontSize={7} fontFamily="monospace"
                    >
                        {label}
                    </text>
                ))}
            </svg>

            {/* Live stats */}
            <div className="flex items-center justify-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded">
                    <Activity className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">P&amp;L</span>
                    <span className={cn(
                        'text-xs font-mono font-bold tabular-nums',
                        pnl >= 0 ? 'text-primary' : 'text-red-400'
                    )}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                    </span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">Bets</span>
                    <span className="text-xs font-mono font-bold text-white tabular-nums">{bets.length}</span>
                </div>
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
        id: 'configure',
        title: 'CONFIGURE AGENT',
        subtitle: 'Pick a strategy and set parameters',
        visual: <ConfigureAgentVisual />,
        command: 'Choose Sniper for precision, Khamenei for patience, or Trump for big swings',
        Icon: Crosshair,
    },
    {
        id: 'deploy',
        title: 'DEPLOY',
        subtitle: 'Go live on Base blockchain',
        visual: <DeployVisual />,
        command: 'Your agent is deployed on-chain — transparent, trustless, and unstoppable',
        Icon: Rocket,
    },
    {
        id: 'watch',
        title: 'WATCH IT TRADE',
        subtitle: 'Agent places bets automatically',
        visual: <WatchTradeVisual />,
        command: 'Monitor live P&L as your agent captures price movements around the clock',
        Icon: Activity,
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
                <DialogTitle className="sr-only">Agent Setup</DialogTitle>

                {/* Terminal header */}
                <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-primary" />
                            <span className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider">
                                Agent Setup
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
                                Launch Agent
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
