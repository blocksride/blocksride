import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Copy, Loader2, Check, Shield } from 'lucide-react'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { isAddress, getAddress, parseUnits, createWalletClient, custom, type WalletClient } from 'viem'
import { api, type WithdrawalRequest, type WithdrawalStatus } from '@/services/apiService'
import { useAuth } from '@/contexts/AuthContext'
import { networkName, expectedChainId, activeChain } from '@/providers/Web3Provider'
import { cn } from '@/lib/utils'
import { useWallets } from '@privy-io/react-auth'
import { depositService, type ApprovalStatus } from '@/services/depositService'

const getStatusIndicator = (status: WithdrawalStatus) => {
    switch (status) {
        case 'completed': return <span className="text-green-500">[OK]</span>
        case 'failed': return <span className="text-red-500">[FAIL]</span>
        case 'pending':
        case 'processing': return <span className="text-yellow-500">[...]</span>
        case 'queued': return <span className="text-orange-500">[Q]</span>
        default: return <span className="text-zinc-500">[?]</span>
    }
}

export function WalletManager() {
    const navigate = useNavigate()
    const { authenticated, signOut, refreshUser, walletAddress, signIn } = useAuth()

    // Use Privy login for wallet connection
    const connectWallet = () => signIn()

    const [isOpen, setIsOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<'status' | 'deposit' | 'withdraw'>('status')
    const [isSending, setIsSending] = useState(false)
    const [recipientAddress, setRecipientAddress] = useState('')
    const [sendAmount, setSendAmount] = useState('')
    const [showSendConfirmation, setShowSendConfirmation] = useState(false)
    const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
    const [isLoadingWithdrawals, setIsLoadingWithdrawals] = useState(false)
    const [privyWalletClient, setPrivyWalletClient] = useState<WalletClient | null>(null)

    // Get Privy embedded wallet
    const { wallets } = useWallets()
    const embeddedWallet = wallets.find(w => w.walletClientType === 'privy')
    const activeWallet = embeddedWallet || wallets[0]

    const { formatted: walletBalance, refetch: refetchBalance } = useTokenBalance()
    const { user } = useAuth()
    const dbBalance = user?.balance ?? 0

    // Auto-deposit state
    const [isAutoDepositing, setIsAutoDepositing] = useState(false)
    const previousBalanceRef = useRef<string | null>(null)
    const autoDepositInProgressRef = useRef(false)

    // One-time approval state
    const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | null>(null)
    const [isCheckingApproval, setIsCheckingApproval] = useState(false)

    useEffect(() => {
        if (isOpen && authenticated) {
            refreshUser()
            fetchWithdrawals()
        }
    }, [isOpen, authenticated, refreshUser])

    const fetchWithdrawals = async () => {
        setIsLoadingWithdrawals(true)
        try {
            const response = await api.getWithdrawals(10, 0)
            setWithdrawals(response.data)
        } catch (error) {
            console.error('Failed to fetch withdrawals:', error)
        } finally {
            setIsLoadingWithdrawals(false)
        }
    }

    // Get wallet client from Privy embedded wallet
    const getWalletClient = useCallback(async () => {
        if (!activeWallet) return null
        try {
            const provider = await activeWallet.getEthereumProvider()
            const client = createWalletClient({
                account: activeWallet.address as `0x${string}`,
                chain: activeChain,
                transport: custom(provider),
            })
            return client
        } catch (error) {
            console.error('Failed to get wallet client:', error)
            return null
        }
    }, [activeWallet])

    // Initialize wallet client when wallet is available
    useEffect(() => {
        if (activeWallet) {
            getWalletClient().then(setPrivyWalletClient)
        }
    }, [activeWallet, getWalletClient])

    // Check approval status when authenticated
    const checkApprovalStatus = useCallback(async () => {
        if (!authenticated) return
        setIsCheckingApproval(true)
        try {
            const status = await depositService.getApprovalStatus()
            setApprovalStatus(status)
        } catch (error) {
            console.error('Failed to check approval status:', error)
        } finally {
            setIsCheckingApproval(false)
        }
    }, [authenticated])

    useEffect(() => {
        if (authenticated && isOpen) {
            checkApprovalStatus()
        }
    }, [authenticated, isOpen, checkApprovalStatus])

    // Auto-deposit: when wallet balance increases, automatically deposit to platform
    useEffect(() => {
        const currentBalance = walletBalance ? Number(walletBalance) : 0
        const previousBalance = previousBalanceRef.current ? Number(previousBalanceRef.current) : 0

        // Update previous balance ref
        if (walletBalance !== null) {
            previousBalanceRef.current = walletBalance
        }

        // Check if balance increased and we're not already auto-depositing
        if (
            currentBalance > 0 &&
            currentBalance > previousBalance &&
            previousBalance >= 0 &&
            authenticated &&
            walletAddress &&
            !autoDepositInProgressRef.current
        ) {
            // Auto-deposit the full wallet balance
            autoDepositInProgressRef.current = true
            setIsAutoDepositing(true)

            const autoDeposit = async () => {
                try {
                    // Check if user has one-time approval
                    const hasApproval = approvalStatus?.approved

                    if (hasApproval) {
                        // Use auto-deposit (no signing required!)
                        toast.info(`Auto-depositing $${currentBalance.toFixed(2)} to platform...`)

                        const result = await depositService.executeAutoDeposit(currentBalance)

                        if (result.success) {
                            toast.success(`$${currentBalance.toFixed(2)} deposited to platform!`, { duration: 5000 })
                            refreshUser()
                            refetchBalance()
                        } else {
                            toast.error('Auto-deposit failed. Please deposit manually.')
                        }
                    } else {
                        // Fall back to gasless deposit (requires permit signature)
                        const walletClient = privyWalletClient || await getWalletClient()
                        if (!walletClient) {
                            toast.error('Failed to get wallet client for auto-deposit')
                            return
                        }

                        const amountWei = parseUnits(currentBalance.toString(), 6)
                        toast.info(`Auto-depositing $${currentBalance.toFixed(2)} to platform (signature required)...`)

                        const result = await depositService.executeGaslessDeposit(
                            walletClient,
                            walletAddress as `0x${string}`,
                            amountWei,
                            expectedChainId
                        )

                        if (result.success) {
                            toast.success(`$${currentBalance.toFixed(2)} deposited to platform!`, { duration: 5000 })
                            refreshUser()
                            refetchBalance()
                        } else {
                            toast.error('Auto-deposit failed. Please deposit manually.')
                        }
                    }
                } catch (error) {
                    console.error('Auto-deposit error:', error)
                    if (error instanceof Error && error.message.includes('User rejected')) {
                        toast.error('Deposit cancelled')
                    } else {
                        toast.error('Auto-deposit failed. Please deposit manually.')
                    }
                } finally {
                    autoDepositInProgressRef.current = false
                    setIsAutoDepositing(false)
                }
            }

            autoDeposit()
        }
    }, [walletBalance, authenticated, walletAddress, privyWalletClient, getWalletClient, refreshUser, refetchBalance, approvalStatus])

    const validateAddress = (addr: string): string | null => {
        if (!addr) return 'Recipient address is required'
        if (!isAddress(addr)) return 'Invalid Ethereum address format'
        try {
            getAddress(addr)
        } catch {
            return 'Invalid address checksum'
        }
        return null
    }

    const handleSendClick = () => {
        if (!recipientAddress || !sendAmount) {
            toast.error('Please fill in all fields')
            return
        }
        const addressError = validateAddress(recipientAddress)
        if (addressError) {
            toast.error(addressError)
            return
        }
        const amount = parseFloat(sendAmount)
        if (isNaN(amount) || amount <= 0) {
            toast.error('Please enter a valid amount')
            return
        }
        if (amount > dbBalance) {
            toast.error('Insufficient balance')
            return
        }
        setShowSendConfirmation(true)
    }

    const handleConfirmSend = async () => {
        setShowSendConfirmation(false)
        setIsSending(true)
        try {
            const checksumAddress = getAddress(recipientAddress)
            const amount = parseFloat(sendAmount)
            await api.withdraw(amount, checksumAddress)
            toast.success('Withdrawal requested!')
            refreshUser() // Update balance immediately
            fetchWithdrawals()
            setRecipientAddress('')
            setSendAmount('')
            setActiveTab('status')
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Withdrawal failed'
            toast.error(errorMessage)
        } finally {
            setIsSending(false)
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
        <>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <button
                    className="group flex items-center gap-2 px-3 py-1.5 bg-secondary/60 hover:bg-secondary/80 border border-border rounded transition-all text-xs font-mono text-muted-foreground hover:text-foreground"
                    data-wallet-trigger
                    aria-label={authenticated ? `Wallet: ${walletAddress ?? 'connected'}` : 'Sign in'}
                >
                    {authenticated ? (
                        <span>
                            {walletAddress
                                ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
                                : `$${dbBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </span>
                    ) : (
                        <div className="flex items-center gap-2">
                            <span className="text-primary">●</span>
                            sign in
                        </div>
                    )}
                </button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[420px] p-0 gap-0 bg-zinc-950 border border-zinc-700 font-mono overflow-hidden">
                <DialogTitle className="sr-only">Wallet Manager</DialogTitle>
                {!authenticated ? (
                    <div className="p-6">
                        <div className="border border-zinc-800 p-4 mb-4">
                            <p className="text-zinc-400 text-xs mb-3">Not logged in.</p>
                            <p className="text-zinc-500 text-xs">Sign in to access trading functions.</p>
                        </div>
                        <button
                            onClick={connectWallet}
                            className="w-full py-2 bg-green-500/20 border border-green-500/50 text-green-500 text-xs hover:bg-green-500/30 transition-all"
                        >
                            [SIGN IN]
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Terminal Header */}
                        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">wallet@blip</span>
                                <span className={cn(
                                    "px-2 py-0.5 text-[10px]",
                                    networkName === 'Sepolia' ? "text-orange-400" : "text-green-400"
                                )}>
                                    {networkName.toUpperCase()}
                                </span>
                            </div>
                        </div>

                        {/* Balance Display */}
                        <div className="px-4 py-4 border-b border-zinc-800">
                            <div className="text-xs text-zinc-500 mb-1">PLATFORM_BALANCE</div>
                            <div className="text-2xl font-bold text-green-400">
                                ${dbBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                        </div>

                        {/* Tab Navigation */}
                        <div className="flex border-b border-zinc-800 text-xs" role="tablist" aria-label="Wallet options">
                            {(['status', 'deposit', 'withdraw'] as const).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    role="tab"
                                    aria-selected={activeTab === tab}
                                    aria-controls={`${tab}-panel`}
                                    id={`${tab}-tab`}
                                    className={cn(
                                        "flex-1 py-2.5 transition-all border-b-2 -mb-px",
                                        activeTab === tab
                                            ? "text-green-400 border-green-500 bg-green-500/5"
                                            : "text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-900"
                                    )}
                                >
                                    {tab.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        {/* Tab Content */}
                        <div className="p-4 max-h-[300px] overflow-y-auto">
                            {activeTab === 'status' && (
                                <div className="space-y-4 text-xs">
                                    {/* Address */}
                                    <div>
                                        <div className="text-zinc-500 mb-1">CONNECTED_ADDRESS</div>
                                        <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-2">
                                            <code className="text-zinc-300">{walletAddress}</code>
                                            <button
                                                onClick={() => copyToClipboard(walletAddress || '', 'Address')}
                                                className="text-zinc-500 hover:text-green-400 transition-colors ml-2"
                                                aria-label="Copy wallet address"
                                            >
                                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Recent Transactions */}
                                    <div>
                                        <div className="text-zinc-500 mb-2">RECENT_WITHDRAWALS</div>
                                        {isLoadingWithdrawals ? (
                                            <div className="text-zinc-600 py-2">loading...</div>
                                        ) : withdrawals.length === 0 ? (
                                            <div className="text-zinc-600 py-2">no transactions</div>
                                        ) : (
                                            <div className="border border-zinc-800 divide-y divide-zinc-800">
                                                {withdrawals.slice(0, 5).map((w) => (
                                                    <div key={w.id} className="flex items-center justify-between p-2 bg-zinc-900/50">
                                                        <div className="flex items-center gap-2">
                                                            {getStatusIndicator(w.status)}
                                                            <span className="text-zinc-300">${w.amount.toFixed(2)}</span>
                                                        </div>
                                                        <span className="text-zinc-600">
                                                            {new Date(w.created_at).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Disconnect */}
                                    <button
                                        onClick={handleDisconnect}
                                        className="w-full py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
                                    >
                                        [DISCONNECT]
                                    </button>
                                </div>
                            )}

                            {activeTab === 'deposit' && (
                                <div className="space-y-4 text-xs">
                                    {/* Your Wallet Address */}
                                    <div>
                                        <div className="text-zinc-500 mb-2">SEND USDC HERE</div>
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

                                    {/* Approval status */}
                                    {isCheckingApproval ? (
                                        <div className="flex items-center justify-center gap-2 p-3 bg-zinc-900 border border-zinc-800">
                                            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                                            <span className="text-zinc-500">Checking status...</span>
                                        </div>
                                    ) : approvalStatus?.approved ? (
                                        <div className="p-3 bg-green-500/10 border border-green-500/30">
                                            <div className="flex items-center gap-2 text-green-400 mb-1">
                                                <Check className="w-4 h-4" />
                                                <span className="font-bold">Auto-deposit enabled</span>
                                            </div>
                                            <div className="text-green-500/70 text-[10px]">
                                                Deposits are fully automatic. No signatures required!
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-3 bg-blue-500/10 border border-blue-500/30">
                                            <div className="flex items-center gap-2 text-blue-400 mb-1">
                                                <Shield className="w-4 h-4" />
                                                <span className="font-bold">First deposit</span>
                                            </div>
                                            <div className="text-blue-400/70 text-[10px]">
                                                Sign once to enable automatic deposits. No gas needed - we pay for you!
                                            </div>
                                        </div>
                                    )}

                                    {/* Auto-deposit status */}
                                    {isAutoDepositing ? (
                                        <div className="flex items-center justify-center gap-2 p-3 bg-green-500/10 border border-green-500/30 text-green-400">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Auto-depositing to platform...</span>
                                        </div>
                                    ) : (
                                        <div className="p-3 bg-zinc-900 border border-zinc-800 text-center">
                                            <div className="text-zinc-400 mb-1">How it works</div>
                                            <div className="text-zinc-600 text-[10px]">
                                                Send USDC from any wallet. We'll detect it and deposit to your platform balance automatically.
                                            </div>
                                        </div>
                                    )}

                                    {/* Current wallet balance (if any) */}
                                    {Number(walletBalance) > 0 && !isAutoDepositing && (
                                        <div className="flex justify-between p-2 bg-yellow-500/10 border border-yellow-500/30">
                                            <span className="text-yellow-500">PENDING_DEPOSIT</span>
                                            <span className="text-yellow-400">${Number(walletBalance).toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'withdraw' && (
                                <div className="space-y-4 text-xs">
                                    {/* Available */}
                                    <div className="flex justify-between p-2 bg-zinc-900 border border-zinc-800">
                                        <span className="text-zinc-500">AVAILABLE</span>
                                        <span className="text-green-400">${dbBalance.toFixed(2)}</span>
                                    </div>

                                    {/* Recipient */}
                                    <div>
                                        <label htmlFor="withdraw-address" className="text-zinc-500 mb-1 block">TO_ADDRESS</label>
                                        <input
                                            id="withdraw-address"
                                            type="text"
                                            placeholder="0x..."
                                            value={recipientAddress}
                                            onChange={(e) => setRecipientAddress(e.target.value)}
                                            className="w-full bg-zinc-900 border border-zinc-800 p-2 text-zinc-200 placeholder:text-zinc-700 focus:border-green-500/50 outline-none"
                                            aria-describedby="withdraw-address-hint"
                                        />
                                        <span id="withdraw-address-hint" className="sr-only">Enter the Ethereum address to receive your withdrawal</span>
                                    </div>

                                    {/* Amount */}
                                    <div>
                                        <div className="flex justify-between mb-1">
                                            <label htmlFor="withdraw-amount" className="text-zinc-500">AMOUNT</label>
                                            <button
                                                onClick={() => setSendAmount(dbBalance.toFixed(2))}
                                                className="text-green-500 hover:text-green-400"
                                                aria-label={`Set amount to maximum ($${dbBalance.toFixed(2)})`}
                                            >
                                                [MAX]
                                            </button>
                                        </div>
                                        <div className="flex items-center bg-zinc-900 border border-zinc-800">
                                            <span className="text-zinc-500 pl-2" aria-hidden="true">$</span>
                                            <input
                                                id="withdraw-amount"
                                                type="number"
                                                placeholder="0.00"
                                                value={sendAmount}
                                                onChange={(e) => setSendAmount(e.target.value)}
                                                className="flex-1 bg-transparent p-2 text-zinc-200 placeholder:text-zinc-700 focus:outline-none"
                                                aria-describedby="withdraw-amount-currency"
                                            />
                                            <span id="withdraw-amount-currency" className="sr-only">Amount in USDC</span>
                                        </div>
                                    </div>

                                    {/* Submit */}
                                    <button
                                        onClick={handleSendClick}
                                        disabled={isSending || dbBalance <= 0}
                                        className="w-full py-2 bg-green-500/20 border border-green-500/50 text-green-500 hover:bg-green-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSending ? 'PROCESSING...' : '[EXECUTE WITHDRAWAL]'}
                                    </button>

                                    {dbBalance <= 0 && (
                                        <div className="text-yellow-500 text-center">
                                            ! Insufficient balance
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>

        {/* Confirmation Dialog */}
        <AlertDialog open={showSendConfirmation} onOpenChange={setShowSendConfirmation}>
            <AlertDialogContent className="bg-zinc-950 border border-zinc-700 font-mono">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-white text-sm font-bold">
                        Confirm Withdrawal
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-3 text-xs">
                            <div className="border border-zinc-800 divide-y divide-zinc-800">
                                <div className="flex justify-between p-2">
                                    <span className="text-zinc-500">AMOUNT</span>
                                    <span className="text-green-400">${sendAmount} USDC</span>
                                </div>
                                <div className="flex justify-between p-2">
                                    <span className="text-zinc-500">TO</span>
                                    <span className="text-zinc-300">{recipientAddress.slice(0, 10)}...{recipientAddress.slice(-8)}</span>
                                </div>
                                <div className="flex justify-between p-2">
                                    <span className="text-zinc-500">NETWORK</span>
                                    <span className="text-zinc-300">{networkName}</span>
                                </div>
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex gap-2">
                    <AlertDialogCancel className="flex-1 bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs">
                        [CANCEL]
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirmSend}
                        className="flex-1 bg-green-500/20 border border-green-500/50 text-green-500 hover:bg-green-500/30 text-xs"
                    >
                        [CONFIRM]
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    )
}
