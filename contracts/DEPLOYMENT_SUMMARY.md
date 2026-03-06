# BlocksRide Deployment Summary & User Flow Explanation

**Date:** March 6, 2026
**Network:** Base Sepolia
**Status:** Phase 1 Complete ✅

---

## What We Just Deployed

### PariHook Contract: `0xdbB492353B57698a5443bF1846F00c71EFA41824`

- **Deployment Tx:** `0xa8079b1455964cb032a3f2a4f83719227dcd53bb23f931fcf85397e369ab8b04`
- **Integration Grid Config Tx:** `0xd071e6cf0121cdaffc744ff60291f15d7ba3fc76ac7cc12f67e4eaf1cf368a71`
- **Latest Bet Tx:** `0xd4a9b9db4c8a58c9d92f00607ad8f030d0c5dff21ef5ad76a8a7a088553bbd64`

This is your **prediction market engine**. It's NOT a traditional Uniswap swap pool.

**What it does:**
- Accepts USDC bets from users
- Tracks which price band (cell) each user bet on
- Settles windows using Pyth oracle prices
- Supports winner/refund accounting paths (payout execution is keeper/ops dependent)

**What it does NOT do (yet):**
- Does not involve RIDE token (that's Phase 2)
- Does not allow swapping between tokens
- Does not use traditional liquidity providers

---

## Understanding the System Architecture

### What is the "Pool"?

You're not creating a USDC/ETH swap pool. Instead:

```
┌─────────────────────────────────────────┐
│         UNISWAP V4 POOLMANAGER          │
│   (Infrastructure for custody only)     │
│                                         │
│  Holds: All user USDC bets              │
│  Does NOT: Allow swaps                  │
└─────────────────────────────────────────┘
              │
              ├──> PariHook (your contract)
              │    ├─ Manages betting
              │    ├─ Tracks windows & cells
              │    └─ Settles with Pyth oracle
              │
              └──> Pyth Oracle
                   └─ Provides ETH/USD price
```

### The Pool Key Explained

When you initialize a pool, you create a `PoolKey`:
- **currency0:** Dummy placeholder (not used for betting)
- **currency1:** USDC (what users bet with)
- **hooks:** PariHook address

The pool exists only to leverage Uniswap V4's:
1. Secure custody (PoolManager holds funds)
2. Hook callbacks (`beforeInitialize`)
3. Battle-tested infrastructure

---

## User Flow: Simple Terms

### 1. User Signs In
```
User → Privy (email/Google) → Gets embedded wallet automatically
   OR
User → MetaMask → Connects existing wallet
```

### 2. User Adds USDC
```
User's Wallet → Receives USDC from:
  - Coinbase transfer
  - Bridge from another chain
  - Buy with card (on-ramp)
```

### 3. User Sees the Grid
```
Grid displays:
  - 10 columns (time windows, 1 minute each)
  - Infinite rows (price bands, $2 each)
  - Current ETH price: ~$2,059

Example cells:
  - Cell 1029: $2,058 - $2,060  ← Current price is here!
  - Cell 1030: $2,060 - $2,062
  - Cell 1028: $2,056 - $2,058
```

### 4. User Bets
```
User clicks cell → "I bet ETH will close between $2,058-$2,060"
Amount: $10 USDC
Window: +4 (4 minutes from now)

Transaction happens:
  - USDC locked in PoolManager
  - Bet recorded on-chain
  - Cell shows user's stake
```

### 5. Window Closes
```
Keeper calls settle():
  - Fetches Pyth price at exact window close time
  - Example: ETH closed at $2,059.43
  - Winning cell: 1029 ($2,058 - $2,060) ✅
  - Calculate payouts:
      Total pool: $100
      Fee (2%): $2
      Net pool: $98
      Money on winning cell: $40
      Redemption rate: $98 / $40 = 2.45x
```

### 6. User Gets Paid
```
If user bet on winning cell:
  - Their $10 becomes: $10 × 2.45 = $24.50
  - Profit: $14.50

If user bet on losing cell:
  - Lost their $10 (goes to winners)
```

---

## What About RIDE Token?

### YES, You Need RIDE Token - But Later (Phase 2)

**RIDE is NOT for betting**. RIDE is for:

1. **Rewards** - Users earn RIDE by betting
   - Bet $10 → Earn ~2 RIDE (depends on emission period)
   - Win the bet → Earn 1.5x bonus RIDE

2. **Fee Discounts** - Users stake RIDE to lower fees
   ```
   Stake 0 RIDE     → Pay 2.0% fee
   Stake 1,000 RIDE → Pay 1.5% fee
   Stake 5,000 RIDE → Pay 1.0% fee
   Stake 10,000 RIDE → Pay 0.5% fee
   ```

3. **Later Trading (V2)** - RIDE becomes tradeable
   - V1: RIDE only for stake/unstake (transfer restricted)
   - V2: RIDE/USDC pool for open market trading

### Contracts You Still Need to Deploy (Phase 2):

1. **RIDE.sol** - ERC20 token (100M fixed supply)
2. **RideDistributor.sol** - Emits rewards after settlement
3. **RideStaking.sol** - Stake/unstake with 7-day cooldown

---

## Current Deployment Status

### ✅ Phase 1: Core Betting (COMPLETE)

| Component | Status | Address |
|-----------|--------|---------|
| PariHook | ✅ Deployed | `0xdbB492353B57698a5443bF1846F00c71EFA41824` |
| Grid Configured | ✅ Done | ETH/USD, $2 bands, 60s windows |
| Pyth Oracle | ✅ Integrated | Live prices working |
| Roles Setup | ✅ Done | Admin/Treasury/Relayer assigned |

**Users can now:**
- ✅ Place USDC bets on ETH price
- ✅ Windows settle automatically with Pyth
- ✅ Winners receive USDC payouts
- ✅ All on-chain, non-custodial

**Users CANNOT yet:**
- ❌ Earn RIDE rewards (no RIDE contract)
- ❌ Get fee discounts (no RideStaking)
- ❌ See RIDE balance (token doesn't exist)

### 🔄 Phase 2: RIDE Token System (TODO)

| Component | Status | Priority |
|-----------|--------|----------|
| RIDE.sol | ❌ Not deployed | High |
| RideDistributor.sol | ❌ Not deployed | High |
| RideStaking.sol | ❌ Not deployed | High |
| Hook integration | ❌ Needs update | Medium |

---

## What Happens Next?

### Immediate Testing (Current Phase)

1. **Get Test USDC**
   - Address: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
   - Use Base Sepolia faucet

2. **Test Betting Flow**
   - Initialize pool in PoolManager
   - Place test bets via `placeBet()`
   - Wait for window to close
   - Keeper settles with Pyth data
   - Verify winners get paid

3. **Backend Integration**
   - Update API with PariHook address
   - Setup relayer for gasless bets
   - Configure keeper for settlement

### Phase 2: Deploy RIDE Token

Once betting works smoothly:

1. **Deploy Token Contracts**
   ```bash
   forge script DeployRIDE.s.sol --broadcast
   # Deploys: RIDE, RideDistributor, RideStaking
   ```

2. **Update PariHook**
   - Add RideDistributor address
   - Enable reward emission after settlement
   - Enable fee discount lookup from RideStaking

3. **Test Reward Flow**
   - User bets → Earns RIDE
   - User stakes RIDE → Gets lower fee
   - Verify emission caps

---

## Technical Summary

### What IS the Uniswap V4 Hook?

```solidity
// Traditional Uniswap Pool (NOT what you're doing)
Pool: ETH ↔ USDC
Users: Swap between tokens
LPs: Provide liquidity, earn fees

// Your PariHook (Prediction Market)
Pool: Just infrastructure
Users: Bet USDC on ETH price predictions (via Pyth oracle)
"LPs": None - this is not an AMM
```

### Current Architecture

```
User Wallet (USDC)
       ↓
   placeBet()
       ↓
PariHook Contract
       ↓
PoolManager (custody)
       ↓
settle() ← Pyth Oracle (ETH price)
       ↓
Winners receive USDC
```

### With RIDE Token (Phase 2)

```
User Wallet (USDC)
       ↓
   placeBet()
       ↓
PariHook Contract
       ↓
PoolManager (custody)
       ↓
settle() ← Pyth Oracle
       ↓
Winners receive:
  - USDC payout
  - RIDE rewards (from RideDistributor)
       ↓
User stakes RIDE → Lower fees on next bet
```

---

## Key Takeaways

1. **PariHook is NOT a swap pool** - It's a prediction market using Uniswap V4 infrastructure

2. **Users bet USDC** - Not trading between two tokens

3. **Pyth Oracle provides prices** - Settlement based on external ETH/USD feed

4. **RIDE token is separate** - Deploy later for rewards/fee discounts

5. **V1 is functional now** - Users can bet and win without RIDE

6. **V2 adds RIDE ecosystem** - Rewards, staking, trading

---

## Testing Your Deployment

### Quick Verification Commands

```bash
# Check contract state
cast call 0xdbB492353B57698a5443bF1846F00c71EFA41824 "paused()(bool)" \
  --rpc-url $BASE_SEPOLIA_RPC_URL

# Check current window
cast call 0xdbB492353B57698a5443bF1846F00c71EFA41824 \
  "getCurrentWindow((address,address,uint24,int24,address))(uint256)" \
  [YOUR_POOL_KEY] \
  --rpc-url $BASE_SEPOLIA_RPC_URL

# Check current ETH price from Pyth
cast call 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729 \
  "getPriceUnsafe(bytes32)(int64,uint64,int32,uint256)" \
  0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

---

## Questions Answered

**Q: Do we need a USDC/ETH pool?**
A: No. Users bet USDC on ETH price predictions, not swapping.

**Q: What's the token pair?**
A: There isn't one for V1. V2 adds RIDE/USDC for RIDE trading.

**Q: Why use Uniswap V4?**
A: For custody infrastructure and battle-tested fund management.

**Q: Can users swap?**
A: No. `beforeSwap` is not implemented - swaps revert.

**Q: When do we deploy RIDE?**
A: After core betting is tested and working smoothly.

---

## Next Steps Checklist

- [ ] Initialize pool in PoolManager
- [ ] Test bet placement with real USDC
- [ ] Test window settlement
- [ ] Test winner payouts
- [ ] Setup backend relayer
- [ ] Setup keeper service
- [ ] Test frontend integration
- [ ] Deploy RIDE token system (Phase 2)
- [ ] Test reward emission
- [ ] Test fee discount staking
- [ ] Mainnet audit preparation

---

## Resources

- **Deployed Contract:** https://sepolia.basescan.org/address/0xdbB492353B57698a5443bF1846F00c71EFA41824
- **Test Results:** `TEST_RESULTS.md`
- **Environment Config:** `.env`
- **Architecture Docs:** `blocksride-docs/architecture.md`
- **Tokenomics:** `blocksride-docs/tokenomics.md`
- **User Flow:** `blocksride-docs/userflow.md`
