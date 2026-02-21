import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { TradingPair } from '../../services/apiService'
import { useContest } from '../../contexts/ContestContext'

// Reliable logo URLs (CoinGecko CDN)
const LOGO_URLS: Record<string, string> = {
    ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
}

interface GridHeaderProps {
    tradingPairs: TradingPair[]
    selectedAsset: string
    currentPrice: number | null
}

export const GridHeader: React.FC<GridHeaderProps> = ({
    tradingPairs,
    selectedAsset,
    currentPrice,
}) => {
    const { exitToSelection } = useContest()
    const selectedPair = tradingPairs.find(p => p.asset_id === selectedAsset)
    const displaySymbol = selectedPair ? `${selectedPair.symbol}/${selectedPair.quote}` : selectedAsset.replace('-', '/')
    const logoUrl = LOGO_URLS[selectedPair?.symbol || 'ETH'] || LOGO_URLS.ETH

    return (
        <div className="h-10 md:h-12 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm flex items-center justify-between px-3 md:px-4">
            {/* Back Button + Asset Display */}
            <div className="flex items-center gap-3">
                <button
                    onClick={exitToSelection}
                    className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors"
                    aria-label="Back to contest selection"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                    <img
                        src={logoUrl}
                        alt={selectedPair?.symbol || 'Asset'}
                        className="w-5 h-5 rounded-full"
                    />
                    <span className="text-sm font-bold text-white">{displaySymbol}</span>
                </div>
            </div>

            {/* Current Price */}
            <div className="flex items-center gap-2">
                <span className={`text-lg md:text-xl font-mono font-bold tracking-tight ${currentPrice ? 'text-white' : 'text-zinc-500'}`}>
                    ${currentPrice ? currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--.--'}
                </span>
            </div>
        </div>
    )
}
