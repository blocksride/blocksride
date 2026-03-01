# BlocksRide: Parimutuel Prediction Markets on Uniswap V4

## Executive Summary

BlocksRide is a fully on-chain parimutuel prediction market protocol built as a Uniswap V4 hook on Base L2. It enables users to speculate on cryptocurrency price movements within discrete time windows and price bands, settling via decentralized oracle infrastructure. By leveraging Uniswap V4's hook architecture, BlocksRide eliminates traditional prediction market inefficiencies while inheriting the security and liquidity management capabilities of the battle-tested PoolManager contract.

## 1. Introduction

### 1.1 Motivation

Traditional prediction markets face three critical challenges:

1. **Centralized Custody**: User funds held in proprietary smart contracts with single points of failure
2. **Opaque Settlement**: Off-chain price feeds vulnerable to manipulation or downtime
3. **Liquidity Fragmentation**: Each market maintains isolated liquidity pools

BlocksRide addresses these issues through architectural innovation, not incremental improvements.

### 1.2 Core Innovation

BlocksRide's key insight is recognizing that Uniswap V4's PoolManager contract provides an ideal custody and accounting layer for prediction markets. Rather than building yet another isolated AMM, BlocksRide operates as a hook—a permissionless plugin that extends PoolManager's capabilities to support parimutuel betting mechanics.

## 2. Uniswap V4 Hook Architecture

### 2.1 Hook System Overview

Uniswap V4 introduces hooks as lifecycle callbacks that execute during pool operations:

```
Pool Lifecycle Event → PoolManager checks hook permissions → Hook callback executes → State updates
```

Hooks can intercept:
- Pool initialization (beforeInitialize, afterInitialize)
- Liquidity operations (beforeAddLiquidity, afterAddLiquidity, etc.)
- Swaps (beforeSwap, afterSwap)
- Donations (beforeDonate, afterDonate)

### 2.2 PoolManager as Singleton

Unlike Uniswap V3 where each pool is a separate contract, V4 uses a singleton PoolManager that manages all pools. This architectural shift enables:

- **Efficient multi-pool operations**: Batch transactions across pools with reduced gas costs
- **Unified liquidity**: Flash accounting between pools within single transactions
- **Composability**: Hooks can interact with multiple pools atomically

### 2.3 Custody Model

In Uniswap V4, the PoolManager holds all tokens across all pools. Individual pools and hooks do not custody funds directly. Instead, they issue unlock callbacks that modify internal accounting ledgers within the PoolManager.

This model provides:
- **Security**: Audited, battle-tested custody layer
- **Capital Efficiency**: No token transfers between contracts for multi-pool operations
- **Atomic Settlement**: Complex operations execute within single PoolManager.unlock() calls

## 3. BlocksRide Hook Implementation

### 3.1 Architecture Overview

BlocksRide implements a single hook contract (PariHook.sol) that manages multiple prediction markets. Each market is initialized as a Uniswap V4 pool with custom parameters encoded in hookData during pool creation.

```
Market 1 (ETH/USD) ─┐
Market 2 (BTC/USD) ─┤ → PariHook.sol → PoolManager (USDC custody)
Market 3 (SOL/USD) ─┘
```

### 3.2 Grid Configuration

Each market operates on a grid defined by:

| Parameter | Description | Example |
|-----------|-------------|---------|
| pythPriceFeedId | Pyth oracle price feed identifier | ETH/USD feed ID |
| bandWidth | Price band width in USDC (6 decimals) | $2.00 = 2,000,000 |
| windowDuration | Time window length in seconds | 60 seconds |
| frozenWindows | Frozen zone before settlement | 3 windows = 180s minimum horizon |
| maxStakePerCell | Maximum USDC per cell to limit whale dominance | $100,000 |
| feeBps | Platform fee (basis points) | 200 = 2% |
| gridEpoch | Unix timestamp of window 0 | Fixed initialization time |

### 3.3 Absolute Cell ID System (ADR-013)

BlocksRide uses an absolute cell ID formula instead of anchored grids:

