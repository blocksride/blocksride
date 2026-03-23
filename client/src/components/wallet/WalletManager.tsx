import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogDescription, DialogTrigger, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Copy, Loader2 } from 'lucide-react'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { useAuth } from '@/contexts/AuthContext'
import { networkName } from '@/providers/Web3Provider'
import { cn } from '@/lib/utils'
import { parseUnits, isAddress } from 'viem'
import { useWallets } from '@privy-io/react-auth'
import { activeChain } from '@/providers/Web3Provider'

const WITHDRAWAL_FEE_USDC = parseFloat(import.meta.env.VITE_WITHDRAWAL_FEE_USDC || '0.04')
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'

export function WalletManager() {
    const navigate = useNavigate()
    const { authenticated, signOut, walletAddress, signIn } = useAuth()
    const { formatted: walletBalance } = useTokenBalance()
    const onchainBalance = Number(walletBalance ?? 0)

    const [isOpen, setIsOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<'status' | 'fund' | 'withdraw'>('status')
    const [withdrawTo, setWithdrawTo] = useState('')
    const [withdrawAmount, setWithdrawAmount] = useState('')

    const TOKEN_ADDRESS = (import.meta.env.VITE_TOKEN_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`

    const { wallets } = useWallets()
    const [isWithdrawPending, setIsWithdrawPending] = useState(false)
    const [withdrawHash, setWithdrawHash] = useState<string | null>(null)

    const handleWithdraw = async () => {
        if (!isAddress(withdrawTo)) {
            toast.error('Invalid destination address')
            return
        }
        const amt = parseFloat(withdrawAmount)
        if (!amt || amt <= 0) {
            toast.error('Enter a valid amount')
            return
        }
        if (amt <= WITHDRAWAL_FEE_USDC) {
            toast.error(`Amount must be greater than fee ($${WITHDRAWAL_FEE_USDC})`)
            return
        }
        if (amt > onchainBalance) {
            toast.error('Amount exceeds balance')
            return
        }

        const wallet = wallets.find(w => w.address.toLowerCase() === walletAddress?.toLowerCase()) ?? wallets[0]
        if (!wallet) {
            toast.error('No wallet found')
            return
        }

        try {
            setIsWithdrawPending(true)
            await wallet.switchChain(activeChain.id)
            const provider = await wallet.getEthereumProvider()

            // Fetch relayer address — the EIP-3009 `to` must match what the server uses
            const relayerRes = await fetch(`${SERVER_URL}/api/relay/address`)
            if (!relayerRes.ok) throw new Error('Failed to fetch relayer address')
            const { address: relayerAddress } = await relayerRes.json() as { address: string }

            const amountRaw = parseUnits(withdrawAmount, 6)
            const validBefore = Math.floor(Date.now() / 1000) + 300 // 5 min deadline
            const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
            const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

            const sig = await provider.request({
                method: 'eth_signTypedData_v4',
                params: [
                    wallet.address,
                    JSON.stringify({
                        types: {
                            EIP712Domain: [
                                { name: 'name',              type: 'string'  },
                                { name: 'version',           type: 'string'  },
                                { name: 'chainId',           type: 'uint256' },
                                { name: 'verifyingContract', type: 'address' },
                            ],
                            TransferWithAuthorization: [
                                { name: 'from',        type: 'address' },
                                { name: 'to',          type: 'address' },
                                { name: 'value',       type: 'uint256' },
                                { name: 'validAfter',  type: 'uint256' },
                                { name: 'validBefore', type: 'uint256' },
                                { name: 'nonce',       type: 'bytes32' },
                            ],
                        },
                        primaryType: 'TransferWithAuthorization',
                        domain: {
                            name: 'USD Coin',
                            version: '2',
                            chainId: activeChain.id,
                            verifyingContract: TOKEN_ADDRESS,
                        },
                        message: {
                            from:        wallet.address,
                            to:          relayerAddress,
                            value:       amountRaw.toString(),
                            validAfter:  '0',
                            validBefore: validBefore.toString(),
                            nonce,
                        },
                    }),
                ],
            }) as string

            const v = parseInt(sig.slice(130, 132), 16)
            const r = '0x' + sig.slice(2, 66)
            const s = '0x' + sig.slice(66, 130)

            const res = await fetch(`${SERVER_URL}/api/relay/withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: wallet.address,
                    to: withdrawTo,
                    amount: amountRaw.toString(),
                    validAfter: 0,
                    validBefore,
                    nonce,
                    v, r, s,
                }),
            })

            const data = await res.json() as { txHash?: string; error?: string }
            if (!res.ok) throw new Error(data.error ?? 'Withdrawal failed')

            setWithdrawHash(data.txHash ?? null)
            toast.success(`Sent $${(amt - WITHDRAWAL_FEE_USDC).toFixed(2)} USDC (fee: $${WITHDRAWAL_FEE_USDC})`)
            setWithdrawTo('')
            setWithdrawAmount('')
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Withdrawal failed')
        } finally {
            setIsWithdrawPending(false)
        }
    }

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
                        {(['status', 'fund', 'withdraw'] as const).map((tab) => (
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

                        {activeTab === 'withdraw' && (
                            <div className="space-y-4 text-xs">
                                <div>
                                    <div className="text-zinc-500 mb-1">WITHDRAWABLE</div>
                                    <div className="text-xl font-bold text-green-400">
                                        ${Math.max(0, onchainBalance - WITHDRAWAL_FEE_USDC).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                                    </div>
                                    <div className="text-[10px] text-zinc-600 mt-0.5">
                                        ${WITHDRAWAL_FEE_USDC.toFixed(2)} USDC fee covers gas · no ETH needed
                                    </div>
                                </div>

                                <div>
                                    <div className="text-zinc-500 mb-1">DESTINATION ADDRESS</div>
                                    <input
                                        type="text"
                                        placeholder="0x..."
                                        value={withdrawTo}
                                        onChange={(e) => setWithdrawTo(e.target.value)}
                                        className="w-full bg-zinc-900 border border-zinc-700 p-2 text-zinc-300 font-mono text-[11px] focus:outline-none focus:border-green-500/50 placeholder:text-zinc-600"
                                    />
                                </div>

                                <div>
                                    <div className="text-zinc-500 mb-1">AMOUNT (USDC)</div>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            placeholder="0.00"
                                            value={withdrawAmount}
                                            onChange={(e) => setWithdrawAmount(e.target.value)}
                                            className="flex-1 bg-zinc-900 border border-zinc-700 p-2 text-zinc-300 font-mono focus:outline-none focus:border-green-500/50 placeholder:text-zinc-600"
                                        />
                                        <button
                                            onClick={() => setWithdrawAmount(Math.max(0, onchainBalance - WITHDRAWAL_FEE_USDC).toFixed(6))}
                                            className="px-3 py-1 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all"
                                        >
                                            MAX
                                        </button>
                                    </div>
                                </div>

                                <button
                                    onClick={handleWithdraw}
                                    disabled={isWithdrawPending || !withdrawTo || !withdrawAmount}
                                    className={cn(
                                        'w-full py-2.5 border transition-all flex items-center justify-center gap-2',
                                        isWithdrawPending
                                            ? 'border-zinc-700 text-zinc-500 cursor-not-allowed'
                                            : 'border-green-500/40 text-green-400 hover:bg-green-500/10'
                                    )}
                                >
                                    {isWithdrawPending ? (
                                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> SENDING...</>
                                    ) : withdrawHash ? (
                                        '[WITHDRAWAL SENT]'
                                    ) : (
                                        '[WITHDRAW]'
                                    )}
                                </button>

                                {withdrawHash && (
                                    <div className="text-[10px] text-zinc-600 break-all">
                                        TX: {withdrawHash}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </DialogContent>
            )}
        </Dialog>
    )
}
