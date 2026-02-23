import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ArrowRight, Clock, Zap, Shield, Users, ChevronDown } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { api, Contest } from '@/services/apiService'
import { GridCanvas } from '@/components/grid/GridCanvas'
import { useGridViewport } from '@/hooks/useGridViewport'
import { Grid, Cell, PricePoint } from '@/types/grid'
import { BlocksrideLogo } from '@/components/BlocksrideLogo'
import { sdk } from '@farcaster/miniapp-sdk'

// ── Deterministic seeded RNG ──────────────────────────────────────────────────
function seededRng(seed: number) {
    return () => {
        let t = (seed += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ── Background live grid ──────────────────────────────────────────────────────
const BackgroundGrid = ({ ethPrice }: { ethPrice: string }) => {
    const parse = (p: string) => (p === '---' ? 3452 : parseFloat(p.replace(/[^0-9.]/g, '')))
    const startPrice = parse(ethPrice)

    const [currentPrice, setCurrentPrice] = useState(startPrice)
    const [prices, setPrices] = useState<PricePoint[]>([])
    const [grid, setGrid] = useState<Grid | null>(null)
    const [cells, setCells] = useState<Cell[]>([])
    const [betResults, setBetResults] = useState<Record<string, string>>({})
    const containerRef = useRef<HTMLDivElement>(null)
    const viewport = useGridViewport(Math.floor(startPrice), 60, containerRef, false)

    useEffect(() => {
        const rng = seededRng(99)
        const tf = 60
        const now = Math.floor(Date.now() / (tf * 1000)) * (tf * 1000)
        const interval = 4
        const anchor = Math.floor(startPrice)

        const mockGrid: Grid = {
            grid_id: 'bg-grid',
            asset_id: 'ETH-USD',
            timeframe_sec: tf,
            start_time: new Date(now - tf * 12 * 1000).toISOString(),
            end_time: new Date(now + tf * 200 * 1000).toISOString(),
            anchor_price: anchor,
            price_interval: interval,
        }
        setGrid(mockGrid)

        const pts: PricePoint[] = []
        let p = startPrice, trend = 0
        for (let i = 0; i < 6000; i++) {
            const delta = (rng() - 0.5) * 1.5
            trend = trend * 0.98 - (p - startPrice) * 0.002
            p += delta + trend
            pts.push({ time: now - (6000 - i) * 100, price: p })
        }
        setPrices(pts)
        setCurrentPrice(p)

        const dCells: Cell[] = []
        const dResults: Record<string, string> = {}
        const gs = new Date(mockGrid.start_time).getTime()

        for (let w = 0; w < 22; w++) {
            const ws = gs + w * tf * 1000
            const we = ws + tf * 1000
            if (ws < now - 14 * 60 * 1000) continue
            const isPast = we < now
            let mn = Infinity, mx = -Infinity, found = false
            for (const pp of pts) {
                if (pp.time >= ws && pp.time <= we) {
                    if (pp.price < mn) mn = pp.price
                    if (pp.price > mx) mx = pp.price
                    found = true
                }
            }
            const lo = found ? Math.floor((mn - anchor) / interval) - 1 : -3
            const hi = found ? Math.floor((mx - anchor) / interval) + 1 : 3
            for (let b = lo; b <= hi; b++) {
                const bp = anchor + b * interval
                const EPS = 1e-4
                const win = isPast && found && mx >= bp - EPS && mn <= bp + interval + EPS
                if (rng() > 0.45 || win) {
                    const id = `bg-${w}-${b}`
                    dCells.push({
                        cell_id: id, grid_id: 'bg-grid', asset_id: 'ETH-USD',
                        window_index: w, price_band_index: b,
                        t_start: new Date(ws).toISOString(), t_end: new Date(we).toISOString(),
                        p_low: bp, p_high: bp + interval,
                        total_stake: Math.floor(rng() * 800) + 100,
                    })
                    if (rng() > 0.35)
                        dResults[id] = isPast ? (win ? 'won' : 'lost') : 'pending'
                }
            }
        }
        setCells(dCells)
        setBetResults(dResults)
    }, [startPrice])

    useEffect(() => {
        let trend = 0
        const rng = seededRng(55555)
        const id = setInterval(() => {
            const rv = rng()
            setCurrentPrice(prev => {
                const next = prev + (rv - 0.5) * 1.5 + (trend = trend * 0.98 - (prev - startPrice) * 0.002)
                setPrices(pp => [...pp.slice(-10000), { time: Date.now(), price: next }])
                return next
            })
        }, 100)
        return () => clearInterval(id)
    }, [startPrice])

    return (
        <div ref={containerRef} className="absolute inset-0">
            <GridCanvas
                width={viewport.dimensions.width}
                height={viewport.dimensions.height}
                grid={grid}
                cells={cells}
                prices={prices}
                currentPrice={currentPrice}
                selectedCells={[]}
                visibleTimeRange={{ start: viewport.visibleStart, end: viewport.visibleEnd }}
                visiblePriceRange={{ min: viewport.visibleMinPrice, max: viewport.visibleMaxPrice }}
                mousePos={null}
                isDragging={false}
                onCellClick={() => {}}
                betResults={betResults}
                cellStakes={cells.reduce((a, c) => ({ ...a, [c.cell_id]: c.total_stake || 0 }), {})}
            />
        </div>
    )
}

// ── Step card ─────────────────────────────────────────────────────────────────
const Step = ({ n, title, body }: { n: string; title: string; body: string }) => (
    <div className="flex flex-col gap-3 p-6 rounded-xl border border-border bg-card/60 backdrop-blur-sm hover:border-primary/40 transition-colors">
        <div className="w-8 h-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center text-primary font-mono font-bold text-sm">
            {n}
        </div>
        <h3 className="font-semibold text-foreground text-base leading-tight">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
)

// ── Landing ───────────────────────────────────────────────────────────────────
export const Landing = () => {
    const navigate = useNavigate()
    const { authenticated, loading, signOut, walletAddress, signIn } = useAuth()
    const [isMiniApp, setIsMiniApp] = useState(false)
    const miniAppLoginRef = useRef(false)
    const [upcomingContests, setUpcomingContests] = useState<Contest[]>([])
    const [ethPrice, setEthPrice] = useState('---')
    const [ethChange, setEthChange] = useState('---')
    const [timeStr, setTimeStr] = useState('')
    const howRef = useRef<HTMLElement>(null)

    // Clock
    useEffect(() => {
        const tick = () => setTimeStr(new Date().toLocaleTimeString('en-US', { hour12: false }))
        tick()
        const i = setInterval(tick, 1000)
        return () => clearInterval(i)
    }, [])

    // ETH price
    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/coingecko/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true')
                const d = await res.json()
                setEthPrice(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(d.ethereum.usd))
                setEthChange(d.ethereum.usd_24h_change.toFixed(2))
            } catch { /* silent */ }
        }
        load()
        const i = setInterval(load, 15000)
        return () => clearInterval(i)
    }, [])

    // Contests
    useEffect(() => {
        api.getUpcomingContests().then(r => setUpcomingContests(r.data.contests || [])).catch(() => {})
    }, [])

    // Auto-navigate authenticated users straight to terminal
    useEffect(() => {
        if (!loading && authenticated) navigate('/terminal')
    }, [loading, authenticated, navigate])

    useEffect(() => {
        if (typeof window === 'undefined') return
        let cancelled = false

        const loadMiniAppContext = async () => {
            try {
                const inMiniApp = await sdk.isInMiniApp()
                if (!inMiniApp || cancelled) return
                setIsMiniApp(true)

                const context = await sdk.context
                if (cancelled) return
                api.logMiniAppContext({
                    context,
                    user_agent: navigator.userAgent,
                    url: window.location.href,
                }).catch(() => {
                    // Optional analytics log; ignore failures
                })

                if (!authenticated && !loading && !miniAppLoginRef.current) {
                    miniAppLoginRef.current = true
                    signIn()
                }
            } catch (error) {
                console.error('Failed to load mini app context:', error)
            }
        }

        loadMiniAppContext()
        return () => {
            cancelled = true
        }
    }, [authenticated, loading, signIn])

    const isUp = !ethChange.startsWith('-')

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col dark overflow-x-hidden">

            {/* ── Minimal header ────────────────────────────────────────── */}
            <header className="fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-6 lg:px-10 border-b border-border/60 bg-background/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <BlocksrideLogo size={28} wordmark />
                    {isMiniApp && (
                        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/80 border border-primary/30 px-2 py-0.5 rounded-full">
                            Base Mini App
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {authenticated ? (
                        <>
                            <span className="hidden sm:block text-[11px] font-mono text-muted-foreground">
                                {walletAddress?.slice(0, 6)}…{walletAddress?.slice(-4)}
                            </span>
                            <Button size="sm" onClick={() => navigate('/terminal')}
                                className="h-8 px-4 text-xs font-mono font-bold bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide">
                                Terminal <ArrowRight className="w-3 h-3 ml-1" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => signOut()}
                                className="h-8 text-xs font-mono text-muted-foreground hover:text-foreground">
                                Disconnect
                            </Button>
                        </>
                    ) : (
                        <Button size="sm" onClick={() => navigate('/terminal')}
                            className="h-8 px-5 text-xs font-mono font-bold bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide shadow-[0_0_14px_hsl(var(--primary)/0.4)]">
                            Launch App
                        </Button>
                    )}
                </div>
            </header>

            {/* ── Hero: full-viewport with grid bg ─────────────────────── */}
            <section className="relative flex items-center justify-center min-h-screen pt-12">

                {/* Live grid as wallpaper */}
                <div className="absolute inset-0 opacity-35 pointer-events-none">
                    <BackgroundGrid ethPrice={ethPrice} />
                </div>

                {/* Gradient vignette so text reads clearly */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_50%_50%,transparent_20%,hsl(var(--background)/0.85)_70%,hsl(var(--background))_100%)] pointer-events-none" />

                {/* Centred hero content */}
                <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-2xl">

                    {/* Live badge */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[11px] font-mono font-semibold uppercase tracking-widest mb-8">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        Live on Base · {timeStr}
                    </div>

                    {/* Main headline */}
                    <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] mb-6">
                        Predict<br />
                        <span className="text-primary">every</span><br />
                        minute.
                    </h1>

                    <p className="text-lg text-muted-foreground mb-4 leading-relaxed max-w-md">
                        Prediction markets on ETH price every 60 seconds. Fully on-chain, gasless.
                    </p>

                    {/* Live ETH price */}
                    <div className="flex items-center gap-3 mb-10 text-sm font-mono">
                        <span className="text-muted-foreground">ETH</span>
                        <span className="text-foreground font-semibold">{ethPrice}</span>
                        {ethChange !== '---' && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${isUp ? 'bg-trade-up/15 text-trade-up' : 'bg-trade-down/15 text-trade-down'}`}>
                                {isUp ? '+' : ''}{ethChange}%
                            </span>
                        )}
                    </div>

                    {/* Scroll cue */}
                    <button
                        onClick={() => howRef.current?.scrollIntoView({ behavior: 'smooth' })}
                        className="mt-16 flex flex-col items-center gap-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        aria-label="Scroll to how it works"
                    >
                        <span className="text-[10px] font-mono uppercase tracking-widest">How it works</span>
                        <ChevronDown className="w-4 h-4 animate-bounce" />
                    </button>
                </div>
            </section>

            {/* ── How it works ─────────────────────────────────────────── */}
            <section ref={howRef} className="relative py-24 px-6 lg:px-16 bg-background border-t border-border">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-14">
                        <span className="text-[11px] font-mono text-primary uppercase tracking-widest">How it works</span>
                        <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Three steps to win your first bet.</h2>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                        <Step
                            n="01"
                            title="Pick a Box"
                            body="Tap any future cell to choose where you think price will close."
                        />
                        <Step
                            n="02"
                            title="Stake USDC"
                            body="No ETH needed for gas, ever."
                        />
                        <Step
                            n="03"
                            title="Winners split the pool"
                            body="You win, you get a proportional share of the total pool minus 2% fee."
                        />
                    </div>

                    {/* Stat pills */}
                    <div className="mt-12 flex flex-wrap justify-center gap-4">
                        {[
                            { icon: Zap, label: 'Gasless', sub: 'No additional cost' },
                            { icon: Shield, label: 'Price', sub: 'Open, Transparent prices' },
                            { icon: Users, label: 'Free Market', sub: 'Pool-vs-pool, no house' },
                            { icon: Clock, label: '60-second windows', sub: 'New round every minute' },
                        ].map(({ icon: Icon, label, sub }) => (
                            <div key={label} className="flex items-center gap-3 px-5 py-3 rounded-xl border border-border bg-card/50 text-sm">
                                <Icon className="w-4 h-4 text-primary shrink-0" />
                                <div>
                                    <div className="font-semibold text-foreground text-xs leading-tight">{label}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">{sub}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Upcoming contests */}
                    {upcomingContests.length > 0 && (
                        <div className="mt-14">
                            <h3 className="text-center text-sm font-mono text-muted-foreground uppercase tracking-widest mb-6">
                                Upcoming Contests
                            </h3>
                            <div className="max-w-lg mx-auto space-y-3">
                                {upcomingContests.slice(0, 3).map(c => (
                                    <div key={c.contest_id} onClick={() => navigate('/terminal')}
                                        className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:border-primary/40 transition-all cursor-pointer group">
                                        <div>
                                            <div className="text-sm font-semibold text-foreground">{c.name}</div>
                                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                                {c.asset_id} · {new Date(c.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {new Date(c.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Bottom CTA */}
                    <div className="mt-16 flex flex-col items-center gap-4">
                        <a href="https://t.me/blocksride" target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-3 h-13 px-10 text-base font-mono font-bold bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-widest rounded-lg shadow-[0_0_30px_hsl(var(--primary)/0.4)] transition-all hover:shadow-[0_0_40px_hsl(var(--primary)/0.55)]">
                            {/* Telegram icon */}
                            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                            </svg>
                            Join Us
                        </a>
                        <p className="text-[11px] font-mono text-muted-foreground/50">blocksride.xyz</p>
                    </div>
                </div>
            </section>

            {/* ── Footer ───────────────────────────────────────────────── */}
            <footer className="border-t border-border py-6 px-6 lg:px-10 bg-background">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                    <div className="flex items-center gap-4">
                        <span className="font-bold text-muted-foreground/80">blocksride</span>
                        <span>© 2026</span>
                    </div>
                    <div className="flex items-center gap-6">
                        <a href="https://x.com/blocksride_app" target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 hover:text-primary transition-colors">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                            </svg>
                            @blocksride_app
                        </a>
                        <span onClick={() => navigate('/terms')} className="hover:text-primary cursor-pointer transition-colors">
                            Terms
                        </span>
                        <a href="https://base.org" target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 opacity-50 hover:opacity-80 transition-opacity"
                            aria-label="Built on Base">
                            <span className="text-[9px] uppercase tracking-widest">Built on</span>
                            <img src="/logo/base-lockup-white.svg" alt="Base" className="h-3 w-auto" />
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    )
}