```
cellId = floor(currentPrice / bandWidth)

Example:
Price: $3,001.20
Band width: $2.00
cellId = floor(3001.20 / 2) = 1500

Cell 1500 represents price range [$3,000.00, $3,002.00)
```

This approach enables:
- **Infinite vertical scroll**: No pre-creation of cell rows in database
- **Zero storage overhead**: Cell IDs are computed on-demand, not stored
- **Predictable mechanics**: Any price maps to exactly one cell forever

### 3.4 Time Window System

Users bet on future time windows organized in a rolling grid:

```
← Past (settled) ─── Frozen ──── Bettable →
│ -3 │ -2 │ -1 │ +0 │ +1 │ +2 │ +3 │ +4 │ +5 │ +6 │
│SETTL│SETTL│SETTL│NOW│LOCK│LOCK│LOCK│OPEN│OPEN│OPEN│
```

- **Current window (+0)**: Betting closed, settlement pending
- **Frozen windows (+1 to +3)**: Betting locked, prevents price sniping
- **Bettable windows (+4 to +6)**: Open for new bets (180-second minimum horizon)

Window ID calculation:
```solidity
windowId = floor((block.timestamp - gridEpoch) / windowDuration)
```

### 3.5 Parimutuel Settlement Mechanics

Settlement follows pure parimutuel logic:

```
1. Window ends at timestamp: windowEnd = (windowId + 1) × windowDuration + gridEpoch
2. Keeper fetches Pyth oracle price at windowEnd
3. Winning cell: cellId = floor(closingPrice / bandWidth)
4. If no stakes on winning cell → rollover (pool carries to next window)
5. If stakes exist on winning cell:
   fee = organicPool × feeBps / 10000
   netPool = (organicPool + backstopPool) - fee
   redemptionRate = netPool × 1e18 / winningCellStakes
6. Winners claim: payout = userStake × redemptionRate / 1e18
```

Example:
```
Total pool: $10,000
Winning cell stakes: $2,000
Fee (2%): $200
Net pool: $9,800
Redemption rate: 9,800 / 2,000 = 4.9x

User bet $100 on winning cell:
Payout = $100 × 4.9 = $490
```

### 3.6 Integration with PoolManager

BlocksRide leverages PoolManager's unlock callback pattern for all token operations:

**Bet Placement:**
```solidity
poolManager.unlock(
    abi.encodeCall(this._unlockCallback, (BET_OPERATION, poolId, betData))
);

function _unlockCallback(bytes calldata data) external {
    // Decode operation type and parameters
    // poolManager.burn() - debit user's USDC balance
    // Update internal bet accounting (cellStakes, userStakes)
    // Return balance delta to PoolManager
}
```

**Payout Distribution:**
```solidity
poolManager.unlock(
    abi.encodeCall(this._unlockCallback, (PAYOUT_OPERATION, poolId, payoutData))
);

function _unlockCallback(bytes calldata data) external {
    // Calculate payout = userStake × redemptionRate / 1e18
    // poolManager.mint() - credit user's USDC balance
    // Zero out claimed stakes
    // Return balance delta
}
```

This design ensures:
- **Atomic operations**: Bets and payouts execute within single transactions
- **No token approvals to hook**: Users approve PoolManager directly (or via EIP-2612 permit)
- **Reentrancy protection**: PoolManager enforces unlock reentrancy guards

## 4. Innovative Features

### 4.1 Gasless Transactions via EIP-712

BlocksRide implements dual signature schemes for gas abstraction:

**BetIntent (EIP-712 typed data):**
```solidity
struct BetIntent {
    PoolId poolId;
    uint256 windowId;
    uint256 cellId;
    uint256 amount;
    address user;
    uint256 nonce;
    uint256 deadline;
}
```

Flow:
1. User signs BetIntent with embedded wallet (Privy)
2. Relayer submits placeBetWithSig() transaction
3. Hook verifies signature via ECDSA recovery
4. Relayer pays gas, user pays nothing

**ClaimIntent (EIP-712):**
Similar pattern enables gasless payout claims.

