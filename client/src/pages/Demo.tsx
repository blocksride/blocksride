import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Crosshair, Shield, Megaphone, ArrowRight,
    ChevronDown, ChevronUp, Zap, X, Trophy,
} from 'lucide-react'
import { BlocksrideLogo } from '@/components/BlocksrideLogo'
import { GridCanvas } from '@/components/grid/GridCanvas'
import { useGridViewport } from '@/hooks/useGridViewport'
import { usePublicPriceFeed } from '@/hooks/usePublicPriceFeed'
import type { Grid, Cell, PricePoint } from '@/types/grid'

// ── Constants ─────────────────────────────────────────────────────────────────
const INITIAL_PRICE = 1983.47
const PRICE_INTERVAL = 4
const TIMEFRAME_SEC = 60
const GRID_WINDOWS_AHEAD = 240
const GRID_ANCHOR = Math.round(INITIAL_PRICE / PRICE_INTERVAL) * PRICE_INTERVAL
const BET_SLOTS = 10
const SIM_SETTLE_MS = 10000    // how often a window settles in the demo
const AGENT_BET_MS = 3200      // how often agents place bets

// ── Agent definitions (hardcoded) ─────────────────────────────────────────────
const AGENT_DEFS = [
    {
        id: 'sniper',
        name: 'Sniper',
        emoji: '🎯',
        color: '#06b6d4',
        colorBg: 'rgba(6,182,212,0.15)',
        colorBorder: 'rgba(6,182,212,0.35)',
        Icon: Crosshair,
        desc: 'Precise entries at exact price levels',
        strategy: 'precise' as const,
        defaultDeposit: 30,
        defaultTP: 15,
        defaultSL: 10,
    },
    {
        id: 'khamenei',
        name: 'Khamenei',
        emoji: '🧓',
        color: '#a855f7',
        colorBg: 'rgba(168,85,247,0.15)',
        colorBorder: 'rgba(168,85,247,0.35)',
        Icon: Shield,
        desc: 'Patient authority. Holds through volatility',
        strategy: 'patient' as const,
        defaultDeposit: 50,
        defaultTP: 25,
        defaultSL: 15,
    },
    {
        id: 'trump',
        name: 'Trump',
        emoji: '🍊',
        color: '#f97316',
        colorBg: 'rgba(249,115,22,0.15)',
        colorBorder: 'rgba(249,115,22,0.35)',
        Icon: Megaphone,
        desc: 'Loud & aggressive. High risk, big wins',
        strategy: 'aggressive' as const,
        defaultDeposit: 20,
        defaultTP: 40,
        defaultSL: 20,
    },
] as const

type AgentId = typeof AGENT_DEFS[number]['id']
type EntryMode = 'now' | 'price' | 'time'

interface AgentState {
    id: AgentId
    deposit: number
    takeProfit: number
    stopLoss: number
    entryMode: EntryMode
    entryPrice: string
    entryTime: string
    expanded: boolean
    deployed: boolean
    balance: number
    betUnit: number
    betsRemaining: number
    wins: number
    losses: number
    exited: boolean
    exitReason: 'tp' | 'sl' | null
}

interface AgentBet {
    agentId: AgentId
    effectiveWindow: number
    cellId: number
    amount: number
    status: 'pending' | 'won' | 'lost'
}

