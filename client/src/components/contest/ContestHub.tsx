import { useState, useEffect } from 'react'
import { useContest, formatTimeRemaining } from '@/contexts/ContestContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Trophy,
    TrendingUp,
    TrendingDown,
    Zap,
    ChevronRight,
    Activity,
    Flame,
    RefreshCw,
    Clock,
    Terminal,
    Crown,
    Medal,
    ArrowUpRight,
    Wifi
} from 'lucide-react'
import { Contest, api, LeaderboardEntry } from '@/services/apiService'
import { ContestRequirements } from './ContestRequirements'
import { TerminalHeader } from '@/components/terminal/TerminalHeader'
import { useTokenBalance } from '@/hooks/useTokenBalance'

export function ContestHub() {
    const {
        activeContest,
        upcomingContests,
        loading,
        selectContest,
        refreshContests
    } = useContest()

    const { formatted: walletBalance } = useTokenBalance()

    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
    const [leaderboardLoading, setLeaderboardLoading] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [showRequirements, setShowRequirements] = useState(false)
    const [selectedContestForJoin, setSelectedContestForJoin] = useState<Contest | null>(null)
    const [currentTime, setCurrentTime] = useState(new Date())
    const [activeContestTimeRemaining, setActiveContestTimeRemaining] = useState<number>(0)

    useEffect(() => {
        const updateTimers = () => {
            setCurrentTime(new Date())

            if (activeContest) {
                const now = Date.now()
                const endTime = new Date(activeContest.end_time).getTime()
                const remaining = Math.max(0, Math.floor((endTime - now) / 1000))
                setActiveContestTimeRemaining(prev => prev !== remaining ? remaining : prev)
            }
        }

        updateTimers()
        const timer = setInterval(updateTimers, 1000)
        return () => clearInterval(timer)
    }, [activeContest])

    const handleJoinContest = async (contest: Contest) => {
        const hasBalance = Number(walletBalance || '0') > 0

        if (hasBalance) {
            selectContest(contest)
            return
        }

        setSelectedContestForJoin(contest)
        setShowRequirements(true)
    }

    const handleRequirementsMet = () => {
        if (selectedContestForJoin) {
            setShowRequirements(false)
            selectContest(selectedContestForJoin)
        }
    }

    useEffect(() => {
        if (activeContest?.contest_id) {
            fetchLeaderboard(activeContest.contest_id)
        } else {
            setLeaderboard([])
        }
    }, [activeContest?.contest_id])

    const fetchLeaderboard = async (contestId: string) => {
        try {
            setLeaderboardLoading(true)
            const res = await api.getContestLeaderboard(contestId, 10)
            setLeaderboard(res.data.entries || [])
        } catch {
            // Failed to fetch leaderboard
        } finally {
            setLeaderboardLoading(false)
        }
    }

    const handleRefresh = async () => {
        setIsRefreshing(true)
        await refreshContests()
        setTimeout(() => setIsRefreshing(false), 500)
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 dark">
                <TerminalHeader />
                <div className="max-w-7xl mx-auto p-4 space-y-4">
                    <Skeleton className="h-10 w-full bg-zinc-900" />
                    <Skeleton className="h-48 w-full bg-zinc-900" />
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2">
                            <Skeleton className="h-64 w-full bg-zinc-900" />
                        </div>
                        <Skeleton className="h-64 w-full bg-zinc-900" />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono dark">
            <TerminalHeader />

            <div className="relative max-w-7xl mx-auto p-3 md:p-4 space-y-3 md:space-y-4">
                {/* Status Bar */}
                <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/80 border border-zinc-800 rounded text-[10px] md:text-xs overflow-x-auto">
                    <div className="flex items-center gap-4 md:gap-6">
                        <StatusIndicator label="SYS" value="ON" color="green" />
                        <StatusIndicator
                            label="LIVE"
                            value={activeContest ? "YES" : "NO"}
                            color={activeContest ? "green" : "yellow"}
                        />
                        <StatusIndicator
                            label="QUEUED"
                            value={`${upcomingContests.length}`}
                            color="cyan"
                        />
                    </div>
                    <div className="flex items-center gap-3 text-zinc-500">
                        <span className="hidden sm:flex items-center gap-1.5">
                            <Wifi className="w-3 h-3 text-green-500" />
                            <span>CONNECTED</span>
                        </span>
                        <Wifi className="w-3 h-3 text-green-500 sm:hidden" />
                        <span className="font-mono">{currentTime.toLocaleTimeString('en-US', { hour12: false })}</span>
                    </div>
                </div>

                {/* Hero: Active Contest or Waiting State */}
                {activeContest ? (
                    <ActiveContestPanel
                        contest={activeContest}
                        timeRemaining={activeContestTimeRemaining}
                        onJoin={() => handleJoinContest(activeContest)}
                        participantCount={leaderboard.length}
                    />
                ) : (
                    <WaitingPanel upcomingCount={upcomingContests.length} />
                )}

                {/* Content Grid */}
                <div className="grid gap-4 lg:grid-cols-3">
                    {/* Scheduled Rides */}
                    <div className="lg:col-span-2">
                        <TerminalPanel
                            title="SCHEDULED RIDES"
                            icon={<Clock className="w-4 h-4" />}
                            badge={`${upcomingContests.length} QUEUED`}
                            headerAction={
                                <button
                                    onClick={handleRefresh}
                                    className="p-1.5 hover:bg-zinc-800 rounded transition-colors"
                                    disabled={isRefreshing}
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 text-zinc-500 ${isRefreshing ? 'animate-spin' : ''}`} />
                                </button>
                            }
                        >
                            {upcomingContests.length === 0 ? (
                                <div className="p-10 text-center text-zinc-600">
                                    <Clock className="w-8 h-8 mx-auto mb-3 opacity-30" />
                                    <p className="text-sm">No scheduled rides</p>
                                    <p className="text-xs mt-1 text-zinc-700">Check back soon</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-zinc-800/50">
                                    {upcomingContests.map((contest, idx) => (
                                        <ContestRow
                                            key={contest.contest_id}
                                            contest={contest}
                                            onSelect={() => handleJoinContest(contest)}
                                            isNext={idx === 0}
                                        />
                                    ))}
                                </div>
                            )}
                        </TerminalPanel>
                    </div>

                    {/* Leaderboard */}
                    <div>
                        <TerminalPanel
                            title="LEADERBOARD"
                            icon={<Activity className="w-4 h-4" />}
                            badge={activeContest ? "LIVE" : "---"}
                            badgeColor={activeContest ? "green" : "zinc"}
                            className="sticky top-20"
                        >
                            {!activeContest ? (
                                <div className="p-8 text-center text-zinc-600">
                                    <Trophy className="w-8 h-8 mx-auto mb-3 opacity-20" />
                                    <p className="text-sm">No active ride</p>
                                </div>
                            ) : leaderboardLoading ? (
                                <div className="p-4 space-y-2">
                                    {[...Array(5)].map((_, i) => (
                                        <Skeleton key={i} className="h-10 w-full bg-zinc-800" />
                                    ))}
                                </div>
                            ) : leaderboard.length === 0 ? (
                                <div className="p-8 text-center">
                                    <Crown className="w-8 h-8 mx-auto mb-3 text-yellow-500/40" />
                                    <p className="text-sm text-zinc-400">No participants yet</p>
                                    <Button
                                        size="sm"
                                        onClick={() => handleJoinContest(activeContest)}
                                        className="mt-4 bg-green-600 hover:bg-green-700 text-black font-bold"
                                    >
                                        <Zap className="w-3 h-3 mr-1" />
                                        BE FIRST
                                    </Button>
                                </div>
                            ) : (
                                <div className="divide-y divide-zinc-800/50">
                                    {leaderboard.slice(0, 10).map((entry, index) => (
                                        <LeaderboardRow key={entry.user_id} entry={entry} rank={index + 1} />
                                    ))}
                                </div>
                            )}

                            {activeContest && leaderboard.length > 0 && (
                                <div className="p-3 border-t border-zinc-800">
                                    <Button
                                        className="w-full bg-green-600 hover:bg-green-700 text-black font-bold"
                                        onClick={() => handleJoinContest(activeContest)}
                                    >
                                        <Flame className="w-4 h-4 mr-2" />
                                        ENTER RIDE
                                    </Button>
                                </div>
                            )}
                        </TerminalPanel>
                    </div>
                </div>
            </div>

            {selectedContestForJoin && (
                <ContestRequirements
                    isOpen={showRequirements}
                    onClose={() => {
                        setShowRequirements(false)
                        if (selectedContestForJoin) {
                            selectContest(selectedContestForJoin)
                        }
                        setSelectedContestForJoin(null)
                    }}
                    contest={selectedContestForJoin}
                    onRequirementsMet={handleRequirementsMet}
                />
            )}
        </div>
    )
}

function StatusIndicator({ label, value, color }: { label: string; value: string; color: 'green' | 'yellow' | 'red' | 'cyan' | 'zinc' }) {
    const colors = {
        green: 'text-green-500',
        yellow: 'text-yellow-500',
        red: 'text-red-500',
        cyan: 'text-cyan-500',
        zinc: 'text-zinc-500',
    }

    return (
        <div className="flex items-center gap-2">
            <span className="text-zinc-600">{label}:</span>
            <span className={`flex items-center gap-1.5 ${colors[color]}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${colors[color].replace('text-', 'bg-')} ${color === 'green' ? 'animate-pulse' : ''}`} />
                {value}
            </span>
        </div>
    )
}

interface TerminalPanelProps {
    title: string
    icon: React.ReactNode
    badge?: string
    badgeColor?: 'green' | 'yellow' | 'cyan' | 'zinc'
    headerAction?: React.ReactNode
    children: React.ReactNode
    className?: string
}

function TerminalPanel({ title, icon, badge, badgeColor = 'zinc', headerAction, children, className = '' }: TerminalPanelProps) {
    const badgeColors = {
        green: 'text-green-500 border-green-500/30 bg-green-500/10',
        yellow: 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10',
        cyan: 'text-cyan-500 border-cyan-500/30 bg-cyan-500/10',
        zinc: 'text-zinc-500 border-zinc-700 bg-zinc-800/50',
    }

    return (
        <div className={`bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden ${className}`}>
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/80">
                <div className="flex items-center gap-3">
                    <span className="text-cyan-500">{icon}</span>
                    <span className="text-xs font-bold tracking-wider text-zinc-300">{title}</span>
                    {badge && (
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${badgeColors[badgeColor]}`}>
                            {badge}
                        </span>
                    )}
                </div>
                {headerAction}
            </div>
            {children}
        </div>
    )
}

