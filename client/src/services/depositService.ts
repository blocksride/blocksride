import { type WalletClient } from 'viem'
import axiosInstance from '../utility/axiosInterceptor'

// USDC token address on Base
const USDC_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

// EIP-2612 Permit domain for USDC on Base
// Note: Circle's FiatTokenV2 uses 'USD Coin' as the EIP-712 domain name (same as token name())
const PERMIT_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453, // Base mainnet
  verifyingContract: USDC_ADDRESS as `0x${string}`,
}

// Permit types for EIP-712 signing
const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export interface PermitSignature {
  v: number
  r: `0x${string}`
  s: `0x${string}`
}

export interface PermitInfo {
  nonce: string
  relayerAddress: string
  treasuryAddress: string
}

export interface GaslessDepositResult {
  txHash: string
  success: boolean
  balance?: number // Updated balance after deposit
  message?: string
}

export interface ApprovalStatus {
  approved: boolean
  allowance: string
  allowanceUsdc: number
  relayerAddress: string
  tokenAddress: string
  walletBalance: number
  walletAddress: string
}

export interface AutoDepositResult {
  txHash: string
  success: boolean
  message: string
  balance?: number // Updated balance after deposit
}

// Split a signature into v, r, s components
function splitSignature(signature: `0x${string}`): PermitSignature {
  const r = `0x${signature.slice(2, 66)}` as `0x${string}`
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`
  let v = parseInt(signature.slice(130, 132), 16)

  // EIP-155 recovery id handling
  if (v < 27) {
    v += 27
  }

  return { v, r, s }
}

export const depositService = {
  // Get permit info from backend (nonce, relayer address)
  getPermitInfo: async (userAddress: string): Promise<PermitInfo> => {
    const response = await axiosInstance.get(`/wallet/permit-info?address=${userAddress}`)
    return response.data
  },

  // Sign a permit message (gasless - no on-chain transaction)
  signPermit: async (
    walletClient: WalletClient,
    userAddress: `0x${string}`,
    spender: `0x${string}`,
    amount: bigint,
    deadline: bigint,
    nonce: bigint,
    chainId: number = 8453
  ): Promise<PermitSignature> => {
    // Update domain with correct chain ID
    const domain = {
      ...PERMIT_DOMAIN,
      chainId,
    }

    const message = {
      owner: userAddress,
      spender: spender,
      value: amount,
      nonce: nonce,
      deadline: deadline,
    }

    // Sign typed data using EIP-712
    const signature = await walletClient.signTypedData({
      account: userAddress,
      domain,
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message,
    })

    return splitSignature(signature)
  },

  // Submit gasless deposit to backend
  // Note: Blockchain transactions can take 30-90+ seconds to confirm
  submitGaslessDeposit: async (params: {
    amount: string
    permitAmount: string
    deadline: string
    v: number
    r: string
    s: string
  }): Promise<GaslessDepositResult> => {
    const response = await axiosInstance.post('/wallet/gasless-deposit', params, {
      timeout: 120000, // 2 minutes - blockchain tx can take time to confirm
    })
    return response.data
  },

  // Full gasless deposit flow
  // Signs a permit for UNLIMITED amount (max uint256) so future deposits don't need permits
  executeGaslessDeposit: async (
    walletClient: WalletClient,
    userAddress: `0x${string}`,
    amount: bigint,
    chainId: number = 8453
  ): Promise<GaslessDepositResult> => {
    // 1. Get permit info from backend
    const permitInfo = await depositService.getPermitInfo(userAddress)

    // 2. Calculate deadline (1 hour from now)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

    // 3. Use max uint256 for permit amount (unlimited approval)
    // This way, after first deposit, all future deposits won't need new permits
    const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

    // 4. Sign permit for UNLIMITED amount (no gas needed - just a signature)
    const { v, r, s } = await depositService.signPermit(
      walletClient,
      userAddress,
      permitInfo.relayerAddress as `0x${string}`,
      MAX_UINT256, // Sign for unlimited amount
      deadline,
      BigInt(permitInfo.nonce),
      chainId
    )

    // 5. Submit to backend - relayer will execute on-chain
    // Backend will use permitAmount for permit call, amount for transferFrom
    const result = await depositService.submitGaslessDeposit({
      amount: amount.toString(),
      permitAmount: MAX_UINT256.toString(),
      deadline: deadline.toString(),
      v,
      r,
      s,
    })

    return result
  },

  // Get user's approval status for one-time approval flow
  getApprovalStatus: async (): Promise<ApprovalStatus> => {
    const response = await axiosInstance.get('/wallet/approval-status')
    return response.data
  },

  // Execute auto-deposit for pre-approved users (no permit signing needed)
  // Note: Blockchain transactions can take 30-90+ seconds to confirm
  executeAutoDeposit: async (amount: number): Promise<AutoDepositResult> => {
    const response = await axiosInstance.post('/wallet/auto-deposit', {
      amount: amount.toString(),
    }, {
      timeout: 120000, // 2 minutes - blockchain tx can take time to confirm
    })
    return response.data
  },
}

export default depositService
