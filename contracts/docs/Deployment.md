# BlocksRide Deployment

**Network:** Base Sepolia  
**Deployment date:** March 2, 2026  
**Status:** Phase 1 betting contracts deployed

## Deployed Contract

- **PariHook:** `0xdbB492353B57698a5443bF1846F00c71EFA41824`
- **BaseScan:** https://sepolia.basescan.org/address/0xdbB492353B57698a5443bF1846F00c71EFA41824

## Infrastructure

| Component | Address |
|-----------|---------|
| PoolManager (Uniswap V4) | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| Pyth Oracle | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |
| Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Roles

| Role | Address | Purpose |
|------|---------|---------|
| `DEFAULT_ADMIN_ROLE` | `0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f` | Role management |
| `ADMIN_ROLE` | `0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f` | Protocol controls |
| `TREASURY_ROLE` | `0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f` | Fee and payout operations |
| `RELAYER_ROLE` | `0xF41886af501e2a0958dBD31D9a28AcD6c2f5db06` | Gasless transaction submission |

## What Phase 1 Deploys

PariHook is the prediction market engine. It:

- accepts USDC bets on ETH/USD price bands
- tracks user stakes by window and cell
- settles windows using Pyth prices
- handles rollover, void, and payout accounting

Phase 1 does **not** yet include:

- `RIDE` token rewards
- staking-based fee discounts
- an open trading market for `RIDE`

## Current Market Shape

- **Asset:** ETH/USD
- **Band width:** `$2.00`
- **Window duration:** `60 seconds`
- **Frozen windows:** `3`
- **Max stake per cell:** `$100,000`
- **Fee:** `2%`
- **Minimum organic pool threshold:** `$1.00`

## System Flow

1. User brings Base Sepolia USDC.
2. User places a bet on a future minute window and price cell.
3. Funds are locked and tracked on-chain by PariHook logic.
4. After window close, keeper or any caller submits `settle()` with Pyth data.
5. The window either:
   - settles normally,
   - rolls over if there are no winners, or
   - voids if oracle data is unavailable or the pool is too small.

## Next Required Steps

### 1. Configure the grid

Before betting, call `configureGrid(...)` with:

- ETH/USD Pyth feed id
- `$2.00` band width
- `60` second windows
- a future `gridEpoch`
- `gridEpoch` aligned to a minute boundary

### 2. Initialize the pool

After grid configuration:

```solidity
poolManager.initialize(poolKey, sqrtPriceX96)
```

### 3. Wire backend services

Backend and keeper env should include:

```bash
PARI_HOOK_ADDRESS=0xdbB492353B57698a5443bF1846F00c71EFA41824
RELAYER_PRIVATE_KEY=...
ADMIN_PRIVATE_KEY=...
```

### 4. Run the keeper

The keeper must:

- monitor windows approaching close
- fetch Pyth data at the close timestamp
- call `settle()`
- push payouts where appropriate

## Verification Commands

```bash
# paused state
cast call 0xdbB492353B57698a5443bF1846F00c71EFA41824 "paused()(bool)" --rpc-url $BASE_SEPOLIA_RPC_URL

# role check
cast call 0xdbB492353B57698a5443bF1846F00c71EFA41824 \
  "hasRole(bytes32,address)(bool)" \
  0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775 \
  0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

## Testnet Notes

- Hook address validation is relaxed for testnet convenience.
- Production deployment still needs CREATE2 mining for the Uniswap V4 hook permission bit pattern.
- Admin and treasury are still consolidated for testnet use; mainnet should split these roles.

## Before Mainnet

- separate admin, treasury, and default-admin custody
- move privileged roles behind multisig
- run the full keeper and relayer flow against real settlement windows
- complete audit and operational monitoring

## Related Docs

- `Testing.md`
- `PythIntegration.md`
- `SmartContractArchitecture.md`
