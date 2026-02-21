import { useContest, formatTimeRemaining } from '@/contexts/ContestContext'
import { Button } from '@/components/ui/button'
import { Trophy, Target, Clock, ArrowRight, Loader2 } from 'lucide-react'
import { Contest } from '@/services/apiService'

export function ContestSelector() {
    const { allContests, loading, enterPracticeMode, selectContest, refreshContests } = useContest()

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                    <p className="text-muted-foreground">Loading contests...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-4xl mx-auto px-4 py-12">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center gap-2 mb-4">
                        <Target className="w-8 h-8 text-primary" />
                        <h1 className="text-3xl font-bold font-mono">BLIP<span className="text-primary">MARKETS</span></h1>
                    </div>
                    <p className="text-muted-foreground">Choose your trading session</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    {/* Practice Mode Card */}
                    <div
                        onClick={enterPracticeMode}
                        className="p-6 rounded-xl border-2 border-dashed border-amber-400/50 bg-amber-50 hover:border-amber-500 hover:bg-amber-100 dark:border-yellow-500/30 dark:bg-yellow-500/5 dark:hover:border-yellow-500/60 dark:hover:bg-yellow-500/10 cursor-pointer transition-all group"
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-200 dark:bg-yellow-500/20 flex items-center justify-center">
                                <Target className="w-5 h-5 text-amber-600 dark:text-yellow-500" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-foreground">Practice Mode</h2>
                                <p className="text-sm text-muted-foreground">No real money at stake</p>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">
                            Trade with practice balance. Perfect for learning the platform and testing strategies.
                        </p>
                        <div className="flex items-center text-amber-600 dark:text-yellow-500 text-sm font-medium group-hover:translate-x-1 transition-transform">
                            Enter Practice <ArrowRight className="w-4 h-4 ml-1" />
                        </div>
                    </div>

                    {/* Contests Section */}
                    {allContests.length === 0 ? (
                        <div className="p-6 rounded-xl border border-border bg-card">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                    <Trophy className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-foreground">Contests</h2>
                                    <p className="text-sm text-muted-foreground">No contests available</p>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">
                                There are no active or upcoming contests at the moment. Check back later!
                            </p>
                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); refreshContests(); }}>
                                Refresh
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Trophy className="w-5 h-5 text-primary" />
                                Available Contests
                            </h2>
                            {allContests.map((contest) => (
                                <ContestCard
                                    key={contest.contest_id}
                                    contest={contest}
                                    onSelect={() => selectContest(contest)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

interface ContestCardProps {
    contest: Contest
    onSelect: () => void
}

function ContestCard({ contest, onSelect }: ContestCardProps) {
    const isActive = contest.status === 'active'
    const isUpcoming = contest.status === 'upcoming'

    const now = Date.now()
    const startTime = new Date(contest.start_time).getTime()
    const endTime = new Date(contest.end_time).getTime()

    let timeDisplay = ''
    if (isActive) {
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000))
        timeDisplay = `Ends in ${formatTimeRemaining(remaining)}`
    } else if (isUpcoming) {
        const until = Math.max(0, Math.floor((startTime - now) / 1000))
        timeDisplay = `Starts in ${formatTimeRemaining(until)}`
    }

    return (
        <div
            onClick={onSelect}
            className={`p-5 rounded-xl border-2 cursor-pointer transition-all group ${
                isActive
                    ? 'border-green-400 bg-green-50 hover:border-green-500 hover:bg-green-100 dark:border-green-500/50 dark:bg-green-500/5 dark:hover:border-green-500 dark:hover:bg-green-500/10'
                    : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50'
            }`}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                    {isActive ? (
                        <>
                            <span className="inline-block w-2 h-2 bg-green-500 dark:bg-green-500 rounded-full animate-pulse" />
                            <span className="text-green-600 dark:text-green-400 font-semibold text-xs uppercase">Live</span>
                        </>
                    ) : (
                        <>
                            <span className="inline-block w-2 h-2 bg-amber-500 dark:bg-yellow-500 rounded-full" />
                            <span className="text-amber-600 dark:text-yellow-500 font-semibold text-xs uppercase">Upcoming</span>
                        </>
                    )}
                </div>
                {timeDisplay && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {timeDisplay}
                    </div>
                )}
            </div>

            <h3 className="font-bold text-foreground mb-1">{contest.name}</h3>
            {contest.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{contest.description}</p>
            )}

            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-4">
                <span>Asset: <span className="text-foreground font-medium">{contest.asset_id}</span></span>
                <span>Interval: <span className="text-foreground font-medium">${contest.price_interval}</span></span>
                <span>Window: <span className="text-foreground font-medium">{contest.timeframe_sec}s</span></span>
            </div>

            <div className={`flex items-center text-sm font-medium group-hover:translate-x-1 transition-transform ${
                isActive ? 'text-green-600 dark:text-green-400' : 'text-primary'
            }`}>
                {isActive ? 'Join Contest' : 'View Contest'} <ArrowRight className="w-4 h-4 ml-1" />
            </div>
        </div>
    )
}
