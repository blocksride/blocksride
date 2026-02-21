import { useContest, formatTimeRemaining } from '../../contexts/ContestContext'
import { Trophy, ArrowLeft } from 'lucide-react'

export function ContestBanner() {
    const { selectedContest, isPracticeMode, timeRemaining, loading, exitToSelection } = useContest()

    if (loading) {
        return (
            <div className="bg-muted/50 dark:bg-zinc-800/50 border-b border-border dark:border-zinc-700 px-4 py-2 text-center">
                <span className="text-muted-foreground dark:text-zinc-400 text-sm">Loading contest info...</span>
            </div>
        )
    }

    if (isPracticeMode) {
        return (
            <div className="bg-gradient-to-r from-amber-100 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 border-b border-amber-300 dark:border-yellow-700/50 px-4 py-3">
                <div className="flex items-center justify-between max-w-7xl mx-auto">
                    <button
                        onClick={exitToSelection}
                        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="inline-block w-2 h-2 bg-amber-500 dark:bg-yellow-500 rounded-full animate-pulse" />
                            <span className="text-amber-700 dark:text-yellow-400 font-semibold uppercase tracking-wider text-sm">
                                Practice Mode
                            </span>
                        </div>
                        <span className="text-muted-foreground dark:text-zinc-300 text-sm hidden sm:inline">
                            Trade with practice balance - no real money at stake
                        </span>
                    </div>
                    <div className="w-16" /> {/* Spacer for centering */}
                </div>
            </div>
        )
    }

    // Contest mode (active contest)
    return (
        <div className="bg-gradient-to-r from-green-100 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-b border-green-300 dark:border-green-700/50 px-4 py-3">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <button
                    onClick={exitToSelection}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
                <div className="flex items-center gap-4 flex-wrap justify-center">
                    <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-green-700 dark:text-green-400 font-semibold uppercase tracking-wider text-sm">
                            Live
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-green-700 dark:text-green-400" />
                        <span className="text-foreground dark:text-white font-semibold">
                            {selectedContest?.name}
                        </span>
                    </div>
                    {timeRemaining !== null && (
                        <div className="flex items-center gap-2 bg-white/50 dark:bg-zinc-900/50 px-3 py-1 rounded">
                            <span className="text-muted-foreground dark:text-zinc-400 text-sm">Ends in:</span>
                            <span className="text-foreground dark:text-white font-mono font-bold">
                                {formatTimeRemaining(timeRemaining)}
                            </span>
                        </div>
                    )}
                </div>
                <div className="w-16" /> {/* Spacer for centering */}
            </div>
        </div>
    )
}

export function ContestHeader() {
    const { selectedContest, isPracticeMode, timeRemaining } = useContest()

    if (isPracticeMode) {
        return (
            <div className="flex items-center gap-2 text-sm">
                <span className="inline-block w-2 h-2 bg-amber-500 dark:bg-yellow-500 rounded-full" />
                <span className="text-amber-700 dark:text-yellow-400 font-semibold">Practice Mode</span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-700 dark:text-green-400 font-semibold">LIVE</span>
            </div>
            <span className="text-foreground dark:text-white font-medium">{selectedContest?.name}</span>
            {timeRemaining !== null && (
                <span className="text-muted-foreground dark:text-zinc-400">
                    {formatTimeRemaining(timeRemaining)}
                </span>
            )}
        </div>
    )
}
