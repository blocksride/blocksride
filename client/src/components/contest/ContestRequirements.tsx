import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
    CheckCircle2,
    Wallet,
    Coins,
    ArrowRight,
    Copy,
    RefreshCw
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

export function ContestRequirements({
    isOpen,
    onClose,
    contest,
    onRequirementsMet
}: ContestRequirementsProps) {
    const { address, formatted, refetch, isRefetching } = useTokenBalance()

    // On-chain USDC balance for the embedded wallet on configured network/token.
    const walletBalance = Number(formatted ?? '0')
    const hasBalance = walletBalance > 0

    useEffect(() => {
        if (isOpen) {
            refetch()
        }
    }, [isOpen, refetch])

    const handleContinue = () => {
        if (hasBalance) {
            onRequirementsMet()
        }
    }

    const copyAddress = () => {
        navigator.clipboard.writeText(address || '')
        toast.success('Address copied!')
    }

    const shortenAddress = (addr: string | undefined) => {
        if (!addr) return ''
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-[90vw] sm:max-w-[420px] p-0 gap-0 bg-card border border-primary/30 text-foreground font-mono overflow-hidden">
                {/* Header */}
                <div className="relative px-6 pt-6 pb-4">
                    <div className="text-center">
                        <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-3">
                            <Wallet className="w-6 h-6 text-primary" />
                        </div>
                        <DialogTitle className="text-lg font-bold text-foreground">Setup Required</DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground mt-1 break-words">
                            {hasBalance ? (
                                <>You're ready to join <span className="text-foreground font-medium break-all">{contest.name}</span></>
                            ) : (
                                <>Fund your wallet to join <span className="text-foreground font-medium break-all">{contest.name}</span></>
                            )}
                        </DialogDescription>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex gap-1.5 mt-4">
                        <div className={`h-1 flex-1 rounded-full transition-colors ${hasBalance ? 'bg-green-500' : 'bg-primary/30'}`} />
                    </div>
                </div>

                {/* Steps */}
                <div className="px-6 py-4 space-y-3">
                    {/* Step 1: Balance */}
                    <StepCard
                        icon={<Coins className="w-4 h-4" />}
                        title="Fund Wallet"
                        isComplete={hasBalance}
                        isActive={!hasBalance}
                    >
                        {hasBalance ? (
                            <span className="text-sm text-green-400">
                                ${walletBalance.toFixed(2)} USDC available (on-chain)
                            </span>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    Deposit USDC (Base) to your wallet
                                </p>
                                <button
                                    onClick={copyAddress}
                                    className="flex items-center gap-2 text-xs bg-background hover:bg-primary/10 px-3 py-2 rounded-lg border border-primary/25 transition-colors w-full"
                                >
                                    <code className="font-mono text-muted-foreground">
                                        {shortenAddress(address)}
                                    </code>
                                    <Copy className="w-3 h-3 text-primary ml-auto" />
                                </button>
                                <button
                                    onClick={() => refetch()}
                                    className="flex items-center justify-center gap-2 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 px-3 py-2 rounded-lg border border-green-500/30 transition-colors w-full"
                                >
                                    <RefreshCw className={cn('w-3 h-3', isRefetching && 'animate-spin')} />
                                    {isRefetching ? 'Refreshing...' : "I've deposited, refresh balance"}
                                </button>
                            </div>
                        )}
                    </StepCard>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-background/60 border-t border-primary/20">
                    <Button
                        className="w-full h-11 font-semibold"
                        onClick={handleContinue}
                        disabled={!hasBalance}
                    >
                        {hasBalance ? (
                            <>
                                Enter Contest
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </>
                        ) : (
                            'Fund Wallet to Continue'
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

interface StepCardProps {
    icon: React.ReactNode
    title: string
    isComplete: boolean
    isActive: boolean
    children: React.ReactNode
}

function StepCard({
    icon,
    title,
    isComplete,
    isActive,
    children
}: StepCardProps) {
    return (
        <div
            className={`relative p-4 rounded-xl border transition-all overflow-hidden ${
                isComplete
                    ? 'bg-green-500/10 border-green-500/30'
                    : isActive
                    ? 'bg-primary/10 border-primary/30 ring-1 ring-primary/30'
                    : 'bg-card border-primary/20'
            }`}
        >
            <div className="flex items-start gap-3 min-w-0 overflow-hidden">
                {/* Step indicator */}
                <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isComplete
                            ? 'bg-green-500 text-black'
                        : isActive
                            ? 'bg-primary/10 text-primary border border-primary/30'
                            : 'bg-card border border-primary/20 text-muted-foreground'
                    }`}
                >
                    {isComplete ? (
                        <CheckCircle2 className="w-4 h-4" />
                    ) : (
                        icon
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-semibold ${isComplete ? 'text-green-400' : 'text-foreground'}`}>
                            {title}
                        </span>
                        {isComplete && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium flex-shrink-0">
                                Done
                            </span>
                        )}
                    </div>
                    {children}
                </div>
            </div>
        </div>
    )
}
