import { encodeAbiParameters, isAddress, keccak256, type WalletClient } from 'viem'
import axiosInstance from '../utility/axiosInterceptor'

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

export interface ScheduledBet {
    intentId: string
    submitAfter: number  // unix timestamp when relay submits the tx
}

export interface SubmittedClaim {
    txHash: string
}

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

        const signature = await walletClient.signTypedData({
            account: userAddress,
            domain: {
                name:              'PariHook',
                version:           '1',
                chainId,
                verifyingContract: pool.poolKey.hooks as `0x${string}`,
            },
            types:       BET_INTENT_TYPES,
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
            cellId:        cellId.toString(),
            windowId:      windowId.toString(),
            amount:        amountUsdc.toString(),
            nonce:         nonce.toString(),
            deadline:      deadline.toString(),
            signature,
            signer:        userAddress,
            submitAfterMs,
        })

        return res.data
    },

    // DELETE /api/relay/bet/:intentId — cancel within undo window
    cancelBet: async (intentId: string): Promise<void> => {
        await axiosInstance.delete(`/relay/bet/${intentId}`)
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

        const signature = await walletClient.signTypedData({
            account: userAddress,
            domain: {
                name:              'PariHook',
                version:           '1',
                chainId,
                verifyingContract: pool.poolKey.hooks as `0x${string}`,
            },
            types:       CLAIM_INTENT_TYPES,
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