**Fallback: EIP-2612 Permit:**
For external wallets (MetaMask), users sign USDC permit + bet in single transaction:
```solidity
permitAndPlaceBet(poolKey, cellId, windowId, amount, deadline, v, r, s)
```

### 4.2 Dual Payout Paths

BlocksRide implements push and pull payout mechanisms:

**Push (default):**
After settlement, keeper reads BetPlaced event logs, identifies winners, calls pushPayouts(). USDC lands in user wallets without action required.

**Pull (fallback):**
If push fails (e.g., recipient contract without receive function), users call claimAll() to retrieve winnings manually.

This hybrid approach optimizes UX while maintaining trustlessness.

### 4.3 Cell Seeding (Rollover Prevention)

When a window enters the bettable zone, the keeper automatically places $0.01 dust bets on 21 cells centered on current price (±$20 range).

**Rationale:**
- Prevents rollover under normal volatility (±10% intraday moves)
- Ensures settlement fee collection (fee only taken when winners exist)
- Cost: $0.21 per window, amortized across platform fees

Seeding uses backstop funds, not organic user bets, ensuring no conflicts of interest.

### 4.4 Oracle Integration (Pyth Network)

Settlement uses Pyth's pull oracle model:

1. Keeper fetches VAA (Verifiable Action Approval) from Pyth Hermes API at windowEnd timestamp
2. Submits VAA to hook's settle() function
3. Hook calls pythOracle.parsePriceFeedUpdates() on-chain
4. Pyth verifies VAA signature cryptographically
5. Hook extracts price, validates timestamp (±2s buffer for Base sequencer drift)

**Security properties:**
- Keepers cannot forge prices (VAA signed by Pyth guardians)
- Settlement is permissionless (anyone can call settle() with valid VAA)
- Timestamp verification prevents manipulation

## 5. Problems Solved

### 5.1 Custody Risk Elimination

**Problem:** Traditional prediction markets require users to trust platform contracts with funds.

**Solution:** By using PoolManager custody, BlocksRide inherits Uniswap V4's security guarantees. PoolManager is:
- Open source and audited
- Upgradeable only via governance (if enabled)
- Used across thousands of pools with billions in TVL

### 5.2 Transparent Settlement

**Problem:** Centralized oracles can be manipulated or censored during settlement.

**Solution:** Pyth's decentralized oracle network with cryptographic verification ensures:
- No single point of failure (70+ guardian nodes)
- On-chain price verification via VAA signatures
- Permissionless settlement (anyone can call settle())

### 5.3 Capital Efficiency

**Problem:** Prediction markets traditionally require isolated liquidity pools.

**Solution:** PoolManager's singleton architecture enables:
- Shared USDC liquidity across all markets
- Flash accounting for instant settlements
- Reduced gas costs via batched operations

### 5.4 Composability

**Problem:** Isolated prediction market contracts cannot interact with DeFi primitives.

**Solution:** As a Uniswap V4 hook, BlocksRide can:
- Integrate with other V4 hooks in same transaction
- Leverage existing V4 tooling (subgraphs, aggregators, wallets)
- Compose with lending protocols (e.g., use aUSDC for bets while earning yield)

### 5.5 Regulatory Clarity

**Problem:** Order book prediction markets resemble securities trading.

**Solution:** Parimutuel mechanics mirror legal pari-mutuel betting:
- No counterparty matching (users bet against the pool)
- Fixed-odds at bet placement (multiplier shown upfront)
- Platform takes no trading position (house collects fee, not spread)

## 6. Technical Advantages

### 6.1 Gas Optimization

Hook architecture reduces gas costs:

| Operation | Traditional AMM | BlocksRide Hook |
|-----------|----------------|-----------------|
| Token custody | Transfer to pool contract | PoolManager accounting update |
| Multi-pool operations | N transfers + N approvals | Single unlock callback |
| Settlement | Per-user claim transactions | Batch pushPayouts |

Estimated savings: 40-60% gas reduction vs. isolated contracts.

### 6.2 Upgradeability

PariHook.sol is immutable, but markets can evolve:
- New hooks deploy alongside existing ones
- Users migrate voluntarily to new versions
- Old markets remain functional indefinitely (no forced upgrades)

