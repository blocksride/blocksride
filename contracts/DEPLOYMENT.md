# PariHook Deployment - Base Sepolia

**Deployment Date:** March 2, 2026
**Network:** Base Sepolia (Chain ID: 84532)
**Status:** ✅ Successfully Deployed

---

## Deployed Contract Address

**PariHook:** `0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7`

🔗 **View on BaseScan:** https://sepolia.basescan.org/address/0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7

---

## Deployment Configuration

### Network Infrastructure

| Component | Address |
|-----------|---------|
| PoolManager (Uniswap V4) | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| Pyth Oracle | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |
| USDC Token | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

### Role Assignments

| Role | Address | Purpose |
|------|---------|---------|
| DEFAULT_ADMIN_ROLE | `0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f` | Super admin - can grant/revoke roles |
| ADMIN_ROLE | `0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f` | Protocol parameters (pause, setFee, etc.) |
| TREASURY_ROLE | `0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f` | Fund management (withdrawFees, pushPayouts) |
| RELAYER_ROLE | `0xF41886af501e2a0958dBD31D9a28AcD6c2f5db06` | Gasless transaction submission |

### Contract State

| Parameter | Value |
|-----------|-------|
| DOMAIN_SEPARATOR | `0xa29a4fc8723aa822b9ed6678a61d3b12af2c91e21e276ce6fd9d687887ef6ffd` |
| Paused | `false` |
| Gas Used | 5,378,617 |
| Deployment Cost | 0.000032271702 ETH |

---

## Next Steps

### 1. Configure a Grid for ETH/USD Prediction Market

Before users can place bets, you need to configure a grid using the `configureGrid()` function.

**Example Configuration:**

```solidity
configureGrid(
    poolKey,                    // Pool key (will be created after PoolManager.initialize)
    0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace, // ETH/USD Pyth feed ID
    2000000,                    // bandWidth: $2.00 (in USDC 6-decimals)
    60,                         // windowDuration: 60 seconds
    3,                          // frozenWindows: 3 (180s freeze)
    100000000000,               // maxStakePerCell: $100,000
    200,                        // feeBps: 2% (200 basis points)
    1000000,                    // minPoolThreshold: $1.00
    [FUTURE_TIMESTAMP],         // gridEpoch: aligned to clean boundary
    0x036CbD53842c5426634e7929541eC2318f3dCF7e  // USDC address
)
```

**Important:** `gridEpoch` must be a future Unix timestamp aligned to a clean boundary (e.g., next midnight UTC, next hour). This anchors all window calculations.

### 2. Initialize Pool in Uniswap V4 PoolManager

After configuring the grid, initialize the pool:

```solidity
poolManager.initialize(poolKey, sqrtPriceX96)
```

This will trigger the `beforeInitialize` hook callback in PariHook.

### 3. Backend Integration

Update your backend configuration with the deployed contract address:

**Backend `.env` updates:**
```bash
PARIHOOK_CONTRACT_ADDRESS=0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7
RELAYER_PRIVATE_KEY=[private key for 0xF41886af501e2a0958dBD31D9a28AcD6c2f5db06]
ADMIN_PRIVATE_KEY=[private key for 0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f]
```

### 4. Keeper Service Setup

Configure the keeper service to:
- Monitor windows approaching settlement time
- Fetch Pyth VAA data from Hermes API at `windowEnd` timestamp
- Call `settle(poolKey, windowId, pythVAA)` after window ends
- Push payouts to winners using `pushPayouts()`

### 5. Frontend Integration

Update frontend contract address:

```typescript
// client/src/config/contracts.ts
export const PARIHOOK_ADDRESS = '0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7'
```

---

## Verification Commands

### Verify Contract on BaseScan

```bash
forge verify-contract \
  0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7 \
  src/PariHook.sol:PariHook \
  --chain-id 84532 \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address)" \
    0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
    0xA2aa501b19aff244D90cc15a4Cf739D2725B5729 \
    0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f \
    0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f \
    0xF41886af501e2a0958dBD31D9a28AcD6c2f5db06) \
  --etherscan-api-key $BASESCAN_API_KEY
```

### Check Contract State

```bash
# Check if paused
cast call 0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7 "paused()(bool)" --rpc-url $BASE_SEPOLIA_RPC_URL

# Check role assignments
cast call 0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7 \
  "hasRole(bytes32,address)(bool)" \
  0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775 \
  0x536975e9E6af75045c1a03cCf1CD8B9590E2cB7f \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

---

## Price Feed IDs (Pyth Oracle)

For additional prediction markets:

| Asset Pair | Pyth Feed ID |
|------------|-------------|
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |

---

## Transaction Details

**Deployment Transaction:** Check broadcast folder for full details
- **Location:** `broadcast/DeployPariHook.s.sol/84532/run-latest.json`
- **Gas Used:** 5,378,617
- **Gas Price:** 0.006 gwei
- **Total Cost:** 0.000032271702 ETH

---

## Security Considerations

### For Testnet:
- ✅ All roles currently assigned to deployer address for testing
- ✅ RELAYER_ROLE assigned to separate backend address
- ✅ Contract not paused
- ⚠️ Remember: This is testnet - funds have no real value

### Before Mainnet:
1. **Separate role keys:** Use different addresses for ADMIN, TREASURY, and DEFAULT_ADMIN
2. **Cold storage:** Move DEFAULT_ADMIN_ROLE to hardware wallet
3. **Multisig:** Consider using Gnosis Safe for ADMIN_ROLE and TREASURY_ROLE
4. **Audit:** Complete security audit before mainnet deployment
5. **Testing:** Extensive testing on testnet with real user flows

---

## Support Resources

- **Uniswap V4 Docs:** https://docs.uniswap.org/contracts/v4/overview
- **Pyth Network Docs:** https://docs.pyth.network/
- **Base Docs:** https://docs.base.org/
- **Contract Source:** `/home/robinsoncodes/Downloads/eth-ride(1)/eth-ride/blocksride/contracts/src/PariHook.sol`

---

## Changelog

- **2026-03-02:** Initial deployment to Base Sepolia
  - Contract: `0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7`
  - Roles configured
  - Ready for grid configuration