// ── Demo Page ─────────────────────────────────────────────────────────────────
export const Demo = () => {
    const navigate = useNavigate()
    const { prices: oraclePrices, currentPrice: oraclePrice } = usePublicPriceFeed('ETH-USD')

    // ── Price state ───────────────────────────────────────────────────────────
    const [price, setPrice] = useState(INITIAL_PRICE)
    const [chartPrices, setChartPrices] = useState<PricePoint[]>([{ time: Date.now(), price: INITIAL_PRICE }])
    const priceRef = useRef(INITIAL_PRICE)
    const [timeStr, setTimeStr] = useState('')
    const gridStartRef = useRef(Date.now() - TIMEFRAME_SEC * 6 * 1000)
    const containerRef = useRef<HTMLDivElement>(null)

    // ── Agent state ───────────────────────────────────────────────────────────
    const [agents, setAgents] = useState<AgentState[]>(
        AGENT_DEFS.map(d => ({
            id: d.id,
            deposit: d.defaultDeposit,
            takeProfit: d.defaultTP,
            stopLoss: d.defaultSL,
            entryMode: 'now',
            entryPrice: '1980',
            entryTime: '',
            expanded: false,
            deployed: false,
            balance: d.defaultDeposit,
            betUnit: Math.round((d.defaultDeposit / BET_SLOTS) * 100) / 100,
            betsRemaining: BET_SLOTS,
            wins: 0,
            losses: 0,
            exited: false,
            exitReason: null,
        }))
    )
    const agentsRef = useRef(agents)
    agentsRef.current = agents

    // ── Bets ──────────────────────────────────────────────────────────────────
    const [bets, setBets] = useState<AgentBet[]>([])
    const betsRef = useRef(bets)
    betsRef.current = bets

    // ── Funding modal ─────────────────────────────────────────────────────────
    const [fundingModal, setFundingModal] = useState<AgentId | 'all' | null>(null)
    const [showRestartModal, setShowRestartModal] = useState(false)
    const simulationLockedRef = useRef(false)
    const [rankMotion, setRankMotion] = useState<Record<AgentId, 'up' | 'down' | null>>({
        sniper: null,
        khamenei: null,
        trump: null,
    })

    // ── Session timer ─────────────────────────────────────────────────────────
    const [sessionSec, setSessionSec] = useState(0)
    const [sessionActive, setSessionActive] = useState(false)
    const anyDeployed = agents.some(a => a.deployed)
    const allDeployed = agents.every(a => a.deployed)

    // ── Clock ─────────────────────────────────────────────────────────────────
    useEffect(() => {
        const tick = () => setTimeStr(new Date().toLocaleTimeString('en-US', { hour12: false }))
        tick()
        const i = setInterval(tick, 1000)
        return () => clearInterval(i)
    }, [])

    // ── Oracle price feed (same source used by the original public grid) ────
    useEffect(() => {
        if (oraclePrice === null) return
        priceRef.current = oraclePrice
        setPrice(oraclePrice)
    }, [oraclePrice])
    useEffect(() => {
        if (!oraclePrices.length) return
        setChartPrices(oraclePrices.slice(-6000))
    }, [oraclePrices])

    // ── Window settlement ─────────────────────────────────────────────────────
    useEffect(() => {
        const id = setInterval(() => {
            const nowWindow = Math.floor((Date.now() - gridStartRef.current) / (TIMEFRAME_SEC * 1000))
            const sp = priceRef.current

            // Resolve pending bets per settled window with parimutuel-style accounting:
            // winners split the total loser pool proportionally to their stake.
            setBets(prev => {
                const accounting: Record<string, { losses: number; wins: number; pnlDelta: number }> = {}
                const pendingByWindow = new Map<number, number[]>()

                prev.forEach((bet, idx) => {
                    if (bet.status !== 'pending' || bet.effectiveWindow > nowWindow) return
                    const list = pendingByWindow.get(bet.effectiveWindow) || []
                    list.push(idx)
                    pendingByWindow.set(bet.effectiveWindow, list)
                })

                const next = [...prev]

                for (const [, betIndexes] of pendingByWindow.entries()) {
                    if (!betIndexes.length) continue

                    const winningCellId = Math.floor(sp / PRICE_INTERVAL)
                    const winners = betIndexes.filter((idx) => next[idx].cellId === winningCellId)
                    const losers = betIndexes.filter((idx) => next[idx].cellId !== winningCellId)

                    const loserPool = losers.reduce((sum, idx) => sum + next[idx].amount, 0)
                    const totalWinnerStake = winners.reduce((sum, idx) => sum + next[idx].amount, 0)

                    for (const idx of losers) {
                        const bet = next[idx]
                        next[idx] = { ...bet, status: 'lost' }
                        const key = bet.agentId
                        if (!accounting[key]) accounting[key] = { losses: 0, wins: 0, pnlDelta: 0 }
                        accounting[key].losses += 1
                        accounting[key].pnlDelta -= bet.amount
                    }

                    for (const idx of winners) {
                        const bet = next[idx]
                        next[idx] = { ...bet, status: 'won' }
                        const key = bet.agentId
                        if (!accounting[key]) accounting[key] = { losses: 0, wins: 0, pnlDelta: 0 }
                        accounting[key].wins += 1
                        if (totalWinnerStake > 0) {
                            accounting[key].pnlDelta += loserPool * (bet.amount / totalWinnerStake)
                        }
                    }
                }

                if (Object.keys(accounting).length > 0) {
                    setAgents(prevAgents => prevAgents.map(agent => {
                        const entry = accounting[agent.id]
                        if (!entry) return agent
                        const nextBalance = Math.max(0, agent.balance + entry.pnlDelta)
                        const nextWins = agent.wins + entry.wins
                        const nextLosses = agent.losses + entry.losses
                        if (!agent.exited && nextBalance <= 0) {
                            return { ...agent, balance: 0, wins: nextWins, losses: nextLosses, exited: true, exitReason: 'sl' }
                        }
                        return { ...agent, balance: nextBalance, wins: nextWins, losses: nextLosses }
                    }))
                }

                return next
            })
        }, SIM_SETTLE_MS)
        return () => clearInterval(id)
    }, [])

    // ── Agent betting loop ────────────────────────────────────────────────────
    useEffect(() => {
        const id = setInterval(() => {
            if (simulationLockedRef.current) return
            const active = agentsRef.current.filter(a => a.deployed && !a.exited)
            if (!active.length) return

            const newBets: AgentBet[] = []
            const placedAgents: AgentId[] = []
            const nowWindow = Math.floor((Date.now() - gridStartRef.current) / (TIMEFRAME_SEC * 1000))
            const currentCellId = Math.floor(priceRef.current / PRICE_INTERVAL)

            for (const agent of active) {
                const def = AGENT_DEFS.find(d => d.id === agent.id)!
                const futureWindows = [3, 4, 5]
                const effectiveWindow = nowWindow + futureWindows[Math.floor(Math.random() * futureWindows.length)]

                // Pick band by strategy
                let cellId: number
                if (def.strategy === 'precise') {
                    cellId = currentCellId + (Math.floor(Math.random() * 3) - 1)
                } else if (def.strategy === 'patient') {
                    cellId = currentCellId + 1 + Math.floor(Math.random() * 2)
                } else {
                    cellId = currentCellId + (Math.floor(Math.random() * 9) - 4)
                }

                // One trade per agent per column (window).
                if (betsRef.current.find(b => b.agentId === agent.id && b.effectiveWindow === effectiveWindow)) continue

                if (agent.betsRemaining <= 0) continue

                const betAmt = Math.min(agent.betUnit, Math.max(0, agent.balance))
                if (betAmt < 0.01) continue
                newBets.push({ agentId: agent.id, effectiveWindow, cellId, amount: betAmt, status: 'pending' })
                placedAgents.push(agent.id)
            }

            if (newBets.length) {
                setBets(prev => [...prev, ...newBets])
                setAgents(prev => prev.map(a => {
                    if (!placedAgents.includes(a.id)) return a
                    return { ...a, betsRemaining: Math.max(0, a.betsRemaining - 1) }
                }))
            }
        }, AGENT_BET_MS)
        return () => clearInterval(id)
    }, [])

    // ── Session timer ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (anyDeployed && !sessionActive) setSessionActive(true)
    }, [anyDeployed, sessionActive])
    useEffect(() => {
        if (!sessionActive) return
        const i = setInterval(() => setSessionSec(s => s + 1), 1000)
        return () => clearInterval(i)
    }, [sessionActive])

    const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

    const grid = useMemo<Grid>(() => ({
        grid_id: 'demo-grid',
        asset_id: 'ETH-USD',
        timeframe_sec: TIMEFRAME_SEC,
        start_time: new Date(gridStartRef.current).toISOString(),
        end_time: new Date(gridStartRef.current + TIMEFRAME_SEC * GRID_WINDOWS_AHEAD * 1000).toISOString(),
        anchor_price: GRID_ANCHOR,
        price_interval: PRICE_INTERVAL,
    }), [])

    const viewport = useGridViewport(
        price,
        TIMEFRAME_SEC,
        containerRef,
        false,
        PRICE_INTERVAL,
        GRID_ANCHOR,
        null
    )

    const demoCells = useMemo<Cell[]>(() => {
        const map = new Map<string, Cell>()
        for (const bet of bets) {
            const key = `${bet.effectiveWindow}_${bet.cellId}`
            const tStart = gridStartRef.current + bet.effectiveWindow * TIMEFRAME_SEC * 1000
            const tEnd = tStart + TIMEFRAME_SEC * 1000
            const pLow = bet.cellId * PRICE_INTERVAL
            const base = map.get(key)

            if (base) {
                base.total_stake = (base.total_stake || 0) + bet.amount
                continue
            }

            map.set(key, {
                cell_id: `demo-${key}`,
                grid_id: grid.grid_id,
                asset_id: grid.asset_id,
                window_index: bet.effectiveWindow,
                price_band_index: bet.cellId,
                t_start: new Date(tStart).toISOString(),
                t_end: new Date(tEnd).toISOString(),
                p_low: pLow,
                p_high: pLow + PRICE_INTERVAL,
                total_stake: bet.amount,
            })
        }
        return Array.from(map.values())
    }, [bets, grid.asset_id, grid.grid_id])

    const demoBetResults = useMemo<Record<string, string>>(() => {
        const grouped = new Map<string, Array<AgentBet['status']>>()
        for (const bet of bets) {
            const key = `demo-${bet.effectiveWindow}_${bet.cellId}`
            grouped.set(key, [...(grouped.get(key) || []), bet.status])
        }
        const results: Record<string, string> = {}
        for (const [key, statuses] of grouped.entries()) {
            if (statuses.includes('pending')) results[key] = 'pending'
            else if (statuses.includes('won')) results[key] = 'won'
            else results[key] = 'lost'
        }
        return results
    }, [bets])

    const demoCellStakes = useMemo<Record<string, number>>(() => {
        return demoCells.reduce((acc, cell) => {
            acc[cell.cell_id] = cell.total_stake || 0
            return acc
        }, {} as Record<string, number>)
    }, [demoCells])

    const priceLabels = useMemo(() => {
        const count = 10
        const min = viewport.visibleMinPrice
        const max = viewport.visibleMaxPrice
        if (!isFinite(min) || !isFinite(max) || max <= min) return []
        const step = (max - min) / (count - 1)
        return Array.from({ length: count }, (_, i) => max - i * step)
    }, [viewport.visibleMinPrice, viewport.visibleMaxPrice])

    const livePriceIndex = useMemo(() => {
        if (priceLabels.length === 0) return -1
        let idx = 0
        let best = Math.abs(priceLabels[0] - price)
        priceLabels.forEach((p, i) => {
            const diff = Math.abs(p - price)
            if (diff < best) {
                best = diff
                idx = i
            }
        })
        return idx
    }, [price, priceLabels])

    const timeZoneLabel = useMemo(() => {
        const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date())
        return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    }, [])

    const agentOverlays = useMemo(() => {
        const width = viewport.dimensions.width
        const height = viewport.dimensions.height
        if (!width || !height) return []

        const tStart = viewport.visibleStart
        const tEnd = viewport.visibleEnd
        const pMin = viewport.visibleMinPrice
        const pMax = viewport.visibleMaxPrice
        const tRange = tEnd - tStart
        const pRange = pMax - pMin
        if (tRange <= 0 || pRange <= 0) return []

        const windowDuration = TIMEFRAME_SEC * 1000

        const overlays: Array<{
            key: string
            x: number
            y: number
            label: string
            color: string
            colorBg: string
            colorBorder: string
            faded: boolean
        }> = []

        const byCell = new Map<string, AgentBet[]>()
        for (const bet of bets) {
            const key = `${bet.effectiveWindow}_${bet.cellId}`
            byCell.set(key, [...(byCell.get(key) || []), bet])
        }

        for (const [cellKey, cellBets] of byCell.entries()) {
            const [windowStr, cellStr] = cellKey.split('_')
            const effectiveWindow = Number(windowStr)
            const cellId = Number(cellStr)
            const ws = gridStartRef.current + effectiveWindow * windowDuration
            const we = ws + windowDuration
            const pLow = cellId * PRICE_INTERVAL
            const pHigh = (cellId + 1) * PRICE_INTERVAL
            const x1 = ((ws - tStart) / tRange) * width
            const x2 = ((we - tStart) / tRange) * width
            const yTop = height - ((pHigh - pMin) / pRange) * height

            const anchorX = x1 + 6
            const anchorY = yTop + 6

            for (let i = 0; i < cellBets.length; i++) {
                const bet = cellBets[i]
                const def = AGENT_DEFS.find((d) => d.id === bet.agentId)!
                const y = anchorY + i * 12
                if (y > height || anchorX > x2 || x2 < 0) continue
                overlays.push({
                    key: `${bet.agentId}-${bet.effectiveWindow}-${bet.cellId}`,
                    x: anchorX,
                    y,
                    label: `${def.emoji} ${def.name.slice(0, 3).toUpperCase()}`,
                    color: def.color,
                    colorBg: def.colorBg,
                    colorBorder: def.colorBorder,
                    faded: bet.status === 'lost',
                })
            }
        }

        return overlays.filter((o) => o.x >= -20 && o.x <= width && o.y >= -20 && o.y <= height)
    }, [
        bets,
        viewport.dimensions.width,
        viewport.dimensions.height,
        viewport.visibleStart,
        viewport.visibleEnd,
        viewport.visibleMinPrice,
        viewport.visibleMaxPrice,
    ])

    const priceChange = chartPrices.length > 1
        ? ((chartPrices[chartPrices.length - 1].price - chartPrices[0].price) / chartPrices[0].price) * 100
        : 0

    // ── Leaderboard ───────────────────────────────────────────────────────────
    const leaderboard = agents
        .filter(a => a.deployed)
        .map(a => ({ ...a, def: AGENT_DEFS.find(d => d.id === a.id)! }))
        .sort((a, b) => {
            const aProfit = a.balance - a.deposit
            const bProfit = b.balance - b.deposit
            if (bProfit !== aProfit) return bProfit - aProfit
            const aRate = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0
            const bRate = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0
            return bRate - aRate
        })

    const prevRanksRef = useRef<Record<AgentId, number>>({ sniper: 0, khamenei: 1, trump: 2 })
    useEffect(() => {
        if (!leaderboard.length) return
        const nextRanks: Record<AgentId, number> = { sniper: 0, khamenei: 1, trump: 2 }
        const motion: Record<AgentId, 'up' | 'down' | null> = { sniper: null, khamenei: null, trump: null }
        leaderboard.forEach((agent, idx) => {
            nextRanks[agent.id] = idx
            const prev = prevRanksRef.current[agent.id]
            if (idx < prev) motion[agent.id] = 'up'
            if (idx > prev) motion[agent.id] = 'down'
        })
        prevRanksRef.current = nextRanks
        setRankMotion(motion)
        const t = window.setTimeout(() => {
            setRankMotion({ sniper: null, khamenei: null, trump: null })
        }, 420)
        return () => window.clearTimeout(t)
    }, [leaderboard])

    const deployedAgents = agents.filter(a => a.deployed)
    const simulationExhausted = deployedAgents.length > 0 &&
        deployedAgents.every(a => (a.balance < 0.01 || a.betsRemaining <= 0))

    useEffect(() => {
        if (simulationExhausted) setShowRestartModal(true)
    }, [simulationExhausted])
    useEffect(() => {
        simulationLockedRef.current = simulationExhausted || showRestartModal
    }, [simulationExhausted, showRestartModal])

    useEffect(() => {
        const pendingByAgent = bets.reduce((acc, bet) => {
            if (bet.status !== 'pending') return acc
            acc[bet.agentId] = (acc[bet.agentId] || 0) + 1
            return acc
        }, {} as Record<AgentId, number>)

        setAgents(prev => prev.map(agent => {
            if (!agent.deployed || agent.exited) return agent
            const outOfFunds = agent.balance < 0.01
            const outOfSlots = agent.betsRemaining <= 0
            const noFuel = outOfFunds || outOfSlots
            const hasPending = (pendingByAgent[agent.id] || 0) > 0
            if (noFuel && !hasPending) {
                return { ...agent, exited: true, exitReason: outOfFunds ? 'sl' : null }
            }
            return agent
        }))
    }, [bets])

    // ── Deploy handlers ───────────────────────────────────────────────────────
    const confirmDeploy = (id: AgentId | 'all') => {
        setFundingModal(null)
        if (id === 'all') {
            setAgents(prev => prev.map(a => ({
                ...a,
                deployed: true,
                balance: a.deposit,
                betUnit: Math.round((a.deposit / BET_SLOTS) * 100) / 100,
                betsRemaining: BET_SLOTS,
                wins: 0,
                losses: 0,
                exited: false,
                exitReason: null,
            })))
        } else {
            setAgents(prev => prev.map(a => a.id === id
                ? {
                    ...a,
                    deployed: true,
                    expanded: false,
                    balance: a.deposit,
                    betUnit: Math.round((a.deposit / BET_SLOTS) * 100) / 100,
                    betsRemaining: BET_SLOTS,
                    wins: 0,
                    losses: 0,
                    exited: false,
                    exitReason: null,
                }
                : a))
        }
    }

    const updateAgent = (id: AgentId, patch: Partial<AgentState>) =>
        setAgents(prev => prev.map(a => {
            if (a.id !== id) return a
            const next = { ...a, ...patch }
            if (!next.deployed) {
                next.betUnit = Math.round((next.deposit / BET_SLOTS) * 100) / 100
                next.balance = next.deposit
                next.betsRemaining = BET_SLOTS
            }
            return next
        }))

    const restartSimulation = () => {
        setShowRestartModal(false)
        setBets([])
        setSessionSec(0)
        setSessionActive(false)
        gridStartRef.current = Date.now() - TIMEFRAME_SEC * 6 * 1000
        const resetPrice = oraclePrice ?? INITIAL_PRICE
        priceRef.current = resetPrice
        setPrice(resetPrice)
        setChartPrices(oraclePrices.length ? oraclePrices.slice(-6000) : [{ time: Date.now(), price: resetPrice }])
        setAgents(AGENT_DEFS.map(d => ({
            id: d.id,
            deposit: d.defaultDeposit,
            takeProfit: d.defaultTP,
            stopLoss: d.defaultSL,
            entryMode: 'now',
            entryPrice: '1980',
            entryTime: '',
            expanded: false,
            deployed: false,
            balance: d.defaultDeposit,
            betUnit: Math.round((d.defaultDeposit / BET_SLOTS) * 100) / 100,
            betsRemaining: BET_SLOTS,
            wins: 0,
            losses: 0,
            exited: false,
            exitReason: null,
        })))
    }

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="h-screen bg-background text-foreground flex flex-col dark overflow-hidden">

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <header className="h-12 flex items-center justify-between px-5 border-b border-border/60 bg-background/95 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-3">
                    <BlocksrideLogo size={24} wordmark />
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-[10px] font-mono text-primary uppercase tracking-widest">Demo</span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-2 text-sm font-mono">
                        <span className="text-muted-foreground text-xs">ETH</span>
                        <span className="font-bold">${price.toFixed(2)}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold ${priceChange >= 0 ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                        </span>
                    </div>
                    <button
                        onClick={() => navigate('/terminal')}
                        className="h-8 px-4 rounded-md text-xs font-mono font-bold uppercase tracking-wide bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
                    >
                        Launch App <ArrowRight className="w-3 h-3" />
                    </button>
                </div>
            </header>

            {/* ── Body ───────────────────────────────────────────────────────── */}
            <div className="flex flex-1 overflow-hidden">

                {/* ── Grid Panel (left) ─────────────────────────────────────── */}
                <div className="flex-1 flex flex-col overflow-hidden border-r border-border/30">

                    {/* Grid toolbar */}
                    <div className="h-9 flex items-center justify-between px-4 border-b border-border/30 shrink-0">
                        <div className="flex items-center gap-3 text-[11px] font-mono">
                            <span className="font-bold text-foreground">ETH/USD</span>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="text-muted-foreground">60s windows</span>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="text-primary">{timeStr}</span>
                        </div>
                        {anyDeployed && (
                            <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                Session {fmtTime(sessionSec)}
                            </div>
                        )}
                    </div>

                    {/* Grid (same canvas structure as terminal) */}
                    <div className="flex-1 min-h-0 flex">
                        <div ref={containerRef} className="flex-1 relative overflow-hidden grid-canvas">
                            <GridCanvas
                                width={viewport.dimensions.width}
                                height={viewport.dimensions.height}
                                grid={grid}
                                cells={demoCells}
                                prices={chartPrices}
                                currentPrice={price}
                                selectedCells={[]}
                                visibleTimeRange={{ start: viewport.visibleStart, end: viewport.visibleEnd }}
                                visiblePriceRange={{ min: viewport.visibleMinPrice, max: viewport.visibleMaxPrice }}
                                mousePos={null}
                                isDragging={false}
                                onCellClick={() => {}}
                                betResults={demoBetResults}
                                cellStakes={demoCellStakes}
                                recentCellIds={{}}
                            />

                            {agentOverlays.map((overlay) => (
                                <div
                                    key={overlay.key}
                                    className="pointer-events-none absolute z-20 flex items-center gap-[3px] px-[5px] py-[2px] rounded-sm text-[8px] font-mono font-bold leading-none whitespace-nowrap"
                                    style={{
                                        left: overlay.x,
                                        top: overlay.y,
                                        transform: 'translate(0, 0)',
                                        color: overlay.color,
                                        backgroundColor: overlay.colorBg,
                                        border: `1px solid ${overlay.colorBorder}`,
                                        opacity: overlay.faded ? 0.55 : 1,
                                    }}
                                >
                                    {overlay.label}
                                </div>
                            ))}
                        </div>

                        <div className="w-16 border-l border-border bg-card/60 flex flex-col justify-between px-2 py-3 text-[10px] font-mono">
                            {priceLabels.map((p, idx) => (
                                <div
                                    key={`${p}-${idx}`}
                                    className={[
                                        'text-left',
                                        idx === livePriceIndex ? 'text-primary font-semibold' : 'text-muted-foreground',
                                    ].join(' ')}
                                >
                                    ${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                    {idx === livePriceIndex ? ' \u2190' : ''}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex h-7 border-t border-border bg-card/60 items-center">
                        <div className="flex-1 flex items-center justify-between px-3 text-[10px] font-mono text-muted-foreground">
                            <span className="uppercase tracking-[0.2em]">Local time</span>
                            <span className="text-foreground">
                                {timeStr}
                                {timeZoneLabel ? ` ${timeZoneLabel}` : ''}
                            </span>
                        </div>
                        <div className="w-16 border-l border-border" />
                    </div>

                    {/* Deploy all CTA bar */}
                    {!allDeployed && (
                        <div className="px-4 py-2.5 border-t border-border/30 shrink-0">
                            <button
                                onClick={() => setFundingModal('all')}
                                className="w-full h-9 rounded-md text-[11px] font-mono font-bold uppercase tracking-widest bg-primary/10 text-primary border border-primary/30 hover:bg-primary hover:text-primary-foreground flex items-center justify-center gap-2 transition-all"
                            >
                                <Zap className="w-3.5 h-3.5" />
                                Deploy All 3 Agents
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Agent Sidebar (right) ─────────────────────────────────── */}
                <div className="w-[280px] flex flex-col overflow-hidden bg-background shrink-0">

                    {/* Sidebar header */}
                    <div className="h-9 flex items-center justify-between px-4 border-b border-border/30 shrink-0">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                            {anyDeployed ? 'Agent Battle' : 'Configure Agents'}
                        </span>
                        {anyDeployed && (
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                <span className="text-[10px] font-mono text-primary font-bold">LIVE</span>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto">

                        {/* Leaderboard */}
                        {anyDeployed && (
                            <div className="p-3 border-b border-border/25">
                                <div className="flex items-center gap-1.5 mb-2.5">
                                    <Trophy className="w-3 h-3 text-primary" />
                                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Rankings</span>
                                </div>
                                <div className="space-y-1.5">
                                    {leaderboard.map((agent, i) => (
                                        <div
                                            key={agent.id}
                                            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-500 ${rankMotion[agent.id] === 'up' ? '-translate-y-1' : ''} ${rankMotion[agent.id] === 'down' ? 'translate-y-1' : ''}`}
                                            style={{ backgroundColor: agent.def.colorBg, border: `1px solid ${agent.def.colorBorder}` }}
                                        >
                                            <span className="text-[10px] font-mono text-muted-foreground w-3">{i + 1}</span>
                                            <agent.def.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: agent.def.color }} />
                                            <span className="text-[11px] font-mono font-bold flex-1 truncate" style={{ color: agent.def.color }}>
                                                {agent.def.name}
                                            </span>
                                            <span className="text-[9px] font-mono text-muted-foreground/70">
                                                ${agent.betUnit.toFixed(2)} · {agent.wins}/{agent.wins + agent.losses}
                                            </span>
                                            <span className={`text-[11px] font-mono font-bold ${(agent.balance - agent.deposit) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                {(agent.balance - agent.deposit) >= 0 ? '+' : ''}${(agent.balance - agent.deposit).toFixed(2)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2.5 grid grid-cols-2 gap-2 text-[10px] font-mono">
                                    <div className="text-muted-foreground">
                                        Session <span className="text-foreground font-bold">{fmtTime(sessionSec)}</span>
                                    </div>
                                    <div className="text-muted-foreground text-right">
                                        Total <span className="text-foreground font-bold">
                                            ${agents.filter(a => a.deployed).reduce((s, a) => s + a.balance, 0).toFixed(2)} USDC
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Agent cards */}
                        <div className="p-3 space-y-2.5">
                            {agents.map(agent => {
                                const def = AGENT_DEFS.find(d => d.id === agent.id)!

                                return (
                                    <div
                                        key={agent.id}
                                        className="rounded-xl border border-border/40 overflow-hidden"
                                        style={agent.deployed ? { borderColor: def.colorBorder } : undefined}
                                    >
                                        {/* Card header row */}
                                        <button
                                            onClick={() => !agent.deployed && updateAgent(agent.id, { expanded: !agent.expanded })}
                                            className="w-full flex items-center gap-2.5 p-3 hover:bg-card/40 transition-colors"
                                        >
                                            <div
                                                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                                                style={{ backgroundColor: def.colorBg, border: `1px solid ${def.colorBorder}` }}
                                            >
                                                <def.Icon className="w-3.5 h-3.5" style={{ color: def.color }} />
                                            </div>
                                            <div className="flex-1 text-left min-w-0">
                                                <div className="text-[11px] font-mono font-bold truncate" style={{ color: def.color }}>
                                                    {def.name}
                                                </div>
                                                <div className="text-[9px] font-mono text-muted-foreground/60 truncate">
                                                    {agent.deployed
                                                        ? (agent.exited
                                                            ? (agent.balance <= 0
                                                                ? 'Out of funds'
                                                                : agent.betsRemaining <= 0
                                                                    ? 'Bet slots exhausted'
                                                                    : agent.exitReason === 'tp'
                                                                        ? 'Take profit hit'
                                                                        : 'Stop loss hit')
                                                            : `Active · betting $${agent.betUnit.toFixed(2)}`)
                                                        : def.desc}
                                                </div>
                                            </div>
                                            {agent.deployed ? (
                                                <span className="text-[11px] font-mono font-bold text-foreground">
                                                    {agent.exited ? `$${agent.balance.toFixed(2)}` : `$${agent.betUnit.toFixed(2)}`}
                                                </span>
                                            ) : (
                                                agent.expanded
                                                    ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                                                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                                            )}
                                        </button>

                                        {/* Expanded config form */}
                                        {agent.expanded && !agent.deployed && (
                                            <div className="px-3 pb-3 border-t border-border/30 space-y-2.5 pt-2.5">

                                                {/* Deposit */}
                                                <div>
                                                    <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Deposit (USDC)</label>
                                                    <input
                                                        type="number"
                                                        value={agent.deposit}
                                                        onChange={e => updateAgent(agent.id, { deposit: Number(e.target.value) })}
                                                        className="mt-1 w-full h-7 px-2.5 rounded-md border border-border/60 bg-card text-xs font-mono text-foreground focus:outline-none focus:border-primary/60 transition-colors"
                                                    />
                                                </div>

                                                {/* TP / SL */}
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Take Profit</label>
                                                        <div className="mt-1 relative">
                                                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-green-400">+$</span>
                                                            <input
                                                                type="number"
                                                                value={agent.takeProfit}
                                                                onChange={e => updateAgent(agent.id, { takeProfit: Number(e.target.value) })}
                                                                className="w-full h-7 pl-6 pr-2 rounded-md border border-green-500/30 bg-card text-xs font-mono text-foreground focus:outline-none focus:border-green-500/60 transition-colors"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Stop Loss</label>
                                                        <div className="mt-1 relative">
                                                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-red-400">-$</span>
                                                            <input
                                                                type="number"
                                                                value={agent.stopLoss}
                                                                onChange={e => updateAgent(agent.id, { stopLoss: Number(e.target.value) })}
                                                                className="w-full h-7 pl-6 pr-2 rounded-md border border-red-500/30 bg-card text-xs font-mono text-foreground focus:outline-none focus:border-red-500/60 transition-colors"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Entry mode */}
                                                <div>
                                                    <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Entry Condition</label>
                                                    <div className="mt-1 flex gap-1">
                                                        {(['now', 'price', 'time'] as const).map(mode => (
                                                            <button
                                                                key={mode}
                                                                onClick={() => updateAgent(agent.id, { entryMode: mode })}
                                                                className={`flex-1 h-6 text-[9px] font-mono rounded-md border transition-colors ${agent.entryMode === mode
                                                                        ? 'border-primary/60 bg-primary/20 text-primary'
                                                                        : 'border-border/40 text-muted-foreground hover:border-border/60'
                                                                    }`}
                                                            >
                                                                {mode === 'now' ? 'Now' : mode === 'price' ? '@Price' : '@Time'}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    {agent.entryMode === 'price' && (
                                                        <input
                                                            type="number"
                                                            placeholder="Enter ETH price..."
                                                            value={agent.entryPrice}
                                                            onChange={e => updateAgent(agent.id, { entryPrice: e.target.value })}
                                                            className="mt-1.5 w-full h-7 px-2.5 rounded-md border border-border/60 bg-card text-xs font-mono text-foreground focus:outline-none focus:border-primary/60 transition-colors"
                                                        />
                                                    )}
                                                    {agent.entryMode === 'time' && (
                                                        <input
                                                            type="time"
                                                            value={agent.entryTime}
                                                            onChange={e => updateAgent(agent.id, { entryTime: e.target.value })}
                                                            className="mt-1.5 w-full h-7 px-2.5 rounded-md border border-border/60 bg-card text-xs font-mono text-foreground focus:outline-none focus:border-primary/60 transition-colors"
                                                        />
                                                    )}
                                                </div>

                                                {/* Deploy button */}
                                                <button
                                                    onClick={() => setFundingModal(agent.id)}
                                                    className="w-full h-8 rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest transition-all"
                                                    style={{
                                                        color: def.color,
                                                        backgroundColor: def.colorBg,
                                                        border: `1px solid ${def.colorBorder}`,
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = def.color + '30')}
                                                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = def.colorBg)}
                                                >
                                                    Deploy {def.name} Agent
                                                </button>
                                            </div>
                                        )}

                                        {/* Deployed stats strip */}
                                        {agent.deployed && (
                                            <div className="px-3 pb-2.5 border-t border-border/20 pt-2">
                                                <div className="grid grid-cols-3 gap-1 text-center text-[9px] font-mono">
                                                    <div>
                                                        <div className="text-muted-foreground/60">Bet</div>
                                                        <div className="text-foreground font-bold">${agent.betUnit.toFixed(2)}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-muted-foreground/60">Balance</div>
                                                        <div className="text-foreground font-bold">${agent.balance.toFixed(2)}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-muted-foreground/60">W/L</div>
                                                        <div className="text-primary font-bold">{agent.wins}/{agent.wins + agent.losses}</div>
                                                    </div>
                                                </div>
                                                <div className="mt-1 text-[8px] font-mono text-muted-foreground/60 text-center">
                                                    Bets left: {agent.betsRemaining}/{BET_SLOTS}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Bottom note */}
                    <div className="px-4 py-2.5 border-t border-border/30 shrink-0">
                        <p className="text-[9px] font-mono text-muted-foreground/40 text-center">
                            SIMULATION · no real funds used
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Restart Modal ─────────────────────────────────────────────── */}
            {showRestartModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                    <div className="w-[360px] rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <div className="text-sm font-mono font-bold text-foreground text-center">Simulation Session Ended</div>
                        <p className="mt-2 text-[11px] font-mono text-muted-foreground text-center">
                            All deployed agents depleted their active bankroll or bet slots.
                        </p>
                        <div className="mt-4 space-y-2">
                            {agents.filter(a => a.deployed).map(a => {
                                const def = AGENT_DEFS.find(d => d.id === a.id)!
                                return (
                                    <div
                                        key={a.id}
                                        className="flex items-center justify-between px-3 py-2 rounded-lg border"
                                        style={{ borderColor: def.colorBorder, backgroundColor: def.colorBg }}
                                    >
                                        <span className="text-xs font-mono font-bold" style={{ color: def.color }}>
                                            {def.emoji} {def.name}
                                        </span>
                                        <span className="text-xs font-mono text-foreground">
                                            ${a.balance.toFixed(2)} · {a.wins}/{a.wins + a.losses}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                        <button
                            onClick={restartSimulation}
                            className="mt-5 w-full h-10 rounded-xl text-sm font-mono font-bold uppercase tracking-widest text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
                        >
                            Restart Simulation
                        </button>
                    </div>
                </div>
            )}

            {/* ── Funding Modal ──────────────────────────────────────────────── */}
            {fundingModal && (() => {
                const isAll = fundingModal === 'all'
                const singleDef = isAll ? null : AGENT_DEFS.find(d => d.id === fundingModal)!
                const SingleIcon = singleDef?.Icon ?? null
                const totalDeposit = isAll
                    ? agents.filter(a => !a.deployed).reduce((s, a) => s + a.deposit, 0)
                    : agents.find(a => a.id === fundingModal)!.deposit

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                        <div className="w-[320px] rounded-2xl border border-border bg-card p-6 shadow-2xl">

                            {/* Modal header */}
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-2.5">
                                    {isAll ? (
                                        <div className="flex -space-x-1.5">
                                            {AGENT_DEFS.map(d => (
                                                <div key={d.id} className="w-7 h-7 rounded-lg flex items-center justify-center border border-background" style={{ backgroundColor: d.colorBg }}>
                                                    <d.Icon className="w-3.5 h-3.5" style={{ color: d.color }} />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: singleDef!.colorBg, border: `1px solid ${singleDef!.colorBorder}` }}>
                                            {SingleIcon && <SingleIcon className="w-4 h-4" style={{ color: singleDef!.color }} />}
                                        </div>
                                    )}
                                    <div>
                                        <div className="text-sm font-mono font-bold text-foreground">
                                            {isAll ? 'Deploy All Agents' : `Fund ${singleDef!.name}`}
                                        </div>
                                        <div className="text-[10px] font-mono text-muted-foreground">Simulation deployment</div>
                                    </div>
                                </div>
                                <button onClick={() => setFundingModal(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Summary rows */}
                            <div className="space-y-2 mb-5">
                                {isAll ? (
                                    agents.filter(a => !a.deployed).map(a => {
                                        const d = AGENT_DEFS.find(x => x.id === a.id)!
                                        return (
                                            <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border/40">
                                                <div className="flex items-center gap-2">
                                                    <d.Icon className="w-3.5 h-3.5" style={{ color: d.color }} />
                                                    <span className="text-xs font-mono font-bold" style={{ color: d.color }}>{d.name}</span>
                                                </div>
                                                <span className="text-xs font-mono text-foreground font-bold">{a.deposit} USDC</span>
                                            </div>
                                        )
                                    })
                                ) : (
                                    <>
                                        <div className="flex justify-between px-3 py-2 rounded-lg bg-background border border-border/40">
                                            <span className="text-xs font-mono text-muted-foreground">Deposit</span>
                                            <span className="text-xs font-mono font-bold">{totalDeposit} USDC</span>
                                        </div>
                                        <div className="flex justify-between px-3 py-2 rounded-lg bg-background border border-border/40">
                                            <span className="text-xs font-mono text-muted-foreground">Take Profit</span>
                                            <span className="text-xs font-mono text-green-400 font-bold">+${agents.find(a => a.id === fundingModal)!.takeProfit}</span>
                                        </div>
                                        <div className="flex justify-between px-3 py-2 rounded-lg bg-background border border-border/40">
                                            <span className="text-xs font-mono text-muted-foreground">Stop Loss</span>
                                            <span className="text-xs font-mono text-red-400 font-bold">-${agents.find(a => a.id === fundingModal)!.stopLoss}</span>
                                        </div>
                                    </>
                                )}
                                <div className="flex justify-between px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                                    <span className="text-xs font-mono text-muted-foreground">Total</span>
                                    <span className="text-xs font-mono font-bold text-primary">{totalDeposit} USDC</span>
                                </div>
                                <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                                    <p className="text-[9px] font-mono text-amber-500/70 text-center">
                                        SIMULATION MODE · No real USDC will be used
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => confirmDeploy(fundingModal)}
                                className="w-full h-10 rounded-xl text-sm font-mono font-bold uppercase tracking-widest text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
                            >
                                Confirm & Deploy
                            </button>
                        </div>
                    </div>
                )
            })()}
        </div>
    )
}
