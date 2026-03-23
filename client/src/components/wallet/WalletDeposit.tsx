import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, type BaseError } from 'wagmi'
import { parseUnits } from 'viem'
import { BUILDER_CODE_SUFFIX } from '@/lib/builderCode'
import { toast } from 'sonner'
import { Loader2, Copy, CheckCircle2, Info } from 'lucide-react'
import { networkName } from '@/providers/Web3Provider'
import { getRuntimeNetworkConfig } from '@/lib/networkConfig'
import { useWallets } from '@privy-io/react-auth'

const erc20Abi = [
    {
        name: 'transfer',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'decimals',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint8' }],
    },
] as const

export function WalletDeposit() {
    const { authenticated, loading, walletAddress, refreshUser } = useAuth()

    // Use Privy's wallet instead of wagmi's useAccount
    const { wallets } = useWallets()
    const embeddedWallet = wallets.find((w) =>
        (w.walletClientType || '').toLowerCase().includes('privy'),
    )
    const activeWallet = embeddedWallet || wallets[0]
    const address = activeWallet?.address as `0x${string}` | undefined

    const [amount, setAmount] = useState('')
    const [isOpen, setIsOpen] = useState(false)
    const [copied, setCopied] = useState(false)

    const TREASURY_ADDRESS = import.meta.env.VITE_PLATFORM_TREASURY || ''
    const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || getRuntimeNetworkConfig().usdcTokenAddress

    const { data: decimals } = useReadContract({
        address: TOKEN_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: 'decimals',
    })

    const { data: hash, writeContract, isPending: isSending, error: writeError, reset } = useWriteContract()

    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
        hash,
    })

    // Handle successful transaction - deposits are auto-detected
    useEffect(() => {
        if (isSuccess && hash) {
            toast.success(
                'Transaction confirmed! Your balance will update in a few seconds.',
                { duration: 5000 }
            )
            setAmount('')
            // Refresh user balance
            refreshUser()
            // Reset after a delay to allow another deposit
            setTimeout(() => {
                reset()
            }, 3000)
        }
    }, [isSuccess, hash, reset, refreshUser])

    useEffect(() => {
        if (writeError) {
            toast.error((writeError as BaseError).shortMessage || writeError.message)
        }
    }, [writeError])

    const handleDeposit = () => {
        if (!amount || isNaN(parseFloat(amount))) {
            toast.error('Please enter a valid amount')
            return
        }
        const safeDecimals = decimals ?? 6
        writeContract({
            address: TOKEN_ADDRESS as `0x${string}`,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [TREASURY_ADDRESS as `0x${string}`, parseUnits(amount, safeDecimals)],
            dataSuffix: BUILDER_CODE_SUFFIX,
        })
    }

    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(walletAddress || '')
            setCopied(true)
            toast.success('Wallet address copied!')
            setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error('Failed to copy address')
        }
    }

    if (loading) return null

    const displayAddress = walletAddress || address

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    {authenticated && displayAddress ? (
                        <span>
                            {displayAddress?.slice(0, 6)}...
                            {displayAddress?.slice(-4)}
                        </span>
                    ) : (
                        'Sign In'
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Deposit Funds</DialogTitle>
                </DialogHeader>

                {!authenticated ? (
                    <div className="flex flex-col gap-4 py-4">
                        <p className="text-muted-foreground">
                            Sign in to deposit funds into your account.
                        </p>
                        <p className="text-sm text-muted-foreground">Please use the main Sign In button to continue.</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 py-4">
                        {/* Auto-detection notice */}
                        <div className="flex items-start gap-2 p-3 bg-blue-100 border border-blue-300 dark:bg-blue-500/10 dark:border-blue-500/20 rounded-md">
                            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                            <p className="text-xs text-blue-600 dark:text-blue-400">
                                Deposits are detected automatically. Your balance will update within seconds after your transaction confirms.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-sm font-medium">
                                <span>Asset</span>
                                <span className="text-xs text-muted-foreground font-mono">{TOKEN_ADDRESS.slice(0, 6)}...{TOKEN_ADDRESS.slice(-4)}</span>
                            </div>
                            <div className="p-2 border rounded-md bg-muted/50 text-sm font-semibold">
                                USDC ({networkName})
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Your Wallet Address</label>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 p-2 border rounded-md bg-muted/30 text-xs font-mono text-muted-foreground truncate">
                                    {walletAddress || 'Not connected'}
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={copyToClipboard}
                                    disabled={!walletAddress}
                                    className="shrink-0"
                                >
                                    {copied ? (
                                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    ) : (
                                        <Copy className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Amount</label>
                            <Input
                                type="number"
                                placeholder="100"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                            />
                        </div>

                        <Button
                            onClick={handleDeposit}
                            disabled={isSending || isConfirming || !amount || !TREASURY_ADDRESS}
                        >
                            {isSending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirm in Wallet...
                                </>
                            ) : isConfirming ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming...
                                </>
                            ) : (
                                'Deposit USDC'
                            )}
                        </Button>

                        {hash && (
                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground break-all">
                                    Tx: {hash}
                                </div>
                                {isSuccess && (
                                    <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Transaction confirmed - balance will update shortly
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
