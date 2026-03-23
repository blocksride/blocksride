import { createPublicClient, encodeAbiParameters, http, isAddress, keccak256, maxUint256, parseSignature, type WalletClient } from 'viem'
import axiosInstance from '../utility/axiosInterceptor'
import { activeChain, rpcUrl } from '@/providers/Web3Provider'
import { getRuntimeNetworkConfig } from '@/lib/networkConfig'

// Pool shape returned by GET /api/pools
export interface Pool {
    poolId: string   // 0x-prefixed 32-byte hex (keccak256 of ABI-encoded PoolKey)
    name?: string
    poolKey: {
        currency0: string
        currency1: string
        fee: number
        tickSpacing: number
        hooks: string    // PariHook contract address — EIP-712 verifyingContract
    }
    assetId: string
    priceFeedId?: string
    gridEpoch: number
    windowDurationSec: number
}

export interface PoolKey {
    currency0: string
    currency1: string
    fee: number
    tickSpacing: number
    hooks: string
}

export interface ScheduledBet {
    intentId: string
    submitAfter: number  // unix timestamp when relay submits the tx
}

export type BetStatus =
    | { state: 'pending'; submitAfter: number }
    | { state: 'submitting' }
    | { state: 'confirmed'; betTxHash: string; permitTxHash?: string }
    | { state: 'failed'; error: string }

export interface SubmittedClaim {
    txHash: string
}

export interface ApprovalResult {
    allowance: bigint
    requiresPermit: boolean
}

export interface PermitPayload {
    permitAmount: bigint
    permitDeadline: bigint
    permitV: number
    permitR: `0x${string}`
    permitS: `0x${string}`
}

const erc20ApprovalAbi = [
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
] as const

