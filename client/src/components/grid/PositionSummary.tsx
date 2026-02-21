import { Position } from '../../types/grid'
import { Activity, TrendingUp, TrendingDown, Clock } from 'lucide-react'
import { useContest } from '../../contexts/ContestContext'

interface PositionSummaryProps {
    selectedCells: string[]
    betResults: Record<string, string>
    positions: Position[]
}

export const PositionSummary: React.FC<PositionSummaryProps> = ({
    // selectedCells is kept in the interface for backwards compatibility
    // but we now show all active positions instead of just selected cells
    betResults,
    positions,
}) => {
    const { isPracticeMode } = useContest()
    // Show ALL active/pending positions, not just selected cells
    const activePositions = positions.filter(p => p.state === 'ACTIVE' || p.state === 'PENDING')

    const totalStake = activePositions.reduce((sum, p) => sum + p.stake, 0)

    let totalProfit = 0

    activePositions.forEach((p) => {
        const result = betResults[p.cell_id]
        if (result === 'won' && p.payout) {
            // Payout now includes stake for both practice and contest modes
            // So profit = payout - stake
            totalProfit += (p.payout - p.stake)
        } else if (result === 'lost') {
            totalProfit -= p.stake
        }
    })


    const roi = totalStake > 0 ? (totalProfit / totalStake) * 100 : 0

    // Count outcomes from betResults directly (same as BetHistory)
    // This includes RESOLVED positions so counts match Recent Activity
    const statusCounts = {
        won: Object.values(betResults).filter(r => r === 'won').length,
        lost: Object.values(betResults).filter(r => r === 'lost').length,
        winning: Object.values(betResults).filter(r => r === 'winning').length,
        pending: Object.values(betResults).filter(r => r === 'pending').length
    }

    if (activePositions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-b border-border bg-card/50">
                <Activity className="w-8 h-8 opacity-20 mb-3" />
                <div className="text-sm font-medium">No Active Positions</div>
                <div className="text-xs opacity-60">Place bets to see your positions here</div>
            </div>
        )
    }

    return (
        <div className="flex flex-col bg-card" data-onboarding="position-summary">
            { }
            <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/20">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">Active Summary</span>
                </div>
                {isPracticeMode ? (
                    <span className="text-[9px] px-2 py-1 bg-amber-500/20 text-amber-500 rounded-full font-bold uppercase tracking-wide">
                        Practice Mode
                    </span>
                ) : (
                    <span className="text-[9px] px-2 py-1 bg-emerald-500/20 text-emerald-500 rounded-full font-bold uppercase tracking-wide">
                        Live Mode
                    </span>
                )}
            </div>

            { }
            <div className="grid grid-cols-2 gap-px bg-border">
                <div className="bg-card p-2 xs:p-3 flex flex-col gap-1">
                    <span className="text-[9px] xs:text-[10px] uppercase text-muted-foreground font-semibold">Total Stake</span>
                    <span className="font-mono text-sm xs:text-base md:text-sm font-bold text-foreground">
                        {totalStake.toFixed(2)} <span className="text-xs text-muted-foreground">USDC</span>
                    </span>
                </div>

                <div className="bg-card p-2 xs:p-3 flex flex-col gap-1">
                    <span className="text-[9px] xs:text-[10px] uppercase text-muted-foreground font-semibold">Net P&L</span>
                    <div className={`font-mono text-sm xs:text-base md:text-sm font-bold flex items-center gap-1 ${totalProfit > 0 ? 'text-trade-up' : totalProfit < 0 ? 'text-trade-down' : 'text-foreground'}`}>
                        {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(2)}
                        {totalProfit !== 0 && (
                            <span className="text-[10px] ml-1 bg-current/10 px-1 py-0.5 rounded">
                                {Math.abs(roi).toFixed(0)}%
                            </span>
                        )}
                    </div>
                </div>
            </div>

            { }
            <div className="p-2 xs:p-3 border-b border-border">
                <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-2">Outcome Distribution</div>
                <div className="flex flex-wrap gap-1.5 xs:gap-2 text-xs">
                    {statusCounts.winning > 0 && (
                        <div className="inline-flex items-center gap-1 xs:gap-1.5 px-1.5 xs:px-2 py-1 bg-trade-up/20 text-trade-up rounded-md border-[1.5px] border-trade-up/30 animate-pulse">
                            <TrendingUp className="w-3 h-3 flex-shrink-0" />
                            <span className="font-bold whitespace-nowrap">{statusCounts.winning}<span className="hidden xs:inline ml-1">Winning</span></span>
                        </div>
                    )}
                    {statusCounts.won > 0 && (
                        <div className="inline-flex items-center gap-1 xs:gap-1.5 px-1.5 xs:px-2 py-1 bg-trade-up/10 text-trade-up rounded-md border-[1.5px] border-trade-up/20">
                            <TrendingUp className="w-3 h-3 flex-shrink-0" />
                            <span className="font-bold whitespace-nowrap">{statusCounts.won}<span className="hidden xs:inline ml-1">Won</span></span>
                        </div>
                    )}
                    {statusCounts.lost > 0 && (
                        <div className="inline-flex items-center gap-1 xs:gap-1.5 px-1.5 xs:px-2 py-1 bg-trade-down/10 text-trade-down rounded-md border-[1.5px] border-trade-down/20">
                            <TrendingDown className="w-3 h-3 flex-shrink-0" />
                            <span className="font-bold whitespace-nowrap">{statusCounts.lost}<span className="hidden xs:inline ml-1">Lost</span></span>
                        </div>
                    )}
                    {statusCounts.pending > 0 && (
                        <div className="inline-flex items-center gap-1 xs:gap-1.5 px-1.5 xs:px-2 py-1 bg-primary/10 text-primary rounded-md border-[1.5px] border-primary/20">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            <span className="font-bold whitespace-nowrap">{statusCounts.pending}<span className="hidden xs:inline ml-1">Open</span></span>
                        </div>
                    )}
                    {Object.values(statusCounts).every(v => v === 0) && (
                        <span className="text-muted-foreground italic">No outcomes yet</span>
                    )}
                </div>
            </div>
        </div>
    )
}