This aligns with DeFi's ethos of immutability and user sovereignty.

### 6.3 Minimal Attack Surface

By delegating custody, token transfers, and reentrancy protection to PoolManager, PariHook.sol reduces its attack surface to:
- Bet validation logic
- Settlement calculation
- Access control (admin roles)

Fewer responsibilities = fewer vulnerabilities.

## 7. Differentiation from Competitors

### 7.1 vs. Polymarket

| Feature | Polymarket | BlocksRide |
|---------|-----------|------------|
| Settlement | CLOB with market makers | Parimutuel pool |
| Custody | Gnosis Safe multisig | Uniswap V4 PoolManager |
| Oracle | UMA optimistic oracle | Pyth cryptographic verification |
| Chain | Polygon | Base L2 |
| Market creation | Permissioned | Permissionless (anyone can initialize pool) |

BlocksRide offers superior decentralization and lower operational overhead.

### 7.2 vs. Augur

| Feature | Augur | BlocksRide |
|---------|-------|------------|
| Settlement | Dispute rounds with REP staking | Single-source Pyth oracle |
| Latency | Hours to days | Seconds to minutes |
| Market types | Binary, categorical, scalar | Price prediction only |
| Complexity | High (market creation UX barrier) | Low (fixed grid structure) |

BlocksRide optimizes for speed and simplicity over flexibility.

### 7.3 vs. Azuro

| Feature | Azuro | BlocksRide |
|---------|-------|------------|
| Domain | Sports betting | Crypto price prediction |
| Liquidity | Liquidity pools per market | Shared PoolManager custody |
| Integration | Standalone protocol | Uniswap V4 hook |

BlocksRide leverages existing DeFi infrastructure rather than building parallel systems.

## 8. Use Cases

### 8.1 Retail Speculation

Users can speculate on short-term price movements (60-second windows) with transparent odds and instant settlement.

### 8.2 Hedging

Traders can hedge spot positions by betting on opposite price movements in BlocksRide markets.

Example:
- Holding 1 ETH at $3,000
- Bet $100 on [$2,980, $2,982] cell in next window
- If ETH drops to $2,981, win payout offsets spot loss

### 8.3 Market Sentiment Analysis

Aggregated cell stakes reveal market expectations:
- High stakes on upper cells → bullish sentiment
- High stakes on lower cells → bearish sentiment

This data can feed trading algorithms or sentiment indicators.

### 8.4 MEV Mitigation

By requiring 180-second minimum bet horizons (frozen windows), BlocksRide eliminates atomic front-running:
- Bots cannot observe price feed updates and bet in same block
- Settlement price is unknowable at bet placement time

## 9. Future Extensions

### 9.1 Multi-Token Markets

Current design uses USDC exclusively. Future versions could support:
- ETH-denominated bets (native gas token markets)
- Stablecoin aggregation (DAI, USDT, USDC pooled as "USD")

### 9.2 Cross-Hook Composability

BlocksRide could integrate with other V4 hooks:
- **Dynamic fee hook**: Adjust bet fees based on volatility
- **TWAMM hook**: Combine time-weighted AMM with prediction markets
- **Limit order hook**: Place conditional bets triggered at price thresholds

### 9.3 DAO Governance

Future versions could implement:
- Token-weighted voting on fee parameters
- Treasury management for backstop funds
- Market curation (whitelist oracle feeds)

## 10. Risk Analysis

### 10.1 Oracle Risk

**Risk:** Pyth oracle downtime or manipulation.

**Mitigation:**
- Pyth uses 70+ independent guardian nodes
- VAA signatures verified cryptographically on-chain
- Fallback: Admin can void windows if oracle fails (users get refunds)

### 10.2 Smart Contract Risk

**Risk:** Bug in PariHook.sol draining funds.

**Mitigation:**
- Comprehensive test suite (100+ unit/integration tests)
- External audit before mainnet launch
- Gradual rollout (testnet → limited mainnet → full launch)

### 10.3 Regulatory Risk

