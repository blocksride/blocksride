import { useContest, formatTimeRemaining } from '../../contexts/ContestContext'
import { Trophy, ArrowLeft } from 'lucide-react'

export function ContestBanner() {
    const { selectedContest, timeRemaining, loading, exitToSelection } = useContest()

    if (loading) {
        return (
            <div className="bg-muted/50 dark:bg-zinc-800/50 border-b border-border dark:border-zinc-700 px-4 py-2 text-center">
                <span className="text-muted-foreground dark:text-zinc-400 text-sm">Loading contest info...</span>
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
    const { selectedContest, timeRemaining } = useContest()

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