// EIP-712 types matching BetIntent in PariHook.sol
const BET_INTENT_TYPES = {
    BetIntent: [
        { name: 'user',     type: 'address' },
        { name: 'poolId',   type: 'bytes32' },
        { name: 'cellId',   type: 'uint256' },
        { name: 'windowId', type: 'uint256' },
        { name: 'amount',   type: 'uint256' },
        { name: 'nonce',    type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
} as const

// EIP-712 types matching ClaimIntent in PariHook.sol
const CLAIM_INTENT_TYPES = {
    ClaimIntent: [
        { name: 'user',      type: 'address' },
        { name: 'poolId',    type: 'bytes32' },
        { name: 'windowIds', type: 'uint256[]' },
        { name: 'nonce',     type: 'uint256' },
        { name: 'deadline',  type: 'uint256' },
    ],
} as const

const bigintJsonReplacer = (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value

const signTypedDataWithProvider = async (
    walletClient: WalletClient,
    account: `0x${string}`,
    typedData: Record<string, unknown>,
) => {
    const request = walletClient.transport.request
    if (!request) {
        return walletClient.signTypedData({
            ...(typedData as Parameters<typeof walletClient.signTypedData>[0]),
            account,
        })
    }

    const payload = JSON.stringify(typedData, bigintJsonReplacer)
    const signature = await request({
        method: 'eth_signTypedData_v4',
        params: [account, payload],
    })

    if (typeof signature !== 'string') {
        throw new Error('Wallet returned invalid typed-data signature')
    }

    return signature as `0x${string}`
}

export const betService = {
    normalizePoolId: (pool: Pool): `0x${string}` => {
        const candidate = pool.poolId as `0x${string}` | undefined
        if (candidate && /^0x[0-9a-fA-F]{64}$/.test(candidate)) {
            return candidate
        }

        const key = pool.poolKey
        if (
            !isAddress(key.currency0) ||
            !isAddress(key.currency1) ||
            !isAddress(key.hooks)
        ) {
            throw new Error('Invalid pool key addresses from /api/pools')
        }

        const encoded = encodeAbiParameters(
            [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'tickSpacing', type: 'int24' },
                { name: 'hooks', type: 'address' },
            ],
            [
                key.currency0 as `0x${string}`,
                key.currency1 as `0x${string}`,
                key.fee,
                key.tickSpacing,
                key.hooks as `0x${string}`,
            ],
        )

        return keccak256(encoded)
    },

    // GET /api/pools — returns all keeper-configured pools
    getPools: async (): Promise<Pool[]> => {
        const res = await axiosInstance.get<Pool[]>('/pools')
        return res.data.map((pool) => ({
            ...pool,
            poolId: betService.normalizePoolId(pool),
        }))
    },

    // GET /api/relay/bet-nonce — on-chain nonce from PariHook.betNonces(user)
    getBetNonce: async (address: string): Promise<bigint> => {
        const res = await axiosInstance.get<{ nonce: string }>(`/relay/bet-nonce?address=${address}`)
        return BigInt(res.data.nonce)
    },

    getHookApprovalStatus: async (
        userAddress: `0x${string}`,
        tokenAddress: `0x${string}`,
        hookAddress: `0x${string}`,
        requiredAmount: bigint,
    ): Promise<ApprovalResult> => {
        const publicClient = createPublicClient({
            chain: activeChain,
            transport: http(rpcUrl),
        })

        const allowance = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20ApprovalAbi,
            functionName: 'allowance',
            args: [userAddress, hookAddress],
        })

        return { allowance, requiresPermit: allowance < requiredAmount }
    },

    getPermitInfo: async (address: `0x${string}`) => {
        const res = await axiosInstance.get<{
            nonce: string
            tokenAddress: `0x${string}`
            chainId: string
            spenderAddress?: `0x${string}`
            hookAddress?: `0x${string}`
            domainName?: string
            domainVersion?: string
        }>(`/wallet/permit-info?address=${address}`)

        const spenderAddress = res.data.spenderAddress ?? res.data.hookAddress
        return {
            nonce: BigInt(res.data.nonce),
            tokenAddress: res.data.tokenAddress,
            chainId: Number(res.data.chainId),
            domainName: res.data.domainName ?? 'USD Coin',
            domainVersion: res.data.domainVersion ?? '2',
            ...(spenderAddress ? { spenderAddress } : {}),
        }
    },

    signHookPermit: async (
        walletClient: WalletClient,
        userAddress: `0x${string}`,
        tokenAddress: `0x${string}`,
        hookAddress: `0x${string}`,
        chainId: number,
    ): Promise<PermitPayload> => {
        const { nonce, spenderAddress, domainName, domainVersion } = await betService.getPermitInfo(userAddress)
        const permitSpender = spenderAddress ?? hookAddress

        if (spenderAddress && spenderAddress.toLowerCase() !== hookAddress.toLowerCase()) {
            throw new Error('Permit spender mismatch between backend and pool hook')
        }

        const permitAmount = maxUint256
        const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 300)

        const signature = await signTypedDataWithProvider(walletClient, userAddress, {
            domain: {
                name: domainName,
                version: domainVersion,
                chainId,
                verifyingContract: tokenAddress,
            },
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' },
                ],
                Permit: [
                    { name: 'owner', type: 'address' },
                    { name: 'spender', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            },
            primaryType: 'Permit',
            message: {
                owner: userAddress,
                spender: permitSpender,
                value: permitAmount,
                nonce,
                deadline: permitDeadline,
            },
        })

        const parsed = parseSignature(signature)
        return {
            permitAmount,
            permitDeadline,
            permitV: Number(parsed.v ?? 27),
            permitR: parsed.r,
            permitS: parsed.s,
        }
    },

    // Sign a BetIntent EIP-712 message and POST to POST /api/relay/bet.
    // Returns intentId + submitAfter timestamp; relay auto-submits after 3 s undo window.
    signAndScheduleBet: async (
        walletClient: WalletClient,
        userAddress: `0x${string}`,
        pool: Pool,
        cellId: number,
        windowId: number,
        amountUsdc: bigint,   // USDC amount in 6-decimal units
        chainId: number,
        submitAfterMs = 3000,
    ): Promise<ScheduledBet> => {
        const nonce    = await betService.getBetNonce(userAddress)
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300) // 5 min

        const normalizedPoolId = betService.normalizePoolId(pool)
        const tokenAddress = (import.meta.env.VITE_TOKEN_ADDRESS ||
            getRuntimeNetworkConfig().usdcTokenAddress) as `0x${string}`
        const approval = await betService.getHookApprovalStatus(
            userAddress,
            tokenAddress,
            pool.poolKey.hooks as `0x${string}`,
            amountUsdc,
        )
        const permit = approval.requiresPermit
            ? await betService.signHookPermit(
                walletClient,
                userAddress,
                tokenAddress,
                pool.poolKey.hooks as `0x${string}`,
                chainId,
            )
            : null

        const signature = await signTypedDataWithProvider(walletClient, userAddress, {
            domain: {
                name:              'PariHook',
                version:           '1',
                chainId,
                verifyingContract: pool.poolKey.hooks as `0x${string}`,
            },
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' },
                ],
                ...BET_INTENT_TYPES,
            },
            primaryType: 'BetIntent',
            message: {
                user:     userAddress,
                poolId:   normalizedPoolId,
                cellId:   BigInt(cellId),
                windowId: BigInt(windowId),
                amount:   amountUsdc,
                nonce,
                deadline,
            },
        })

        const res = await axiosInstance.post<ScheduledBet>('/relay/bet', {
            poolId:        normalizedPoolId,
            poolKey:       pool.poolKey,
            cellId:        cellId.toString(),
            windowId:      windowId.toString(),
            amount:        amountUsdc.toString(),
            nonce:         nonce.toString(),
            deadline:      deadline.toString(),
            signature,
            signer:        userAddress,
            submitAfterMs,
            permitAmount: permit?.permitAmount.toString(),
            permitDeadline: permit?.permitDeadline.toString(),
            permitV: permit?.permitV,
            permitR: permit?.permitR,
            permitS: permit?.permitS,
        })

        return res.data
    },

    // DELETE /api/relay/bet/:intentId — cancel within undo window
    cancelBet: async (intentId: string): Promise<void> => {
        await axiosInstance.delete(`/relay/bet/${intentId}`)
    },

    // GET /api/relay/bet/:intentId — poll until confirmed or failed
    getBetStatus: async (intentId: string): Promise<BetStatus> => {
        const res = await axiosInstance.get<BetStatus>(`/relay/bet/${intentId}`)
        return res.data
    },

    // Poll until state is confirmed or failed (max ~30s)
    pollBetStatus: (intentId: string, onResult: (status: BetStatus) => void): (() => void) => {
        let stopped = false
        let attempts = 0
        const maxAttempts = 30

        const poll = async () => {
            if (stopped || attempts >= maxAttempts) return
            attempts++
            try {
                const status = await betService.getBetStatus(intentId)
                if (status.state === 'confirmed' || status.state === 'failed') {
                    onResult(status)
                    return
                }
            } catch {
                // ignore transient errors, keep polling
            }
            if (!stopped) setTimeout(poll, 1000)
        }

        setTimeout(poll, 1000)
        return () => { stopped = true }
    },

    // GET /api/relay/claim-nonce — on-chain nonce from PariHook.claimNonces(user)
    getClaimNonce: async (address: string): Promise<bigint> => {
        const res = await axiosInstance.get<{ nonce: string }>(`/relay/claim-nonce?address=${address}`)
        return BigInt(res.data.nonce)
    },

    // Sign a ClaimIntent EIP-712 message and POST to POST /api/relay/claim.
    // Relay submits claimAllFor immediately (no undo window for claims).
    signAndSubmitClaim: async (
        walletClient: WalletClient,
        userAddress: `0x${string}`,
        pool: Pool,
        windowIds: number[],
        chainId: number,
    ): Promise<SubmittedClaim> => {
        const nonce    = await betService.getClaimNonce(userAddress)
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300) // 5 min

        const normalizedPoolId = betService.normalizePoolId(pool)

        const signature = await signTypedDataWithProvider(walletClient, userAddress, {
            domain: {
                name:              'PariHook',
                version:           '1',
                chainId,
                verifyingContract: pool.poolKey.hooks as `0x${string}`,
            },
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' },
                ],
                ...CLAIM_INTENT_TYPES,
            },
            primaryType: 'ClaimIntent',
            message: {
                user:      userAddress,
                poolId:    normalizedPoolId,
                windowIds: windowIds.map(BigInt),
                nonce,
                deadline,
            },
        })

        const res = await axiosInstance.post<SubmittedClaim>('/relay/claim', {
            poolId:    normalizedPoolId,
            windowIds: windowIds.map(String),
            nonce:     nonce.toString(),
            deadline:  deadline.toString(),
            signature,
            user:      userAddress,
        })

        return res.data
    },
}
