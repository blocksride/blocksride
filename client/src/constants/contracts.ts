export const EthRideVaultABI = [
  'function deposit(uint256 amount) external',
  'function withdraw(uint256 amount, uint256 nonce, bytes memory signature) external',
  'event Deposit(address indexed user, uint256 amount)',
  'event Withdrawal(address indexed user, uint256 amount, uint256 nonce)',
]

export const VaultAddress =
  (import.meta.env.VITE_ETHRIDE_VAULT_ADDRESS as `0x${string}`) ||
  '0x0000000000000000000000000000000000000000'
