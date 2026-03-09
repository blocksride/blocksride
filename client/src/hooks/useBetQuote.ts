import { useMemo } from 'react'
import type { BetQuote } from '../types/grid'

interface UseBetQuoteArgs {
    cellKey: string | null
    stake: number
    windowTotals: Record<number, number>
    cellStakes: Record<string, number>
}

/**
 * Builds a local parimutuel preview from live on-chain pool state.
 * The returned values are estimates only: later bets can still change the pool.
 */
export function useBetQuote({ cellKey, stake, windowTotals, cellStakes }: UseBetQuoteArgs) {
    const quote = useMemo<BetQuote | null>(() => {
        if (!cellKey || stake <= 0) return null

        const [windowIdRaw] = cellKey.split('_')
        const windowId = Number(windowIdRaw)
        if (!Number.isFinite(windowId)) return null

        const currentWindowTotal = windowTotals[windowId] ?? 0
        const currentCellStake = cellStakes[cellKey] ?? 0

        const nextWindowTotal = currentWindowTotal + stake
        const nextCellStake = currentCellStake + stake
        if (nextCellStake <= 0) return null

        const feeAdjustedPool = nextWindowTotal * 0.98
        const currentMultiplier = feeAdjustedPool / nextCellStake
        const estimatedPayout = stake * currentMultiplier

        return {
            cell_id: cellKey,
            stake,
            current_multiplier: currentMultiplier,
            estimated_payout: estimatedPayout,
            estimated_net_profit: estimatedPayout - stake,
            total_pool: currentWindowTotal,
            cell_stake: currentCellStake,
        }
    }, [cellKey, stake, windowTotals, cellStakes])

    return {
        quote,
        loading: false,
        error: null,
        refresh: () => undefined,
    }
}