**Risk:** Parimutuel betting classified as illegal gambling in some jurisdictions.

**Mitigation:**
- Geo-blocking at frontend level (not enforced on-chain)
- Clear ToS disclaiming availability in restricted regions
- Legal opinion validating parimutuel structure under applicable law

### 10.4 Liquidity Risk

**Risk:** Insufficient participation leading to frequent rollovers.

**Mitigation:**
- Cell seeding ensures at least $4.20 per window (21 cells × $0.01 × 20 windows)
- Marketing to build user base before reducing backstop
- Fee discounts for RIDE token holders (incentivizes participation)

## 11. Conclusion

BlocksRide represents a paradigm shift in prediction market design. By building on Uniswap V4's hook architecture rather than creating isolated infrastructure, the protocol achieves:

1. **Superior security** through battle-tested PoolManager custody
2. **Enhanced composability** via V4 ecosystem integration
3. **Operational efficiency** through shared liquidity and reduced gas costs
4. **Regulatory defensibility** via transparent parimutuel mechanics

The hook model transforms prediction markets from standalone applications into modular DeFi primitives, unlocking new possibilities for on-chain speculation, hedging, and market analysis.

As Uniswap V4 adoption grows, BlocksRide is positioned to become the default prediction market layer for the Ethereum L2 ecosystem, starting with Base and expanding to Optimism, Arbitrum, and beyond.

## 12. Technical Specifications

### 12.1 Deployment Details

- **Chain:** Base Mainnet (chainId: 8453)
- **Solidity Version:** 0.8.26+
- **Dependencies:**
  - Uniswap V4 Core (v4-core)
  - Uniswap V4 Periphery (v4-periphery)
  - OpenZeppelin Contracts (AccessControl, Pausable, ReentrancyGuard)
  - Pyth SDK Solidity (IPyth, PythStructs)
- **Token Standard:** USDC (6 decimals, ERC20 with EIP-2612 permit)

### 12.2 Access Control Roles

| Role | Capabilities | Multisig Requirement |
|------|--------------|---------------------|
| DEFAULT_ADMIN_ROLE | Grant/revoke other roles | Hardware wallet (cold storage) |
| ADMIN_ROLE | pause(), setGridConfig() | 2-of-3 multisig |
| TREASURY_ROLE | withdrawFees(), depositBackstop(), pushPayouts() | 2-of-3 multisig |
| RELAYER_ROLE | placeBetWithSig(), claimAllFor() | Hot wallet (operator key) |

### 12.3 Event Schema

All state changes emit events for indexing and transparency:

```solidity
event GridInitialized(PoolId indexed poolId, bytes32 pythPriceFeedId, ...);
event BetPlaced(PoolId indexed poolId, uint256 indexed windowId, uint256 indexed cellId, address user, uint256 amount);
event WindowSettled(PoolId indexed poolId, uint256 indexed windowId, uint256 winningCell, uint256 closingPrice, uint256 redemptionRate);
event WindowVoided(PoolId indexed poolId, uint256 indexed windowId, string reason);
event PayoutClaimed(PoolId indexed poolId, uint256 indexed windowId, address indexed user, uint256 amount);
```

### 12.4 Key Invariants

The following invariants are enforced and tested:

1. **Conservation of funds:** Sum of all user stakes + fees = pool balance
2. **Stake consistency:** Sum of userStakes[cellId][*] = cellStakes[cellId]
3. **Settlement finality:** Once settled, window.settled cannot be reverted
4. **Bet zone enforcement:** All bets fall within [current+frozenWindows+1, current+frozenWindows+3]
5. **Fee cap:** feeBps ≤ 1000 (10% maximum)

## References

- Uniswap V4 Whitepaper: https://github.com/Uniswap/v4-core/blob/main/whitepaper-v4-draft.pdf
- Pyth Network Documentation: https://docs.pyth.network/
- EIP-712 Specification: https://eips.ethereum.org/EIPS/eip-712
- EIP-2612 Permit Extension: https://eips.ethereum.org/EIPS/eip-2612
- Base L2 Architecture: https://docs.base.org/
