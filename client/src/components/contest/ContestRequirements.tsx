import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
    Wallet,
    ExternalLink,
    Copy,
    RefreshCw,
    AlertTriangle,
} from 'lucide-react'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { toast } from 'sonner'
import { Contest } from '@/services/apiService'
import { cn } from '@/lib/utils'

interface ContestRequirementsProps {
    isOpen: boolean
    onClose: () => void
    contest: Contest
    onRequirementsMet: () => void
}

const BASE_SEPOLIA_FAUCET_URL = 'https://www.coinbase.com/developer-platform/products/faucet'

export function ContestRequirements({
    isOpen,
    onClose,
    contest,
    onRequirementsMet,
}: ContestRequirementsProps) {
    const { address, formatted, refetch, isRefetching } = useTokenBalance()
    const walletBalance = Number(formatted || '0')
    const hasBalance = walletBalance > 0

    const handleContinue = () => {
        if (hasBalance) {
            onRequirementsMet()
        }
    }

    const copyAddress = async () => {
        await navigator.clipboard.writeText(address || '')
        toast.success('Wallet address copied')
    }

    const openFaucet = () => {
        window.open(BASE_SEPOLIA_FAUCET_URL, '_blank', 'noopener,noreferrer')
    }

    const shortenAddress = (addr: string | undefined) => {
        if (!addr) return ''
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-[92vw] sm:max-w-[360px] p-0 gap-0 bg-zinc-950 border border-amber-500/30 text-zinc-100 font-mono overflow-hidden">
                <div className="px-5 pt-5 pb-4 border-b border-amber-500/15 bg-amber-500/5">
                    <div className="text-center">
                        <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-3">
                            {hasBalance ? (
                                <Wallet className="w-5 h-5 text-emerald-400" />
                            ) : (
                                <AlertTriangle className="w-5 h-5 text-amber-400" />
                            )}
                        </div>
                        <DialogTitle className="text-base font-bold text-zinc-50">
                            {hasBalance ? 'Wallet Ready' : '0 USDC in Wallet'}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-zinc-400 mt-1 leading-relaxed">
                            {hasBalance ? (
                                <>You can now enter <span className="text-zinc-100 font-medium">{contest.name}</span>.</>
                            ) : (
                                <>Get Base Sepolia USDC from the faucet, send it to your embedded wallet, then refresh your balance.</>
                            )}
                        </DialogDescription>
                    </div>
                </div>

                <div className="px-5 py-4 space-y-3">
                    <div className={cn(
                        'rounded-lg px-3 py-3 space-y-3 border',
                        hasBalance
                            ? 'border-emerald-500/25 bg-emerald-500/10'
                            : 'border-amber-500/20 bg-zinc-900'
                    )}>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <div className={cn(
                                    'text-[11px] uppercase tracking-wide mb-1',
                                    hasBalance ? 'text-emerald-300' : 'text-amber-300'
                                )}>Wallet</div>
                                <button
                                    onClick={copyAddress}
                                    className="flex items-center gap-2 text-xs w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 hover:border-amber-500/30 hover:bg-zinc-900 transition-colors"
                                >
                                    <code className="text-zinc-300">{shortenAddress(address)}</code>
                                    <Copy className="w-3 h-3 text-amber-300 ml-auto" />
                                </button>
                            </div>

                            <div>
                                <div className={cn(
                                    'text-[11px] uppercase tracking-wide mb-1',
                                    hasBalance ? 'text-emerald-300' : 'text-amber-300'
                                )}>Balance</div>
                                <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-50">
                                    ${walletBalance.toFixed(2)} USDC
                                </div>
                            </div>
                        </div>

                        {!hasBalance && (
                            <div className="grid grid-cols-1 gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 justify-between border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15 hover:text-amber-100"
                                    onClick={openFaucet}
                                >
                                    Open Base Sepolia Faucet
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 justify-center border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                                    onClick={() => refetch()}
                                >
                                    <RefreshCw className={cn('w-3.5 h-3.5 mr-2', isRefetching && 'animate-spin')} />
                                    {isRefetching ? 'Refreshing...' : 'Refresh balance'}
                                </Button>
                            </div>
                        )}
                    </div>

                    {!hasBalance && (
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                            The Coinbase faucet supports Base Sepolia test tokens including USDC. Paste your embedded wallet address there, then return here.
                        </p>
                    )}
                </div>

                <div className="px-5 pb-5 pt-1">
                    <Button
                        className="w-full h-10 font-semibold bg-emerald-500 hover:bg-emerald-400 text-black disabled:bg-zinc-800 disabled:text-zinc-500"
                        onClick={handleContinue}
                        disabled={!hasBalance}
                    >
                        {hasBalance ? 'Enter Ride' : 'Waiting for USDC'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
