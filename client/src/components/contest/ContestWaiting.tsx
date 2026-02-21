import { useContest } from '@/contexts/ContestContext'
import { Button } from '@/components/ui/button'
import {
    Trophy,
    ArrowLeft,
    TrendingUp,
    Zap,
    Target,
    Timer,
    BarChart3
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { TerminalHeader } from '@/components/terminal/TerminalHeader'

export function ContestWaiting() {
    const { selectedContest, timeUntilStart } = useContest()
    const navigate = useNavigate()

    if (!selectedContest) return null

    // Parse time remaining into components
    const hours = timeUntilStart ? Math.floor(timeUntilStart / 3600) : 0
    const minutes = timeUntilStart ? Math.floor((timeUntilStart % 3600) / 60) : 0
    const seconds = timeUntilStart ? timeUntilStart % 60 : 0

    return (
        <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden dark">
            <TerminalHeader />

            {/* Main Content */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* Left Panel - Contest Info (hidden on mobile) */}
                <div className="hidden md:flex w-80 border-r border-border bg-card/30 flex-col">
                    {/* Contest Title */}
                    <div className="p-4 border-b border-border">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Trophy className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                                <h2 className="font-bold text-foreground text-sm">{selectedContest.name}</h2>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-yellow-500 animate-pulse" />
                                    <span className="text-[10px] text-amber-600 dark:text-yellow-500 font-semibold uppercase">Upcoming</span>
                                </div>
                            </div>
                        </div>
                        {selectedContest.description && (
                            <p className="text-xs text-muted-foreground">{selectedContest.description}</p>
                        )}
                    </div>

                    {/* Contest Parameters */}
                    <div className="p-4 border-b border-border">
                        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
                            Trading Parameters
                        </h3>
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <TrendingUp className="w-3.5 h-3.5" />
                                    Asset
                                </div>
                                <span className="text-xs font-bold text-foreground font-mono">
                                    {selectedContest.asset_id}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <BarChart3 className="w-3.5 h-3.5" />
                                    Price Band
                                </div>
                                <span className="text-xs font-bold text-foreground font-mono">
                                    ${selectedContest.price_interval.toFixed(2)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Timer className="w-3.5 h-3.5" />
                                    Window
                                </div>
                                <span className="text-xs font-bold text-foreground font-mono">
                                    {selectedContest.timeframe_sec}s
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Target className="w-3.5 h-3.5" />
                                    Bands
                                </div>
                                <span className="text-xs font-bold text-foreground font-mono">
                                    {selectedContest.bands_above + selectedContest.bands_below}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Schedule */}
                    <div className="p-4 flex-1">
                        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
                            Schedule
                        </h3>
                        <div className="space-y-3">
                            <div className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                                <div className="text-[10px] text-muted-foreground mb-1">Start Time</div>
                                <div className="text-xs font-mono font-medium text-foreground">
                                    {new Date(selectedContest.start_time).toLocaleDateString('en-US', {
                                        weekday: 'short',
                                        month: 'short',
                                        day: 'numeric'
                                    })}
                                </div>
                                <div className="text-sm font-mono font-bold text-primary">
                                    {new Date(selectedContest.start_time).toLocaleTimeString('en-US', {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                                <div className="text-[10px] text-muted-foreground mb-1">End Time</div>
                                <div className="text-xs font-mono font-medium text-foreground">
                                    {new Date(selectedContest.end_time).toLocaleDateString('en-US', {
                                        weekday: 'short',
                                        month: 'short',
                                        day: 'numeric'
                                    })}
                                </div>
                                <div className="text-sm font-mono font-bold text-foreground">
                                    {new Date(selectedContest.end_time).toLocaleTimeString('en-US', {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Center - Countdown */}
                <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 relative overflow-hidden">
                    {/* Background Grid Pattern */}
                    <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.02]" style={{
                        backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
                        backgroundSize: '50px 50px'
                    }} />

                    {/* Animated Glow */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl animate-pulse" />

                    <div className="relative z-10 text-center">
                        {/* Status Badge */}
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 border border-amber-400 dark:bg-yellow-500/10 dark:border-yellow-500/30 mb-8">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 dark:bg-yellow-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600 dark:bg-yellow-500" />
                            </span>
                            <span className="text-xs font-bold text-amber-700 dark:text-yellow-500 uppercase tracking-wider">
                                Contest Starting Soon
                            </span>
                        </div>

                        {/* Countdown Label */}
                        <p className="text-sm text-muted-foreground mb-4 font-medium">
                            Trading begins in
                        </p>

                        {/* Countdown Timer */}
                        {timeUntilStart !== null && timeUntilStart > 0 ? (
                            <div className="flex items-center justify-center gap-2 md:gap-3 mb-6 md:mb-8">
                                {/* Hours */}
                                <div className="flex flex-col items-center">
                                    <div className="w-16 h-20 md:w-24 md:h-28 rounded-xl bg-card border border-border shadow-lg flex items-center justify-center relative overflow-hidden">
                                        <div className="absolute inset-0 bg-gradient-to-b from-foreground/5 to-transparent" />
                                        <span className="text-3xl md:text-5xl font-mono font-bold text-foreground relative z-10">
                                            {hours.toString().padStart(2, '0')}
                                        </span>
                                    </div>
                                    <span className="text-[8px] md:text-[10px] text-muted-foreground mt-1.5 md:mt-2 uppercase tracking-widest font-semibold">Hours</span>
                                </div>

                                <span className="text-2xl md:text-4xl font-bold text-muted-foreground/30 mb-4 md:mb-6">:</span>

                                {/* Minutes */}
                                <div className="flex flex-col items-center">
                                    <div className="w-16 h-20 md:w-24 md:h-28 rounded-xl bg-card border border-border shadow-lg flex items-center justify-center relative overflow-hidden">
                                        <div className="absolute inset-0 bg-gradient-to-b from-foreground/5 to-transparent" />
                                        <span className="text-3xl md:text-5xl font-mono font-bold text-foreground relative z-10">
                                            {minutes.toString().padStart(2, '0')}
                                        </span>
                                    </div>
                                    <span className="text-[8px] md:text-[10px] text-muted-foreground mt-1.5 md:mt-2 uppercase tracking-widest font-semibold">Minutes</span>
                                </div>

                                <span className="text-2xl md:text-4xl font-bold text-muted-foreground/30 mb-4 md:mb-6">:</span>

                                {/* Seconds */}
                                <div className="flex flex-col items-center">
                                    <div className="w-16 h-20 md:w-24 md:h-28 rounded-xl bg-card border border-primary/30 shadow-lg shadow-primary/10 flex items-center justify-center relative overflow-hidden">
                                        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent" />
                                        <span className="text-3xl md:text-5xl font-mono font-bold text-primary relative z-10">
                                            {seconds.toString().padStart(2, '0')}
                                        </span>
                                    </div>
                                    <span className="text-[8px] md:text-[10px] text-muted-foreground mt-1.5 md:mt-2 uppercase tracking-widest font-semibold">Seconds</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-2xl md:text-4xl font-mono font-bold text-primary mb-6 md:mb-8 animate-pulse">
                                Starting...
                            </div>
                        )}

                        {/* Info Text */}
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">
                            The trading grid will appear automatically when the contest begins.
                            <br />
                            <span className="text-xs">Get ready to place your predictions!</span>
                        </p>
                    </div>
                </div>

                {/* Right Panel - Quick Stats (hidden on mobile) */}
                <div className="hidden md:flex w-64 border-l border-border bg-card/30 flex-col">
                    <div className="p-4 border-b border-border">
                        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                            Quick Tips
                        </h3>
                    </div>

                    <div className="p-4 flex-1 space-y-4">
                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                            <div className="flex items-start gap-2">
                                <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Zap className="w-3 h-3 text-primary" />
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-foreground mb-1">Quick Entry</div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                        Click on any cell in the grid to place a prediction bet instantly.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                            <div className="flex items-start gap-2">
                                <div className="w-6 h-6 rounded-md bg-green-100 dark:bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Target className="w-3 h-3 text-green-600 dark:text-green-500" />
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-foreground mb-1">Win Condition</div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                        Price must touch your selected band during the time window to win.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                            <div className="flex items-start gap-2">
                                <div className="w-6 h-6 rounded-md bg-amber-100 dark:bg-yellow-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Timer className="w-3 h-3 text-amber-600 dark:text-yellow-500" />
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-foreground mb-1">Time Windows</div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                        Each window is {selectedContest.timeframe_sec} seconds. Bet before the window locks.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer Action */}
                    <div className="p-4 border-t border-border">
                        <Button
                            variant="outline"
                            className="w-full text-xs"
                            onClick={() => navigate('/')}
                        >
                            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                            Back to Hub
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
