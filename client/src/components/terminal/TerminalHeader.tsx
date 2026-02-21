import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useContest } from '@/contexts/ContestContext'
import { useCurrentPrice } from '@/hooks/useCurrentPrice'
import { networkName } from '@/providers/Web3Provider'
import {
  LogOut,
  Radio,
  Menu,
  X,
  ArrowLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { WalletManager } from '@/components/wallet/WalletManager'
import { BlocksrideLogo } from '@/components/BlocksrideLogo'

// Reliable logo URLs (CoinGecko CDN)
const LOGO_URLS: Record<string, string> = {
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
}

export function TerminalHeader() {
  const navigate = useNavigate()
  const { authenticated, signOut } = useAuth()
  const { isPracticeMode, selectedContest, exitToSelection } = useContest()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Get asset info from contest
  const assetId = selectedContest?.asset_id || 'ETH-USD'
  const [symbol, quote] = assetId.split('-')
  const logoUrl = LOGO_URLS[symbol] || LOGO_URLS.ETH
  const currentPrice = useCurrentPrice(assetId)

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const handleLogout = () => {
    signOut()
    navigate('/')
  }

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-3 md:px-4 h-12 md:h-14 flex items-center justify-between">
        {/* Left: Back + Logo + Asset + Price */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Back button */}
          <button
            onClick={exitToSelection}
            className="p-1.5 hover:bg-zinc-900 rounded text-zinc-400 hover:text-white transition-colors"
            aria-label="Back to contest selection"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-zinc-800" />

          {/* Logo */}
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate('/')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/')}
            aria-label="Go to home page"
          >
            <BlocksrideLogo size={22} wordmark variant="white" />
          </div>

          <div className="hidden sm:block h-4 w-px bg-zinc-800" />

          {/* Asset info */}
          <div className="flex items-center gap-2">
            <img
              src={logoUrl}
              alt={symbol}
              className="w-5 h-5 rounded-full"
            />
            <span className="text-sm font-bold text-white">{symbol}/{quote}</span>
          </div>

          {/* Current Price */}
          <span className={cn(
            'text-base md:text-lg font-mono font-bold tracking-tight',
            currentPrice ? 'text-white' : 'text-zinc-500'
          )}>
            ${currentPrice ? currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--.--'}
          </span>

          <div className="hidden md:block h-4 w-px bg-zinc-800" />

          {/* Mode indicator */}
          <div className="hidden md:flex items-center gap-1.5 text-xs">
            <Radio
              className={cn(
                'w-3 h-3 animate-pulse',
                isPracticeMode ? 'text-yellow-500' : 'text-green-500'
              )}
              aria-hidden="true"
            />
            <span className={isPracticeMode ? 'text-yellow-500' : 'text-green-500'}>
              {isPracticeMode ? 'PRACTICE' : 'LIVE'}
            </span>
          </div>

          {/* Network Badge - only show on testnet */}
          {networkName === 'Sepolia' && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-orange-500/20 text-orange-400 border border-orange-500/30">
              Testnet
            </span>
          )}
        </div>

        {/* Right: Wallet + Time + Logout */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Wallet Manager - shows balance, click to open deposit/withdraw */}
          <WalletManager />

          {/* Time (desktop) */}
          <div className="hidden sm:flex items-center gap-2 px-2 md:px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-[10px] md:text-xs">
            <span className="text-zinc-400">
              {currentTime.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="text-zinc-700">|</span>
            <span className="text-green-500 font-bold tabular-nums">
              {currentTime.toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>

          {/* Logout (desktop) */}
          {authenticated && (
            <button
              onClick={handleLogout}
              className="hidden md:flex p-1.5 md:p-2 hover:bg-zinc-900 rounded border border-transparent hover:border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-all"
              title="Disconnect"
              aria-label="Disconnect wallet"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}

          {/* Mobile menu button */}
          {authenticated && (
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 hover:bg-zinc-900 rounded text-zinc-500 hover:text-zinc-300 transition-all"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && authenticated && (
        <div className="md:hidden border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-xl">
          <nav className="max-w-7xl mx-auto px-3 py-2" aria-label="Mobile navigation">
            <div className="space-y-1">
              <button
                onClick={() => {
                  setMobileMenuOpen(false)
                  handleLogout()
                }}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-900 rounded transition-colors text-left"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                Disconnect
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
