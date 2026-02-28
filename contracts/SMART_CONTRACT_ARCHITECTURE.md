# BlocksRide Smart Contract Architecture

**Version:** 2.0
**Last Updated:** 2026-02-28
**Owner:** Allan Robinson
**Status:** Implementation Ready

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Core Contracts](#3-core-contracts)
4. [Data Structures](#4-data-structures)
5. [Public Function Interfaces](#5-public-function-interfaces)
6. [Settlement Logic & Math](#6-settlement-logic--math)
7. [Cell ID System (Absolute Grid)](#7-cell-id-system-absolute-grid)
8. [Access Control & Roles](#8-access-control--roles)
9. [Token Flows via PoolManager](#9-token-flows-via-poolmanager)
10. [Events & Audit Trail](#10-events--audit-trail)
11. [Security Considerations](#11-security-considerations)
12. [Implementation Priorities](#12-implementation-priorities)
13. [Testing Requirements](#13-testing-requirements)
14. [Deployment Specifications](#14-deployment-specifications)
15. [Key Invariants](#15-key-invariants)

---

## 1. Executive Summary

BlocksRide is a **fully on-chain parimutuel prediction market** built as a Uniswap V4 Hook on Base Mainnet. Users bet USDC on where ETH/USD will close within specific 1-minute price bands ($2 wide). All funds are held by the Uniswap V4 PoolManager, not the hook contract.

**Key Innovations:**
- **Absolute Cell IDs**: No anchored grid, no drift, infinite vertical scroll
- **3-Window Freeze**: 180-second minimum bet horizon prevents sniping
- **Permissionless Settlement**: Any address can call `settle()` with Pyth oracle data
- **Dual Payout Paths**: Keeper push (default) + user pull (fallback)
- **Cell Seeding**: Keeper places dust bets to prevent rollover scenarios

**Primary References:**
- `blocksride-docs/architecture.md` — Complete technical specification
- `blocksride-docs/adr.md` — ADR-001 through ADR-015 (all architectural decisions)
- `blocksride-docs/prd.md` — Product requirements and user flows
- `blocksride-docs/TASK_DIVISION.md` — Build order and ownership

---

## 2. System Architecture

### 2.1 Component Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    USERS (MetaMask/Privy)                    │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
    placeBet()                      claimAll()
         │                               │
         ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      PariHook.sol                            │
│  (Single deployment, multi-pool support)                    │
│                                                              │
│  • GridConfig per PoolId                                    │
│  • Window state per (PoolId, windowId)                      │
│  • Cell stakes mapping                                      │
│  • User stakes mapping                                      │
│  • Access control (ADMIN/TREASURY/RELAYER roles)           │
└────────┬────────────────────────┬───────────────────────────┘
         │                        │
         │ USDC custody           │ Fee discount lookup
         ▼                        ▼
┌──────────────────┐      ┌──────────────────┐
│  PoolManager     │      │  RideStaking.sol │
│  (Uniswap V4)    │      │  Fee tiers       │
│  Holds all USDC  │      └────────┬─────────┘
└──────────────────┘               │
                                   │ stake/unstake
                                   ▼
                          ┌──────────────────┐
                          │    RIDE.sol      │
                          │  ERC20 + permit  │
                          └────────┬─────────┘
                                   │
                                   │ rewards
                                   ▼
                          ┌──────────────────┐
                          │ RideDistributor  │
                          │  Emissions       │
                          └──────────────────┘

External Services:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Pyth Oracle  │     │   Keeper     │     │   Relayer    │
│ Price feeds  │────▶│ settle() call│     │ placeBetSig()│
└──────────────┘     └──────────────┘     └──────────────┘
```

### 2.2 Contract Responsibilities

| Contract | Primary Role | State Stored |
|----------|--------------|--------------|
| **PariHook.sol** | Bet logic, settlement, payouts | GridConfig, Window state, stakes |
| **RIDE.sol** | Reward token | ERC20 balances, permits |
| **RideStaking.sol** | Fee discount tiers | Staked amounts, cooldowns |
| **RideDistributor.sol** | Reward emissions | Period caps, airdrop merkle |
| **PoolManager** | USDC custody | ERC20 balances (V4 core) |

---

## 3. Core Contracts

### 3.1 PariHook.sol (Priority P0)

**File:** `contracts/src/PariHook.sol`

**Inherits:**
- `BaseHook` (Uniswap V4)
- `AccessControl` (OpenZeppelin)
- `ReentrancyGuard` (OpenZeppelin)
- `Pausable` (OpenZeppelin)

**Hook Permissions:**
```solidity
function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
    return Hooks.Permissions({
        beforeInitialize: true,        // Store GridConfig
        afterInitialize: false,
        beforeAddLiquidity: true,      // Block (not an AMM)
        afterAddLiquidity: false,
        beforeRemoveLiquidity: true,   // Block (not an AMM)
        afterRemoveLiquidity: false,
        beforeSwap: false,             // Not used for MVP (direct placeBet)
        afterSwap: false,
        beforeDonate: false,
        afterDonate: false,
        beforeSwapReturnDelta: false,
        afterSwapReturnDelta: false,
        afterAddLiquidityReturnDelta: false,
        afterRemoveLiquidityReturnDelta: false
    });
}
```

**State Variables:**
```solidity
// Grid configurations (immutable per pool)
mapping(PoolId => GridConfig) public gridConfigs;

// Window state
mapping(PoolId => mapping(uint256 => Window)) public windows;

// Backstop tracking
mapping(PoolId => mapping(uint256 => address)) public backstopDepositor;

// Payout tracking (double-spend prevention)
mapping(PoolId => mapping(uint256 => mapping(address => bool))) public payoutPushed;

// Nonces for gasless transactions
mapping(address => uint256) public betNonces;
mapping(address => uint256) public claimNonces;

// Fee accumulation
mapping(PoolId => uint256) public accumulatedFees;

// Pyth oracle
IPyth public immutable pyth;

// Role identifiers
bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
```

### 3.2 RIDE.sol (Priority P1)

**File:** `contracts/src/RIDE.sol`

**Inherits:** `ERC20`, `EIP2612` (permit), `Ownable`

**Key Features:**
- Fixed supply: 100,000,000 RIDE
- Minted entirely to `RideDistributor` at deployment
- V1 transfer restrictions: only stake/unstake/claim paths allowed
- V2 (future): unrestricted transfers when trading opens

**Transfer Restrictions (V1):**
```solidity
mapping(address => bool) public isTransferWhitelisted;

function _beforeTokenTransfer(
    address from,
    address to,
    uint256 amount
) internal override {
    // Whitelist: RideStaking, RideDistributor, zero address (mint/burn)
    require(
        from == address(0) ||
        to == address(0) ||
        isTransferWhitelisted[from] ||
        isTransferWhitelisted[to],
        "RIDE: transfers restricted in V1"
    );
    super._beforeTokenTransfer(from, to, amount);
}
```

### 3.3 RideStaking.sol (Priority P2)

**File:** `contracts/src/RideStaking.sol`

**Purpose:** Users stake RIDE to unlock fee discounts (2% → 0.5%)

**Core Functions:**
```solidity
function stake(uint256 amount) external;
function initiateUnstake(uint256 amount) external;
function completeUnstake() external; // 7-day cooldown

function getUserFeeBps(address user) external view returns (uint256);
```

**Fee Tiers:**
```solidity
function getUserFeeBps(address user) public view returns (uint256) {
    uint256 staked = stakedBalance[user];
    if (staked >= 10_000e18) return 50;   // 0.5%
    if (staked >= 5_000e18)  return 100;  // 1.0%
    if (staked >= 1_000e18)  return 150;  // 1.5%
    return 200;                           // 2.0% (default)
}
```

### 3.4 RideDistributor.sol (Priority P2)

**File:** `contracts/src/RideDistributor.sol`

**Purpose:** Controls RIDE reward emissions and airdrop claims

**Key Storage:**
```solidity
struct EmissionPeriod {
    uint256 startTime;
    uint256 endTime;
    uint256 totalAllocation;
    uint256 emitted;
}

mapping(uint256 => EmissionPeriod) public periods;
bytes32 public airdropMerkleRoot;
mapping(address => bool) public hasClaimedAirdrop;
```

**Core Functions:**
```solidity
function claimBetRewards(PoolId poolId, uint256[] calldata windowIds) external;
function claimAirdrop(bytes32[] calldata merkleProof, uint256 amount) external;
```

---

## 4. Data Structures

### 4.1 GridConfig (Immutable Per Pool)

```solidity
struct GridConfig {
    bytes32 pythPriceFeedId;      // Pyth feed ID (e.g., ETH/USD)
    uint256 bandWidth;            // Price band in USDC 6-decimal (e.g., 2_000_000 = $2)
    uint256 windowDuration;       // Seconds per window (60 for 1-minute)
    uint256 frozenWindows;        // Freeze count (3 = 180s freeze)
    uint256 maxStakePerCell;      // Per-cell USDC cap
    uint256 feeBps;               // Platform fee basis points (200 = 2%)
    uint256 gridEpoch;            // Unix timestamp for window 0 start
    uint256 minPoolThreshold;     // Void threshold (0 = disabled)
}
```

**Immutability:** All fields are set once at pool initialization and cannot be changed. To change parameters, deploy a new pool with new PoolKey.

### 4.2 Window State

```solidity
struct Window {
    uint256 totalPool;                                          // Total USDC staked
    uint256 backstopPool;                                       // Protocol-added USDC
    mapping(uint256 => uint256) cellStakes;                     // cellId → stake
    mapping(uint256 => mapping(address => uint256)) userStakes; // cellId → user → stake
    bool settled;                                               // Settlement complete
    bool voided;                                                // Oracle/threshold failure
    uint256 winningCell;                                        // Absolute cellId (or SENTINEL)
    uint256 redemptionRate;                                     // netPool / winStakes (1e18 scale)
}
```

**SENTINEL Value:** `type(uint256).max` indicates "not yet settled" or "rolled over" (no winner).

### 4.3 EIP-712 Typed Data

**BetIntent (for placeBetWithSig):**
```solidity
struct BetIntent {
    PoolId poolId;
    uint256 cellId;
    uint256 windowId;
    uint256 amount;
    address bettor;
    uint256 nonce;
    uint256 deadline;
}

bytes32 public constant BET_INTENT_TYPEHASH = keccak256(
    "BetIntent(bytes32 poolId,uint256 cellId,uint256 windowId,uint256 amount,address bettor,uint256 nonce,uint256 deadline)"
);
```

**ClaimIntent (for claimAllFor):**
```solidity
struct ClaimIntent {
    PoolId poolId;
    address user;
    uint256[] windowIds;
    uint256 nonce;
    uint256 deadline;
}

bytes32 public constant CLAIM_INTENT_TYPEHASH = keccak256(
    "ClaimIntent(bytes32 poolId,address user,uint256[] windowIds,uint256 nonce,uint256 deadline)"
);
```

---

## 5. Public Function Interfaces

### 5.1 Hook Callbacks

**beforeInitialize** (ADMIN_ROLE only)
```solidity
function beforeInitialize(
    address sender,
    PoolKey calldata key,
    uint160 sqrtPriceX96
) external override onlyPoolManager onlyRole(ADMIN_ROLE) returns (bytes4) {
    PoolId poolId = key.toId();

    // Decode GridConfig from hookData passed during initialize
    GridConfig memory config = abi.decode(hookData, (GridConfig));

    // Store immutable config
    gridConfigs[poolId] = config;

    emit PoolInitialized(poolId, config);
    return this.beforeInitialize.selector;
}
```

**beforeAddLiquidity / beforeRemoveLiquidity** (Block all liquidity ops)
```solidity
function beforeAddLiquidity(...) external pure override returns (bytes4) {
    revert("PariHook: not an AMM pool");
}

function beforeRemoveLiquidity(...) external pure override returns (bytes4) {
    revert("PariHook: not an AMM pool");
}
```

### 5.2 Bet Placement

**placeBet** (Public, MetaMask users)
```solidity
function placeBet(
    PoolKey calldata key,
    uint256 cellId,
    uint256 windowId,
    uint256 amount
) external nonReentrant whenNotPaused {
    PoolId poolId = key.toId();
    _validateBet(poolId, windowId, cellId, amount);

    // Execute via PoolManager.unlock callback
    poolManager.unlock(abi.encode(
        CallbackType.PLACE_BET,
        abi.encode(poolId, windowId, cellId, msg.sender, amount)
    ));

    emit BetPlaced(poolId, windowId, cellId, msg.sender, amount);
}
```

**placeBetWithSig** (Gasless, RELAYER_ROLE)
```solidity
function placeBetWithSig(
    PoolKey calldata key,
    uint256 cellId,
    uint256 windowId,
    uint256 amount,
    address bettor,
    uint256 nonce,
    uint256 deadline,
    bytes calldata signature
) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
    require(block.timestamp <= deadline, "Signature expired");
    require(nonce == betNonces[bettor], "Invalid nonce");

    // Verify EIP-712 signature
    bytes32 structHash = keccak256(abi.encode(
        BET_INTENT_TYPEHASH,
        key.toId(),
        cellId,
        windowId,
        amount,
        bettor,
        nonce,
        deadline
    ));
    bytes32 digest = _hashTypedDataV4(structHash);
    address signer = ECDSA.recover(digest, signature);
    require(signer == bettor, "Invalid signature");

    betNonces[bettor]++;

    _validateBet(key.toId(), windowId, cellId, amount);

    poolManager.unlock(abi.encode(
        CallbackType.PLACE_BET,
        abi.encode(key.toId(), windowId, cellId, bettor, amount)
    ));

    emit BetPlaced(key.toId(), windowId, cellId, bettor, amount);
}
```

**permitAndPlaceBet** (MetaMask fallback)
```solidity
function permitAndPlaceBet(
    PoolKey calldata key,
    uint256 cellId,
    uint256 windowId,
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
) external nonReentrant whenNotPaused {
    // Execute permit if allowance insufficient
    IERC20Permit usdc = IERC20Permit(Currency.unwrap(key.currency0));
    if (usdc.allowance(msg.sender, address(this)) < amount) {
        usdc.permit(msg.sender, address(this), type(uint256).max, deadline, v, r, s);
    }

    placeBet(key, cellId, windowId, amount);
}
```

### 5.3 Settlement

**settle** (Permissionless)
```solidity
function settle(
    PoolKey calldata key,
    uint256 windowId,
    bytes calldata pythUpdateData
) external nonReentrant {
    PoolId poolId = key.toId();
    GridConfig storage cfg = gridConfigs[poolId];
    Window storage w = windows[poolId][windowId];

    require(!w.settled, "Already settled");

    // Validate timing (2-second buffer for Base sequencer drift)
    uint256 windowEnd = (windowId + 1) * cfg.windowDuration + cfg.gridEpoch;
    require(block.timestamp >= windowEnd - 2, "Window not ended");

    // Parse Pyth price with time verification
    uint256 closingPrice = _parsePythPrice(
        pythUpdateData,
        cfg.pythPriceFeedId,
        windowEnd
    );

    // Check minimum pool threshold (void if below)
    uint256 organicPool = w.totalPool - w.backstopPool;
    if (organicPool < cfg.minPoolThreshold) {
        w.settled = true;
        w.voided = true;
        w.winningCell = type(uint256).max;
        emit WindowVoided(poolId, windowId, w.totalPool);
        return;
    }

    // Calculate winning cell (absolute formula)
    uint256 winningCell = closingPrice / cfg.bandWidth;
    uint256 winStakes = w.cellStakes[winningCell];

    // Handle rollover (no bets on winning cell)
    if (winStakes == 0) {
        _rollover(poolId, windowId, windowId + 1);
        return;
    }

    // Calculate redemption rate
    uint256 fee = (organicPool * cfg.feeBps) / 10000;
    uint256 netPool = (w.totalPool + w.backstopPool) - fee;
    w.redemptionRate = (netPool * 1e18) / winStakes;
    w.winningCell = winningCell;
    w.settled = true;

    accumulatedFees[poolId] += fee;

    emit WindowSettled(poolId, windowId, winningCell, closingPrice, w.redemptionRate);
    emit FeeCollected(poolId, windowId, fee);
}
```

### 5.4 Payouts

**pushPayouts** (TREASURY_ROLE, keeper-triggered)
```solidity
function pushPayouts(
    PoolKey calldata key,
    uint256 windowId,
    address[] calldata winners
) external onlyRole(TREASURY_ROLE) nonReentrant {
    PoolId poolId = key.toId();
    Window storage w = windows[poolId][windowId];

    require(w.settled && !w.voided, "Not settled or voided");

    uint256 totalPaid = 0;
    for (uint256 i = 0; i < winners.length; i++) {
        address winner = winners[i];

        if (payoutPushed[poolId][windowId][winner]) continue;

        uint256 stake = w.userStakes[w.winningCell][winner];
        if (stake == 0) continue;

        uint256 payout = (stake * w.redemptionRate) / 1e18;
        payoutPushed[poolId][windowId][winner] = true;
        totalPaid += payout;

        // Transfer via PoolManager.take
        poolManager.unlock(abi.encode(
            CallbackType.PAYOUT,
            abi.encode(key.currency0, winner, payout)
        ));

        emit PayoutPushed(poolId, windowId, winner, payout);
    }
}
```

**claimAll** (Public pull)
```solidity
function claimAll(
    PoolKey calldata key,
    uint256[] calldata windowIds
) external nonReentrant {
    _claimAllInternal(key, windowIds, msg.sender);
}
```

**claimAllFor** (Gasless, RELAYER_ROLE)
```solidity
function claimAllFor(
    PoolKey calldata key,
    address user,
    uint256[] calldata windowIds,
    uint256 nonce,
    uint256 deadline,
    bytes calldata signature
) external onlyRole(RELAYER_ROLE) nonReentrant {
    require(block.timestamp <= deadline, "Signature expired");
    require(nonce == claimNonces[user], "Invalid nonce");

    // Verify EIP-712 signature
    bytes32 structHash = keccak256(abi.encode(
        CLAIM_INTENT_TYPEHASH,
        key.toId(),
        user,
        keccak256(abi.encodePacked(windowIds)),
        nonce,
        deadline
    ));
    bytes32 digest = _hashTypedDataV4(structHash);
    address signer = ECDSA.recover(digest, signature);
    require(signer == user, "Invalid signature");

    claimNonces[user]++;

    _claimAllInternal(key, windowIds, user);
}
```

**claimRefund** (Void windows only)
```solidity
function claimRefund(
    PoolKey calldata key,
    uint256 windowId
) external nonReentrant {
    PoolId poolId = key.toId();
    Window storage w = windows[poolId][windowId];

    require(w.voided, "Window not voided");
    require(!payoutPushed[poolId][windowId][msg.sender], "Already claimed");

    // Sum stakes across all cells user bet on
    uint256 totalRefund = 0;
    // Note: Need to track cellIds per user or iterate (gas consideration)
    // Implementation detail: use event logs or separate mapping

    require(totalRefund > 0, "Nothing to refund");
    payoutPushed[poolId][windowId][msg.sender] = true;

    poolManager.unlock(abi.encode(
        CallbackType.REFUND,
        abi.encode(key.currency0, msg.sender, totalRefund)
    ));

    emit RefundClaimed(poolId, windowId, msg.sender, totalRefund);
}
```

### 5.5 Administrative Functions

**depositBackstop** (TREASURY_ROLE)
```solidity
function depositBackstop(
    PoolKey calldata key,
    uint256 windowId,
    uint256 amount
) external onlyRole(TREASURY_ROLE) {
    PoolId poolId = key.toId();
    Window storage w = windows[poolId][windowId];

    require(!w.settled, "Already settled");

    w.backstopPool += amount;
    w.totalPool += amount;
    backstopDepositor[poolId][windowId] = msg.sender;

    poolManager.unlock(abi.encode(
        CallbackType.DEPOSIT_BACKSTOP,
        abi.encode(key.currency0, msg.sender, amount)
    ));

    emit BackstopDeposited(poolId, windowId, amount);
}
```

**withdrawFees** (TREASURY_ROLE)
```solidity
function withdrawFees(
    PoolKey calldata key,
    address recipient,
    uint256 amount
) external onlyRole(TREASURY_ROLE) {
    PoolId poolId = key.toId();
    require(amount <= accumulatedFees[poolId], "Insufficient fees");

    accumulatedFees[poolId] -= amount;

    poolManager.unlock(abi.encode(
        CallbackType.WITHDRAW_FEES,
        abi.encode(key.currency0, recipient, amount)
    ));

    emit FeesWithdrawn(poolId, recipient, amount);
}
```

**pause / unpause** (ADMIN_ROLE)
```solidity
function pause() external onlyRole(ADMIN_ROLE) {
    _pause();
}

function unpause() external onlyRole(ADMIN_ROLE) {
    _unpause();
}
```

### 5.6 View Functions

**currentWindowId**
```solidity
function currentWindowId(PoolId poolId) public view returns (uint256) {
    GridConfig storage cfg = gridConfigs[poolId];
    return (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
}
```

**hasPendingClaim**
```solidity
function hasPendingClaim(
    PoolId poolId,
    uint256 windowId,
    address user
) external view returns (bool) {
    Window storage w = windows[poolId][windowId];
    return
        w.settled &&
        !w.voided &&
        w.userStakes[w.winningCell][user] > 0 &&
        !payoutPushed[poolId][windowId][user];
}
```

**getUserFeeBps** (Delegates to RideStaking)
```solidity
function getUserFeeBps(address user) external view returns (uint256) {
    return rideStaking.getUserFeeBps(user);
}
```

---

## 6. Settlement Logic & Math

### 6.1 Window ID Derivation

```solidity
windowId = floor((block.timestamp - gridEpoch) / windowDuration)

windowStart = gridEpoch + (windowId × windowDuration)
windowEnd = windowStart + windowDuration
```

All windows are deterministic and globally consistent.

### 6.2 Betting Window Validation

```solidity
uint256 current = currentWindowId(poolId);
uint256 freezeEnd = current + cfg.frozenWindows;
uint256 bettingStart = freezeEnd + 1;
uint256 bettingEnd = freezeEnd + 3;

require(
    windowId >= bettingStart && windowId <= bettingEnd,
    "Window not in betting zone"
);
```

**Example (frozenWindows = 3, current = 100):**
- Windows 101, 102, 103: FROZEN (not bettable)
- Windows 104, 105, 106: OPEN (bettable)
- Windows 107+: FUTURE (not yet bettable)

### 6.3 Settlement Math

**Winning Cell Calculation:**
```solidity
uint256 winningCell = closingPrice / bandWidth;  // Integer division
```

**Redemption Rate Calculation:**
```solidity
uint256 organicPool = w.totalPool - w.backstopPool;
uint256 fee = (organicPool × cfg.feeBps) / 10000;
uint256 netPool = (w.totalPool + w.backstopPool) - fee;
uint256 redemptionRate = (netPool × 1e18) / cellStakes[winningCell];
```

**Individual Payout:**
```solidity
uint256 payout = (userStakes[winningCell][user] × redemptionRate) / 1e18;
```

**Example:**
```
Setup:
  totalPool = $100 (organic: $100, backstop: $0)
  bandWidth = $2.00
  feeBps = 200 (2%)
  closingPrice = $3,001.20

Calculation:
  winningCell = floor(3001.20 / 2) = 1500
  cellStakes[1500] = $40 (Alice: $10, Bob: $30)

  fee = $100 × 200 / 10000 = $2.00
  netPool = $100 - $2 = $98
  redemptionRate = $98 × 1e18 / $40 = 2.45e18

  Alice payout = $10 × 2.45e18 / 1e18 = $24.50
  Bob payout = $30 × 2.45e18 / 1e18 = $73.50
  Total = $98.00 ✓
```

### 6.4 Rollover Logic

```solidity
if (cellStakes[winningCell] == 0) {
    uint256 nextWindowId = windowId + 1;
    windows[poolId][nextWindowId].totalPool += w.totalPool;
    windows[poolId][nextWindowId].backstopPool += w.backstopPool;

    w.winningCell = type(uint256).max; // SENTINEL
    w.settled = true;

    emit WindowRolledOver(poolId, windowId, nextWindowId, w.totalPool);
}
```

### 6.5 Void Logic

```solidity
uint256 organicPool = w.totalPool - w.backstopPool;
if (organicPool < cfg.minPoolThreshold) {
    w.settled = true;
    w.voided = true;
    w.winningCell = type(uint256).max;
    emit WindowVoided(poolId, windowId, w.totalPool);
}
```

---

## 7. Cell ID System (Absolute Grid)

### 7.1 Core Formula (ADR-013)

```
Price → cellId:   cellId = floor(price / bandWidth)
cellId → range:   pLow = cellId × bandWidth
                  pHigh = pLow + bandWidth
```

**Key Properties:**
- **No anchor price** — formula is absolute, not relative
- **No drift** — same price always maps to same cellId
- **Infinite grid** — any price has a valid cellId
- **No pre-creation** — cells computed on-demand

### 7.2 Examples (bandWidth = $2.00 = 2,000,000)

| Price (USDC 6-dec) | cellId | Range |
|-------------------|--------|-------|
| 2,998,000,000 | 1499 | $2,998.00 – $3,000.00 |
| 3,000,000,000 | 1500 | $3,000.00 – $3,002.00 |
| 3,001,200,000 | 1500 | $3,000.00 – $3,002.00 |
| 3,002,000,000 | 1501 | $3,002.00 – $3,004.00 |

### 7.3 Pyth Price Normalization

```solidity
function _parsePythPrice(
    bytes calldata pythUpdateData,
    bytes32 priceFeedId,
    uint256 timestamp
) internal returns (uint256) {
    bytes32[] memory priceIds = new bytes32[](1);
    priceIds[0] = priceFeedId;

    PythStructs.PriceFeed[] memory feeds = pyth.parsePriceFeedUpdatesUnique{
        value: pyth.getUpdateFee(pythUpdateData)
    }(
        pythUpdateData,
        priceIds,
        uint64(timestamp),           // minPublishTime
        uint64(timestamp + 10)       // maxPublishTime (10s grace)
    );

    // Normalize to USDC 6-decimal
    int64 price = feeds[0].price.price;
    int32 expo = feeds[0].price.expo;

    // Convert to 6-decimal base
    if (expo >= -6) {
        return uint256(int256(price)) * (10 ** uint32(expo + 6));
    } else {
        return uint256(int256(price)) / (10 ** uint32(-expo - 6));
    }
}
```

### 7.4 Cell Seeding (Rollover Prevention)

**Problem:** Sparse betting → closing price lands on unstaked cell → rollover

**Solution:** Keeper seeds ±$20 range (21 cells × $0.01 = $0.21 per window)

**Implementation:**
```typescript
// Keeper script (TypeScript)
const currentPrice = await fetchPythPrice();
const centerCellId = Math.floor(currentPrice / BAND_WIDTH);

for (let offset = -10; offset <= 10; offset++) {
    const cellId = centerCellId + offset;
    await pariHook.placeBet(poolKey, cellId, windowId, 0.01e6);
}
```

**Coverage:** ±$20 at $2 bands = 97.5th percentile of 4-minute ETH volatility

---

## 8. Access Control & Roles

### 8.1 Role Definitions

**DEFAULT_ADMIN_ROLE** (Cold wallet, hardware)
- Can: Grant/revoke all roles
- Cannot: Move funds, change parameters, pause
- Use: Emergency role recovery only

**ADMIN_ROLE** (Hot wallet)
- Can: `pause()`, `unpause()`
- Cannot: Move funds, grant roles
- Use: Emergency circuit breaker

**TREASURY_ROLE** (Multisig recommended)
- Can: `depositBackstop()`, `withdrawFees()`, `pushPayouts()`
- Cannot: Change parameters, grant roles, pause
- Use: Fund management

**RELAYER_ROLE** (Hot wallet, API service)
- Can: `placeBetWithSig()`, `claimAllFor()`
- Cannot: Anything else
- Use: Gasless transaction relay

### 8.2 Security Model

| Threat | Mitigation |
|--------|-----------|
| Admin rug | ADMIN cannot move funds (only pause) |
| Treasury rug | Multisig + Timelock (optional) |
| Relayer compromise | Limited to bet/claim relay (cannot withdraw) |
| Role escalation | DEFAULT_ADMIN offline (cold storage) |

---

## 9. Token Flows via PoolManager

### 9.1 Bet In (USDC → PoolManager)

```solidity
function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
    (CallbackType cType, bytes memory cData) = abi.decode(data, (CallbackType, bytes));

    if (cType == CallbackType.PLACE_BET) {
        (PoolId poolId, uint256 windowId, uint256 cellId, address user, uint256 amount) =
            abi.decode(cData, (PoolId, uint256, uint256, address, uint256));

        // Transfer USDC from user to PoolManager
        Currency usdc = gridConfigs[poolId].currency0;
        IERC20(Currency.unwrap(usdc)).transferFrom(user, address(poolManager), amount);

        // Settle the delta with PoolManager
        poolManager.settle(usdc, amount);

        // Update window state
        windows[poolId][windowId].totalPool += amount;
        windows[poolId][windowId].cellStakes[cellId] += amount;
        windows[poolId][windowId].userStakes[cellId][user] += amount;
    }

    return "";
}
```

### 9.2 Payout (PoolManager → User)

```solidity
if (cType == CallbackType.PAYOUT) {
    (Currency usdc, address recipient, uint256 amount) =
        abi.decode(cData, (Currency, address, uint256));

    // Take USDC from PoolManager and send to recipient
    poolManager.take(usdc, recipient, amount);

    // No settle needed — PoolManager debits its balance directly
}
```

**Key Insight:** Hook never holds USDC. All custody in PoolManager (battle-tested V4 core).

---

## 10. Events & Audit Trail

### 10.1 Complete Event Set

```solidity
event PoolInitialized(PoolId indexed poolId, GridConfig config);

event BetPlaced(
    PoolId indexed poolId,
    uint256 indexed windowId,
    uint256 indexed cellId,
    address bettor,
    uint256 amount
);

event WindowSettled(
    PoolId indexed poolId,
    uint256 indexed windowId,
    uint256 winningCell,
    uint256 closingPrice,
    uint256 redemptionRate
);

event WindowRolledOver(
    PoolId indexed poolId,
    uint256 indexed fromWindowId,
    uint256 indexed toWindowId,
    uint256 carryAmount
);

event WindowVoided(
    PoolId indexed poolId,
    uint256 indexed windowId,
    uint256 totalRefundable
);

event PayoutPushed(
    PoolId indexed poolId,
    uint256 indexed windowId,
    address indexed winner,
    uint256 amount
);

event PayoutClaimed(
    PoolId indexed poolId,
    uint256 indexed windowId,
    address indexed claimer,
    uint256 amount
);

event RefundClaimed(
    PoolId indexed poolId,
    uint256 indexed windowId,
    address indexed claimer,
    uint256 amount
);

event FeeCollected(
    PoolId indexed poolId,
    uint256 indexed windowId,
    uint256 amount
);

event BackstopDeposited(
    PoolId indexed poolId,
    uint256 indexed windowId,
    uint256 amount
);

event FeesWithdrawn(
    PoolId indexed poolId,
    address indexed recipient,
    uint256 amount
);
```

### 10.2 Reconciliation Invariant

```
sum(BetPlaced.amount)
  = sum(PayoutPushed.amount)
  + sum(PayoutClaimed.amount)
  + sum(FeeCollected.amount)
  + sum(WindowRolledOver.carryAmount)
  + sum(RefundClaimed.amount)
```

---

## 11. Security Considerations

### 11.1 Attack Vectors & Mitigations

| Attack | Mitigation |
|--------|-----------|
| Last-second sniping | 3-window freeze enforced: `require(block.timestamp < windowEnd - 180)` |
| Keeper price manipulation | Pyth signature verified on-chain; keeper cannot forge |
| Double-claim | `payoutPushed[poolId][windowId][user]` flag checked before transfer |
| Reentrancy | `ReentrancyGuard` + state updates before external calls |
| Replay attack (bet) | `betNonces[user]` incremented per signature |
| Replay attack (claim) | `claimNonces[user]` incremented per signature |
| USDC custody | Held by PoolManager (V4 core), not hook |
| Admin rug | ADMIN cannot move funds; TREASURY cannot change params |

### 11.2 Solidity Best Practices

- **Version:** Solidity 0.8.26+ (checked arithmetic)
- **Reentrancy:** All state changes before external calls
- **Access control:** OpenZeppelin `AccessControl`
- **Pausability:** Emergency `pause()` blocks new bets only (not settlement/claims)
- **No inline assembly** (unless essential and documented)
- **No `delegatecall`** (hook is standalone, not upgradeable)

---

## 12. Implementation Priorities

### 12.1 Build Order

**Phase 1: Core Hook (Week 1-2)**
1. `PariHook.sol` skeleton + AccessControl
2. `placeBet()` + window validation
3. `settle()` + Pyth integration
4. `claimAll()` + payout logic
5. Rollover + void logic

**Phase 2: Gasless Flows (Week 2-3)**
6. `placeBetWithSig()` + EIP-712 verification
7. `claimAllFor()` + EIP-712 verification
8. `permitAndPlaceBet()` (EIP-2612)

**Phase 3: Admin Functions (Week 3)**
9. `depositBackstop()` + `withdrawFees()`
10. `pushPayouts()` (keeper-triggered)
11. `pause()` / `unpause()`

**Phase 4: RIDE Token System (Week 4)**
12. `RIDE.sol` (ERC20 + permit + transfer restrictions)
13. `RideStaking.sol` (stake/unstake + fee tiers)
14. `RideDistributor.sol` (emissions + airdrop)

**Phase 5: Testing (Week 5)**
15. Unit tests (100% branch coverage on PariHook)
16. Integration tests (full bet → settle → claim cycle)
17. Fuzz tests (invariant testing)

**Phase 6: Deployment (Week 6)**
18. Deploy scripts (Foundry)
19. ABI export to frontend
20. Base Sepolia testnet deploy + E2E test

---

### 12.2 Function Implementation Checklist

**PariHook.sol Core Functions:**
- [ ] `beforeInitialize()` — Store GridConfig
- [ ] `placeBet()` — Direct bet entry
- [ ] `placeBetWithSig()` — Gasless bet (EIP-712)
- [ ] `permitAndPlaceBet()` — MetaMask fallback (EIP-2612)
- [ ] `settle()` — Settlement with Pyth price
- [ ] `pushPayouts()` — Keeper payout distribution
- [ ] `claimAll()` — User pull claim
- [ ] `claimAllFor()` — Gasless claim (EIP-712)
- [ ] `claimRefund()` — Void window refund
- [ ] `depositBackstop()` — Protocol liquidity boost
- [ ] `withdrawFees()` — Fee withdrawal
- [ ] `pause()` / `unpause()` — Emergency stop
- [ ] `unlockCallback()` — PoolManager callback router
- [ ] `currentWindowId()` — Window derivation
- [ ] `hasPendingClaim()` — Claim check
- [ ] `getUserFeeBps()` — Fee tier delegation
- [ ] `_parsePythPrice()` — Price normalization
- [ ] `_validateBet()` — Bet validation helper
- [ ] `_rollover()` — Rollover logic
- [ ] `_claimAllInternal()` — Shared claim logic

**View Functions:**
- [ ] `getGridConfig()`
- [ ] `getWindow()`
- [ ] `getCellStakes()`
- [ ] `getUserStake()`
- [ ] `getPendingClaims()`

---

## 13. Testing Requirements

### 13.1 Unit Tests (Foundry)

**File:** `test/PariHook.t.sol`

**Coverage Target:** 100% branch coverage

**Test Categories:**

**Bet Placement:**
- [ ] `test_placeBet_happy_path`
- [ ] `test_placeBet_reverts_window_not_in_betting_zone`
- [ ] `test_placeBet_reverts_frozen_window`
- [ ] `test_placeBet_reverts_past_window`
- [ ] `test_placeBet_reverts_exceeds_maxStakePerCell`
- [ ] `test_placeBetWithSig_valid_eip712`
- [ ] `test_placeBetWithSig_reverts_bad_signature`
- [ ] `test_placeBetWithSig_reverts_expired_deadline`
- [ ] `test_placeBetWithSig_reverts_replayed_nonce`

**Settlement:**
- [ ] `test_settle_sets_winningCell_correctly`
- [ ] `test_settle_calculates_redemptionRate_correctly`
- [ ] `test_settle_rollover_when_no_bets_on_winning_cell`
- [ ] `test_settle_void_when_below_minPoolThreshold`
- [ ] `test_settle_reverts_if_already_settled`
- [ ] `test_settle_reverts_if_window_not_ended`

**Payouts:**
- [ ] `test_pushPayouts_distributes_usdc_correctly`
- [ ] `test_pushPayouts_reverts_non_treasury`
- [ ] `test_claimAll_happy_path`
- [ ] `test_claimAll_reverts_nothing_to_claim`
- [ ] `test_claimAllFor_valid_eip712_sig`
- [ ] `test_claimAllFor_reverts_bad_sig`
- [ ] `test_claimRefund_void_window`
- [ ] `test_claimRefund_reverts_non_void_window`

**Fee Logic:**
- [ ] `test_fee_taken_only_when_winStakes_gt_0`
- [ ] `test_fee_not_taken_on_rollover`
- [ ] `test_fee_discounted_for_ride_stakers`

**Access Control:**
- [ ] `test_beforeInitialize_reverts_without_admin_role`
- [ ] `test_depositBackstop_onlyTreasury`
- [ ] `test_withdrawFees_onlyTreasury`
- [ ] `test_pause_stops_all_bets`

**Edge Cases:**
- [ ] `test_SENTINEL_never_reachable_as_real_cell`
- [ ] `test_multiple_bets_same_cell_same_user`
- [ ] `test_pyth_price_normalization`

### 13.2 Integration Tests

**File:** `test/PariHook.integration.t.sol`

- [ ] `test_full_bet_settle_claim_cycle_single_winner`
- [ ] `test_full_bet_settle_pushPayouts_cycle`
- [ ] `test_rollover_carries_pool_to_next_window`
- [ ] `test_void_refund_flow_oracle_failure`
- [ ] `test_multiple_pools_independent_state`
- [ ] `test_bet_claim_with_ride_staking_discount`

### 13.3 Fuzz Tests

**File:** `test/PariHook.fuzz.t.sol`

- [ ] `fuzz_cellId_always_maps_to_valid_price_range`
- [ ] `fuzz_redemptionRate_never_exceeds_pool`
- [ ] `fuzz_no_loss_of_funds_across_random_bet_settle_cycles`

### 13.4 Gas Benchmarks

```bash
forge snapshot
```

**Target Gas Costs (Base L2):**
- `placeBet()`: < 80,000 gas
- `settle()`: < 120,000 gas
- `claimAll()` (single window): < 60,000 gas
- `pushPayouts()` (10 winners): < 200,000 gas

---

## 14. Deployment Specifications

### 14.1 Base Mainnet Addresses

```solidity
// Pyth Oracle (Base Mainnet)
IPyth pyth = IPyth(0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a);

// USDC (Base Mainnet)
Currency usdc = Currency.wrap(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);

// Uniswap V4 PoolManager (Base Mainnet)
IPoolManager poolManager = IPoolManager(0x...); // TBD on V4 launch
```

### 14.2 GridConfig for ETH/USD MVP

```solidity
GridConfig({
    pythPriceFeedId: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace,
    bandWidth: 2_000_000,                    // $2.00
    windowDuration: 60,                      // 1 minute
    frozenWindows: 3,                        // 3-minute freeze
    maxStakePerCell: 100_000_000000,         // $100,000
    feeBps: 200,                             // 2%
    gridEpoch: 1740000000,                   // Set to next UTC minute boundary
    minPoolThreshold: 0                      // Disabled at launch
})
```

### 14.3 Role Assignments

```solidity
// On deployment
_grantRole(DEFAULT_ADMIN_ROLE, DEPLOYER_ADDRESS);
_grantRole(ADMIN_ROLE, ADMIN_EOA);
_grantRole(TREASURY_ROLE, TREASURY_MULTISIG);
_grantRole(RELAYER_ROLE, RELAYER_API_WALLET);
```

### 14.4 Deploy Script

**File:** `script/Deploy.s.sol`

```solidity
contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address adminEoa = vm.envAddress("ADMIN_ADDRESS");
        address treasuryMultisig = vm.envAddress("TREASURY_ADDRESS");
        address relayerWallet = vm.envAddress("RELAYER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PariHook
        PariHook hook = new PariHook(
            IPoolManager(POOL_MANAGER_ADDRESS),
            IPyth(PYTH_ADDRESS)
        );

        // 2. Deploy RIDE token
        RIDE ride = new RIDE(address(distributor)); // mint to distributor

        // 3. Deploy RideStaking
        RideStaking staking = new RideStaking(address(ride));

        // 4. Deploy RideDistributor
        RideDistributor distributor = new RideDistributor(address(ride));

        // 5. Grant roles
        hook.grantRole(hook.ADMIN_ROLE(), adminEoa);
        hook.grantRole(hook.TREASURY_ROLE(), treasuryMultisig);
        hook.grantRole(hook.RELAYER_ROLE(), relayerWallet);

        // 6. Initialize pool
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC_ADDRESS),
            currency1: Currency.wrap(address(ride)),
            fee: 0,
            tickSpacing: 1,
            hooks: IHooks(address(hook))
        });

        GridConfig memory config = GridConfig({
            pythPriceFeedId: ETH_USD_FEED_ID,
            bandWidth: 2_000_000,
            windowDuration: 60,
            frozenWindows: 3,
            maxStakePerCell: 100_000_000000,
            feeBps: 200,
            gridEpoch: block.timestamp - (block.timestamp % 60) + 60,
            minPoolThreshold: 0
        });

        poolManager.initialize(key, SQRT_PRICE_1_1, abi.encode(config));

        vm.stopBroadcast();

        console.log("PariHook deployed:", address(hook));
        console.log("RIDE deployed:", address(ride));
        console.log("RideStaking deployed:", address(staking));
        console.log("RideDistributor deployed:", address(distributor));
    }
}
```

---

## 15. Key Invariants

These invariants MUST hold at all times. Tests verify each one.

### 15.1 Funds Safety

```
∀ poolId, windowId:
    sum(userStakes[windowId][cellId][user]) = totalPool[windowId]
```

```
∀ poolId:
    USDC.balanceOf(poolManager) >= sum(totalPool[all windows])
```

### 15.2 Single Settlement

```
∀ poolId, windowId:
    settled[windowId] = true ⟹ settle() reverts
```

### 15.3 No Double Payout

```
∀ poolId, windowId, user:
    payoutPushed[windowId][user] = true ⟹ payout cannot be claimed again
```

### 15.4 Fee Only When Winners Exist

```
∀ poolId, windowId:
    fee taken ⟺ cellStakes[winningCell] > 0
```

```
∀ poolId, windowId:
    cellStakes[winningCell] = 0 ⟹ fee = 0 ∧ rollover occurs
```

### 15.5 Void Means Full Refund

```
∀ poolId, windowId:
    voided[windowId] = true ⟹ sum(refunds) = totalPool[windowId]
```

### 15.6 Settling is Permissionless

```
∀ caller:
    can call settle() if window ended ∧ !settled
```

### 15.7 SENTINEL Never Reachable

```
winningCell = type(uint256).max ⟹ never from real price
    (requires price ≈ 2.31 × 10^77, physically impossible)
```

---

## Appendix A: Architectural Decision Records

All architectural decisions documented in `blocksride-docs/adr.md`:

- **ADR-001:** 3-window freeze to prevent sniping
- **ADR-002:** Per-cell stake caps (whale protection)
- **ADR-003:** Correlated cells risk (acknowledged, fee margin)
- **ADR-004:** Pyth point-in-time settlement (deterministic)
- **ADR-005:** Gap analysis (share model vs parimutuel)
- **ADR-006:** Uniswap V4 hook architecture
- **ADR-007:** MVP scope (ETH/USD only, Base)
- **ADR-008:** Backstop deposits + minimum pool threshold
- **ADR-009:** 3-minute freeze mechanics
- **ADR-010:** Live cell pulse (frontend only)
- **ADR-011:** 2-second buffer for Base sequencer drift
- **ADR-012:** Event-driven audit trail
- **ADR-013:** Absolute cell IDs (no anchor)
- **ADR-015:** RIDE token reward system

---

## Appendix B: Critical Implementation Notes

### B.1 Spec Conflicts Resolved

1. **PoolKey.currency1:** Use RIDE token (not synthetic ETH_PRED)
2. **GridConfig mutability:** ALL fields immutable after initialization
3. **Backstop reclaim:** `claimRefund()` handles both user + backstop on void
4. **Reward integration:** RideDistributor called off-chain based on events

### B.2 Gas Optimization Targets

- Minimize storage writes per bet (use mappings, not arrays)
- Batch claim processing via `claimAll()`
- Event-based keeper indexing (no on-chain loops)
- Price normalization: single operation, no repeated division

### B.3 Audit Checklist

Before mainnet deployment with real funds:
- [ ] Full security audit by reputable firm
- [ ] Formal verification of key invariants
- [ ] Economic attack modeling (thin pool scenarios)
- [ ] Pyth oracle integration review
- [ ] AccessControl role separation review
- [ ] Gas optimization review (Base L2 specific)

---

## Appendix C: References

**Documentation:**
- `blocksride-docs/architecture.md` — Technical specification
- `blocksride-docs/adr.md` — All ADRs (ADR-001 to ADR-015)
- `blocksride-docs/prd.md` — Product requirements
- `blocksride-docs/tokenomics.md` — RIDE token economics
- `blocksride-docs/TASK_DIVISION.md` — Build order, ownership
- `blocksride-docs/MIGRATION.md` — Repository structure
- `blocksride-docs/workflow.md` — System flows
- `blocksride-docs/userflow.md` — User journeys

**External:**
- [Uniswap V4 Docs](https://docs.uniswap.org/contracts/v4/overview)
- [Pyth Network Docs](https://docs.pyth.network/)
- [Base Network](https://docs.base.org/)
- [OpenZeppelin AccessControl](https://docs.openzeppelin.com/contracts/access-control)
- [EIP-712: Typed Structured Data](https://eips.ethereum.org/EIPS/eip-712)
- [EIP-2612: Permit Extension](https://eips.ethereum.org/EIPS/eip-2612)

---

**END OF SMART CONTRACT ARCHITECTURE DOCUMENT**

**Next Steps for Allan:**
1. Review this document thoroughly
2. Set up Foundry project structure
3. Implement `PariHook.sol` core (Phase 1)
4. Write unit tests as you implement each function
5. Generate ABIs and coordinate handoff with Fred for frontend integration

**Questions or ADR Changes:**
If implementation requires deviation from this spec, write a new ADR (ADR-016) in `blocksride-docs/adr.md` before changing code.