interface ActiveContestPanelProps {
    contest: Contest
    timeRemaining: number
    onJoin: () => void
    participantCount: number
}

function ActiveContestPanel({ contest, timeRemaining, onJoin, participantCount }: ActiveContestPanelProps) {
    const hours = Math.floor(timeRemaining / 3600)
    const minutes = Math.floor((timeRemaining % 3600) / 60)
    const seconds = timeRemaining % 60

    return (
        <div className="relative bg-zinc-900/50 border border-green-500/30 rounded-lg overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-cyan-500/5" />
            <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/10 rounded-full blur-3xl" />

            <div className="relative p-5 md:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <span className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/30 rounded text-xs font-bold text-green-400">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                                </span>
                                LIVE SESSION
                            </span>
                            <span className="text-xs text-zinc-500">
                                {participantCount} TRADER{participantCount !== 1 ? 'S' : ''}
                            </span>
                        </div>

                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-zinc-100 tracking-tight">{contest.name}</h1>
                            {contest.description && (
                                <p className="text-sm text-zinc-500 mt-1">{contest.description}</p>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <DataBadge label="ASSET" value={contest.asset_id} />
                            <DataBadge label="INTERVAL" value={`$${contest.price_interval.toFixed(2)}`} />
                            <DataBadge label="WINDOW" value={`${contest.timeframe_sec}s`} />
                        </div>
                    </div>

                    <div className="flex flex-col items-start lg:items-end gap-4">
                        <div className="lg:text-right">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">SESSION ENDS IN</p>
                            <div className="flex items-center gap-1 font-mono">
                                <TimeUnit value={hours} label="HRS" />
                                <span className="text-2xl text-zinc-600 -mt-3">:</span>
                                <TimeUnit value={minutes} label="MIN" />
                                <span className="text-2xl text-zinc-600 -mt-3">:</span>
                                <TimeUnit value={seconds} label="SEC" />
                            </div>
                        </div>

                        <Button
                            size="lg"
                            onClick={onJoin}
                            className="bg-green-600 hover:bg-green-500 text-black font-bold px-8 shadow-lg shadow-green-500/20 hover:shadow-green-500/40 transition-all"
                        >
                            <Zap className="w-5 h-5 mr-2" />
                            ENTER SESSION
                            <ArrowUpRight className="w-4 h-4 ml-2" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function TimeUnit({ value, label }: { value: number; label: string }) {
    return (
        <div className="flex flex-col items-center">
            <span className="text-3xl font-bold text-green-400 tabular-nums">
                {value.toString().padStart(2, '0')}
            </span>
            <span className="text-[9px] text-zinc-600 tracking-wider">{label}</span>
        </div>
    )
}

function DataBadge({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 border border-zinc-700 rounded text-xs">
            <span className="text-zinc-500">{label}</span>
            <span className="text-cyan-400 font-bold">{value}</span>
        </div>
    )
}

function WaitingPanel({ upcomingCount }: { upcomingCount: number }) {
    return (
        <div className="relative bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden p-5 md:p-6">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-purple-500/5" />

            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-cyan-500" />
                        <span className="text-xs font-bold text-cyan-400 tracking-wider">AWAITING SESSION</span>
                    </div>
                    <h1 className="text-xl md:text-2xl font-bold text-zinc-100">
                        No Active Ride
                    </h1>
                    <p className="text-sm text-zinc-500">
                        {upcomingCount > 0
                            ? `${upcomingCount} ride${upcomingCount !== 1 ? 's' : ''} scheduled — check the queue below.`
                            : 'Check back soon for the next scheduled ride.'}
                    </p>
                </div>

                <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg">
                    <Clock className="w-5 h-5 text-zinc-500 flex-shrink-0" />
                    <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider">NEXT RIDE</p>
                        <p className="text-sm font-bold text-zinc-300">
                            {upcomingCount > 0 ? 'See schedule below' : 'TBD'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

interface ContestRowProps {
    contest: Contest
    onSelect: () => void
    isNext: boolean
}

function ContestRow({ contest, onSelect, isNext }: ContestRowProps) {
    const [timeUntil, setTimeUntil] = useState(0)

    useEffect(() => {
        const updateTime = () => {
            const startTime = new Date(contest.start_time).getTime()
            const now = Date.now()
            setTimeUntil(Math.max(0, Math.floor((startTime - now) / 1000)))
        }
        updateTime()
        const interval = setInterval(updateTime, 1000)
        return () => clearInterval(interval)
    }, [contest.start_time])

    return (
        <div
            onClick={onSelect}
            className={`group px-4 py-3 cursor-pointer transition-all ${
                isNext ? 'bg-cyan-500/5 hover:bg-cyan-500/10' : 'hover:bg-zinc-800/50'
            }`}
        >
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${
                        isNext ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-800 text-zinc-500'
                    }`}>
                        {isNext ? <Zap className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-zinc-200 truncate">{contest.name}</span>
                            {isNext && (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold bg-cyan-500/20 text-cyan-400 rounded border border-cyan-500/30">
                                    NEXT
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500">
                            <span>{contest.asset_id}</span>
                            <span className="text-zinc-700">|</span>
                            <span>${contest.price_interval.toFixed(2)}</span>
                            <span className="text-zinc-700">|</span>
                            <span>{contest.timeframe_sec}s</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                        <p className="text-[9px] text-zinc-600 uppercase tracking-wider">STARTS IN</p>
                        <p className={`font-mono font-bold text-sm ${isNext ? 'text-cyan-400' : 'text-zinc-400'}`}>
                            {formatTimeRemaining(timeUntil)}
                        </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all" />
                </div>
            </div>
        </div>
    )
}

interface LeaderboardRowProps {
    entry: LeaderboardEntry
    rank: number
}

function LeaderboardRow({ entry, rank }: LeaderboardRowProps) {
    const isTop3 = rank <= 3

    const rankConfig = {
        1: { icon: <Crown className="w-3.5 h-3.5" />, color: 'text-yellow-500', bg: 'bg-yellow-500/10 border-yellow-500/30' },
        2: { icon: <Medal className="w-3.5 h-3.5" />, color: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/30' },
        3: { icon: <Medal className="w-3.5 h-3.5" />, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
    }

    const shortenAddress = (addr: string) => {
        if (!addr) return '---'
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`
    }

    const rowBg = rank === 1 ? 'border-l-2 border-l-yellow-500 bg-yellow-500/5'
        : rank === 2 ? 'border-l-2 border-l-zinc-400 bg-zinc-500/5'
        : rank === 3 ? 'border-l-2 border-l-amber-500 bg-amber-500/5'
        : 'hover:bg-zinc-800/30'

    return (
        <div className={`flex items-center justify-between px-4 py-2.5 ${rowBg}`}>
            <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                    isTop3 ? `${rankConfig[rank as 1 | 2 | 3].color} ${rankConfig[rank as 1 | 2 | 3].bg} border` : 'bg-zinc-800 text-zinc-500'
                }`}>
                    {isTop3 ? rankConfig[rank as 1 | 2 | 3].icon : rank}
                </div>
                <span className="text-xs font-mono text-zinc-300">
                    {shortenAddress(entry.wallet_address)}
                </span>
            </div>
            <div className="flex items-center gap-1">
                {entry.net_pnl >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-green-500" />
                ) : (
                    <TrendingDown className="w-3 h-3 text-red-500" />
                )}
                <span className={`font-mono font-bold text-xs ${entry.net_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {entry.net_pnl >= 0 ? '+' : ''}{entry.net_pnl.toFixed(2)}
                </span>
            </div>
        </div>
    )
}
