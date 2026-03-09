import React from 'react'
import { Cell, Position } from '../../types/grid'
import { normalizeSlotKey } from '../../lib/gridSlots'
import { History, TrendingUp, TrendingDown } from 'lucide-react'

interface BetHistoryProps {
    betResults: Record<string, 'won' | 'lost' | 'pending' | 'winning'>
    cells: Cell[]
    positions: Position[]
}

export const BetHistory: React.FC<BetHistoryProps> = ({
    betResults,
    cells,
    positions,
}) => {
    const completedBets = Object.keys(betResults).filter(
        (cellId) => betResults[cellId] === 'won' || betResults[cellId] === 'lost'
    )

    if (completedBets.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-8 border-t border-border mt-0">
                <History className="w-6 h-6 text-muted-foreground/30 mb-2" />
                <div className="text-xs font-semibold text-muted-foreground">No History</div>
            </div>
        )
    }

    return (
        <div className="flex flex-col border-t border-border bg-card h-full">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/10">
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-bold uppercase text-foreground tracking-widest">Recent Activity</span>
            </div>

            <div className="flex-1 flex flex-col">
                {completedBets.map((cellId) => {
                    const cell = cells.find((c) => normalizeSlotKey(c.cell_id, cells) === cellId || c.cell_id === cellId)
                    if (!cell) return null

                    const position = positions.find((p) => normalizeSlotKey(p.cell_id, cells) === cellId || p.cell_id === cellId)
                    if (!position) return null

                    const result = betResults[cellId]
                    const stake = position.stake || 10
                    const payout = position.payout || 0
                    const profitLoss = result === 'won' ? payout : -stake

                    return (
                        <div
                            key={cellId}
                            className="group flex flex-col px-4 py-3 border-b border-border/50 hover:bg-secondary/10 transition-colors"
                        >
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                    {result === 'won' ? (
                                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-trade-up/10">
                                            <TrendingUp className="w-3 h-3 text-trade-up" />
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-trade-down/10">
                                            <TrendingDown className="w-3 h-3 text-trade-down" />
                                        </div>
                                    )}
                                    <span className={`text-xs font-bold uppercase tracking-tight ${result === 'won' ? 'text-trade-up' : 'text-trade-down'}`}>
                                        {result === 'won' ? 'Won' : 'Lost'}
                                    </span>
                                    {position.is_practice && (
                                        <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-500 rounded font-semibold uppercase">
                                            Practice
                                        </span>
                                    )}
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground/50">
                                    {new Date(cell.t_end).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </span>
                            </div>

                            <div className="flex items-end justify-between pl-7">
                                <div>
                                    <div className="text-[10px] font-mono text-muted-foreground">
                                        {cell.p_low.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - {cell.p_high.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                                        Bet: ${stake.toFixed(2)}
                                    </div>
                                </div>
                                <div
                                    className={`font-mono font-bold text-sm ${profitLoss > 0 ? 'text-trade-up' : 'text-foreground/50'}`}
                                >
                                    {profitLoss > 0 ? '+' : ''}
                                    {profitLoss.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
