import React from 'react'
import { Wallet, TrendingUp, Loader2 } from 'lucide-react'
import { ChipBar } from './ChipBar'
import type { BetQuote } from '../../types/grid'

const CHIP_TIP_STORAGE_KEY = 'blocksride_chip_tip_seen'

interface TradeControlsProps {
    stake: number
    onStakeChange: (amount: number) => void
    balance: number
    betQuote?: BetQuote | null
    quoteLoading?: boolean
    selectedCellId?: string | null
}

export const TradeControls: React.FC<TradeControlsProps> = ({
    stake,
    onStakeChange,
    balance,
    betQuote,
    quoteLoading = false,
    selectedCellId,
}) => {
    const [showChipTip, setShowChipTip] = React.useState(false)

    React.useEffect(() => {
        if (typeof window === 'undefined') return
        const seen = localStorage.getItem(CHIP_TIP_STORAGE_KEY) === 'true'
        if (!seen) setShowChipTip(true)
    }, [])

    const handleStakeChange = (amount: number) => {
        onStakeChange(amount)
        if (showChipTip) {
            localStorage.setItem(CHIP_TIP_STORAGE_KEY, 'true')
            setShowChipTip(false)
        }
    }

    const dismissChipTip = () => {
        localStorage.setItem(CHIP_TIP_STORAGE_KEY, 'true')
        setShowChipTip(false)
    }

    return (
        <div className="p-4 border-b border-border bg-card" data-onboarding="trade-controls">
            <div className="flex flex-col gap-3">
                {/* Balance badge */}
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Stake
                    </span>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border bg-secondary/30 border-border/50">
                        <Wallet className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] font-mono font-medium text-foreground">
                            ${balance.toFixed(2)}
                        </span>
                    </div>
                </div>

                {/* Chip bar */}
                <div className="relative">
                    <ChipBar value={stake} onChange={handleStakeChange} balance={balance} />
                    {showChipTip && (
                        <div className="absolute -top-12 left-0 z-20">
                            <div className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-[10px] font-mono rounded-md shadow-lg">
                                Pick a chip to set your stake
                                <button
                                    onClick={dismissChipTip}
                                    className="text-[10px] underline underline-offset-2 hover:text-primary-foreground/80"
                                    aria-label="Dismiss chip tip"
                                >
                                    Got it
                                </button>
                            </div>
                            <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-primary ml-3" />
                        </div>
                    )}
                </div>

                {/* Bet Preview */}
                {selectedCellId && (
                    <div className="p-3 rounded-lg bg-secondary/20 border border-border/30 mt-1">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <TrendingUp className="w-3 h-3" />
                                Bet Preview
                            </span>
                            {quoteLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                        </div>
                        {betQuote && !quoteLoading ? (
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="flex flex-col">
                                    <span className="text-muted-foreground text-[9px]">Multiplier</span>
                                    <span className="font-mono font-semibold text-foreground">
                                        {betQuote.current_multiplier.toFixed(2)}x
                                    </span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-muted-foreground text-[9px]">Estimated Payout</span>
                                    <span className="font-mono font-semibold text-trade-up">
                                        ${betQuote.estimated_payout.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-muted-foreground text-[9px]">Net If Win</span>
                                    <span className="font-mono font-semibold text-trade-up">
                                        {betQuote.estimated_net_profit >= 0 ? '+' : '-'}
                                        ${Math.abs(betQuote.estimated_net_profit).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-muted-foreground text-[9px]">Cell / Pool</span>
                                    <span className="font-mono font-semibold text-foreground">
                                        ${betQuote.cell_stake.toFixed(2)} / ${betQuote.total_pool.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        ) : !quoteLoading ? (
                            <p className="text-[10px] text-muted-foreground">
                                Tap a cell to see estimated payout
                            </p>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    )
}
