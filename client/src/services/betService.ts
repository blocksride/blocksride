import { type WalletClient } from 'viem'
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

export const betService = {
    // GET /api/pools — returns all keeper-configured pools
    getPools: async (): Promise<Pool[]> => {
        const res = await axiosInstance.get<Pool[]>('/pools')
        return res.data
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
                poolId:   pool.poolId as `0x${string}`,
                cellId:   BigInt(cellId),
                windowId: BigInt(windowId),
                amount:   amountUsdc,
                nonce,
                deadline,
            },
        })

        const res = await axiosInstance.post<ScheduledBet>('/relay/bet', {
            poolId:        pool.poolId,
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
}
