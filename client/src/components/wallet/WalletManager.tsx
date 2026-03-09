import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogDescription, DialogTrigger, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { useAuth } from '@/contexts/AuthContext'
import { networkName } from '@/providers/Web3Provider'
import { cn } from '@/lib/utils'

export function WalletManager() {
    const navigate = useNavigate()
    const { authenticated, signOut, walletAddress, signIn } = useAuth()
    const { formatted: walletBalance } = useTokenBalance()
    const onchainBalance = Number(walletBalance ?? 0)

    const [isOpen, setIsOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<'status' | 'fund'>('status')

    const handleDisconnect = () => {
        signOut()
        setIsOpen(false)
        navigate('/')
        toast.success('Disconnected')
    }

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text)
        toast.success(`${label} copied`)
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            {authenticated ? (
                <DialogTrigger asChild>
                    <button
                        className="group flex items-center gap-2 px-3 py-1.5 bg-secondary/60 hover:bg-secondary/80 border border-border rounded transition-all text-xs font-mono text-muted-foreground hover:text-foreground"
                        data-wallet-trigger
                        aria-label={`Wallet: ${walletAddress ?? 'connected'}`}
                    >
                        <span>
                            {walletAddress
                                ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
                                : 'connected'}
                        </span>
                    </button>
                </DialogTrigger>
            ) : (
                <button
                    className="group flex items-center gap-2 px-3 py-1.5 bg-secondary/60 hover:bg-secondary/80 border border-border rounded transition-all text-xs font-mono text-muted-foreground hover:text-foreground"
                    data-wallet-trigger
                    aria-label="Sign in"
                    onClick={() => signIn()}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-primary">●</span>
                        sign in
                    </div>
                </button>
            )}

            {authenticated && (
                <DialogContent className="sm:max-w-[420px] p-0 gap-0 bg-zinc-950 border border-zinc-700 font-mono overflow-hidden">
                    <DialogTitle className="sr-only">Wallet Manager</DialogTitle>
                    <DialogDescription className="sr-only">
                        Wallet status and funding.
                    </DialogDescription>

                    <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">wallet@blocksride</span>
                            <span className={cn(
                                'px-2 py-0.5 text-[10px]',
                                networkName.includes('Sepolia') ? 'text-orange-400' : 'text-green-400'
                            )}>
                                {networkName.toUpperCase()}
                            </span>
                        </div>
                    </div>

                    <div className="px-4 py-4 border-b border-zinc-800">
                        <div className="text-xs text-zinc-500 mb-1">ONCHAIN_USDC_BALANCE</div>
                        <div className="text-2xl font-bold text-green-400">
                            ${onchainBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                    </div>

                    <div className="flex border-b border-zinc-800 text-xs" role="tablist" aria-label="Wallet options">
                        {(['status', 'fund'] as const).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                role="tab"
                                aria-selected={activeTab === tab}
                                className={cn(
                                    'flex-1 py-2.5 transition-all border-b-2 -mb-px',
                                    activeTab === tab
                                        ? 'text-green-400 border-green-500 bg-green-500/5'
                                        : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-900'
                                )}
                            >
                                {tab.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    <div className="p-4 max-h-[320px] overflow-y-auto">
                        {activeTab === 'status' && (
                            <div className="space-y-4 text-xs">
                                <div>
                                    <div className="text-zinc-500 mb-1">EMBEDDED_WALLET</div>
                                    <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-2">
                                        <code className="text-zinc-300 break-all">{walletAddress}</code>
                                        <button
                                            onClick={() => copyToClipboard(walletAddress || '', 'Address')}
                                            className="text-zinc-500 hover:text-green-400 transition-colors ml-2"
                                            aria-label="Copy wallet address"
                                        >
                                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>

                                <button
                                    onClick={handleDisconnect}
                                    className="w-full py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
                                >
                                    [DISCONNECT]
                                </button>
                            </div>
                        )}

                        {activeTab === 'fund' && (
                            <div className="space-y-4 text-xs">
                                <div>
                                    <div className="text-zinc-500 mb-2">FUND THIS WALLET</div>
                                    <div className="flex items-center justify-between bg-zinc-900 border border-green-500/30 p-3">
                                        <code className="text-green-400 break-all text-[11px] font-bold">
                                            {walletAddress || 'NOT_CONNECTED'}
                                        </code>
                                        <button
                                            onClick={() => copyToClipboard(walletAddress || '', 'Wallet address')}
                                            disabled={!walletAddress}
                                            className="text-zinc-500 hover:text-green-400 transition-colors ml-2 disabled:opacity-50"
                                            aria-label="Copy wallet address"
                                        >
                                            <Copy className="w-4 h-4" aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>

                                <div className="p-3 bg-zinc-900 border border-zinc-800 text-center">
                                    <div className="text-zinc-400 mb-1">How to fund</div>
                                    <div className="text-zinc-600 text-[10px]">
                                        Send Base Sepolia USDC to this address. Your balance updates automatically.
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            )}
        </Dialog>
    )
}
