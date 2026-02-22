# BlocksRide Smart Contract Architecture (Allan)

This file is the contract-side implementation map for Allan, based on:

- `blocksride-docs/TASK_DIVISION.md`
- `blocksride-docs/architecture.md`
- `blocksride-docs/prd.md`
- `blocksride-docs/adr.md`
- `blocksride-docs/tokenomics.md`
- `blocksride-docs/MIGRATION.md`

## 1. Goal (Contract Scope)

Build the on-chain parimutuel prediction-market core for BlocksRide in `Foundry` under `blocksride/contracts/`, with `PariHook.sol` as the primary contract and RIDE reward-token contracts layered around it.

## 2. Contracts To Be Created

### Core Contracts (documented in task division)

1. `contracts/src/PariHook.sol` (P0)
- Main Uniswap V4 hook contract.
- Stores per-pool `GridConfig` and per-window betting state.
- Handles bet placement, settlement, payout push/pull, refunds, backstop deposits, fee withdrawal.
- Enforces roles (`ADMIN_ROLE`, `TREASURY_ROLE`, `RELAYER_ROLE`) and permissionless `settle()`.

2. `contracts/src/RIDE.sol` (P1)
- ERC20 reward token with EIP-2612 permit.
- Fixed supply (100M) minted to `RideDistributor` at deployment.
- V1 transfer restrictions (stake/unstake/claim-focused utility path).

3. `contracts/src/RideStaking.sol` (P2)
- Stakes RIDE and manages cooldown-based unstaking.
- Exposes fee discount tier lookup (read by `PariHook` via `getUserFeeBps(user)`).

4. `contracts/src/RideDistributor.sol` (P2)
- Holds and releases RIDE rewards (betting rewards + win bonus path).
- Handles airdrop claims / emissions schedule logic (per tokenomics spec).

### Supporting Contracts (likely / recommended)

5. `contracts/src/PredToken.sol` (optional, future multi-pair helper)
- Minimal synthetic ERC20 for per-market `PoolKey` uniqueness if a future pair uses the synthetic-token pattern.
- Not required for ETH/USDC MVP because `RIDE` is confirmed as `PoolKey.currency1`.

6. `contracts/src/interfaces/*` (recommended)
- Interfaces for `IPariHook`, `IRideStaking`, `IRideDistributor`, Pyth, and Uniswap V4 touchpoints.

7. `contracts/src/libraries/*` (recommended)
- Shared structs/types, math helpers, price normalization helpers, and EIP-712 hashing helpers.

## 3. Contracts Folder Structure

```text
blocksride/contracts/
├── SMART_CONTRACT_ARCHITECTURE.md   # This file (Allan's contract build map)
├── src/
│   ├── PariHook.sol
│   ├── RIDE.sol
│   ├── RideStaking.sol
│   ├── RideDistributor.sol
│   ├── PredToken.sol                # optional; depends on final pool-key decision
│   ├── interfaces/
│   └── libraries/
├── test/
│   ├── PariHook.t.sol
│   ├── PariHook.integration.t.sol
│   ├── RIDE.t.sol
│   ├── RideStaking.t.sol
│   └── RideDistributor.t.sol
├── script/
│   ├── Deploy.s.sol
│   └── DeployMainnet.s.sol
├── foundry.toml
└── lib/                             # forge install dependencies
```

## 4. Contract Short Bios (Point Form)

### `PariHook.sol`
- Single deployment serving many markets/pools (`PoolId` keyed state).
- Records bets against `windowId + cellId` (absolute cell IDs).
- Settles windows using Pyth price data at/after window close.
- Calculates winning cell, fees, redemption rate, rollover / void behavior.
- Supports:
- `placeBet`
- `placeBetWithSig` (gasless relayer path)
- `permitAndPlaceBet` (MetaMask + permit path)
- `settle`
- `pushPayouts`
- `claimAll`, `claimAllFor`, `claimRefund`
- `depositBackstop`, `withdrawFees`

### `RIDE.sol`
- Reward token for user retention and fee discounts.
- Permit-enabled (`EIP-2612`) for wallet UX.
- Restricted transfer mode in V1 per tokenomics/ADR-015.

### `RideStaking.sol`
- Users stake RIDE to receive lower betting/settlement fees.
- Tracks cooldown-based unstake lifecycle.
- Exposes fee tier read API used by `PariHook`.

### `RideDistributor.sol`
- Controls reward emissions and payout accounting for RIDE.
- Releases rewards tied to betting activity / settlement outcomes.
- Can host airdrop merkle claims and period caps.

### `PredToken.sol` (future/optional)
- Dummy/synthetic market token for V4 `PoolKey.currency1`.
- Not user-facing; exists to differentiate market pools.

## 5. High-Level Contract Responsibilities By Phase

1. Bet placement phase
- User/relayer calls into `PariHook`.
- `PariHook` validates window timing, cell, amount, signatures/nonces.
- `PariHook` records stake state and emits `BetPlaced`.

2. Settlement phase
- Keeper (or any address) calls `PariHook.settle(...)`.
- `PariHook` verifies Pyth update and derives `winningCell = floor(price / bandWidth)`.
- `PariHook` marks window settled, voided, or rolled over.
- `PariHook` computes fee and redemption rate when winners exist.

3. Payout / claim phase
- `TREASURY_ROLE` may push payouts via `pushPayouts`.
- Users can fallback to pull claims (`claimAll`) or relayer-assisted `claimAllFor`.
- Voided windows use `claimRefund`.

4. Rewards / fee-discount phase
- `PariHook` consults `RideStaking` for user fee tier (fee discount path).
- Reward mint/distribution flow integrates with `RideDistributor` and `RIDE`.

## 6. ASCII Contract Flow (Calls + Data Flow)

```text
                                 ┌──────────────────────┐
                                 │  DEFAULT_ADMIN_ROLE  │
                                 │  (cold admin)        │
                                 └──────────┬───────────┘
                                            │ grant/revoke roles
                                            ▼
┌──────────────┐   placeBet* / claim*   ┌─────────────────────────────┐
│ Users        ├───────────────────────►│       PariHook.sol          │
│ - MetaMask   │                        │ (main game + V4 hook core)  │
│ - Privy      │◄───────────────────────┤  emits events + state        │
└──────┬───────┘      payouts/refunds    └───────┬──────────┬──────────┘
       │                                         │          │
       │ gasless sig flows                        │          │ getUserFeeBps(user)
       ▼                                         │          ▼
┌──────────────┐  placeBetWithSig/claimAllFor    │   ┌──────────────────┐
│ Relayer      ├─────────────────────────────────┘   │ RideStaking.sol   │
│ (RELAYER)    │                                     │ fee tiers/cooldown│
└──────────────┘                                     └─────────┬────────┘
                                                               │ stake/unstake
                                                               ▼
                                                         ┌──────────────┐
                                                         │   RIDE.sol   │
                                                         │ ERC20+permit │
                                                         └──────┬───────┘
                                                                │ rewards source / transfers
                                                                ▼
                                                         ┌──────────────┐
                                                         │RideDistributor│
                                                         │ emissions     │
                                                         └──────────────┘

┌──────────────┐  settle(windowId, pythVAA)    ┌─────────────────────────────┐
│ Keeper / Any ├──────────────────────────────►│       PariHook.sol          │
│ Permissionless│                              └───────────┬─────────────────┘
└──────┬───────┘                                          │ parse/verify price
       │                                                  ▼
       │                                           ┌──────────────┐
       └──────────────────────────────────────────►│ Pyth Oracle   │
                                                   └──────────────┘

┌──────────────┐ depositBackstop / pushPayouts / withdrawFees
│ Treasury     ├───────────────────────────────────────────────► PariHook.sol
│ (TREASURY)   │
└──────────────┘

Notes:
- `settle()` is permissionless by design.
- `PariHook` is the source of truth for window/cell/user stake state.
- Contract events are the audit trail and keeper indexing source.
```

## 7. MVP Build Order (Allan)

1. `PariHook.sol` + tests (P0)
2. `Deploy.s.sol` + deployment config (P1)
3. `RIDE.sol` (P1)
4. `RideStaking.sol` (P2)
5. `RideDistributor.sol` (P2)
6. ABI export + handoff to frontend (`client/src/abis/`)

## 8. Important Spec Conflicts To Confirm Before Coding (Do not skip)

1. `PoolKey.currency1` for MVP:
- Confirmed by Allan: use `RIDE` as `PoolKey.currency1` for MVP.
- `ADR-007` synthetic `ETH_PRED` notes are treated as older/superseded MVP guidance.
- Deployment scripts and contract interfaces should assume `USDC / RIDE` pool key.

2. `GridConfig` mutability:
- `architecture.md` says config fields are immutable after init.
- `architecture.md` interface section also lists admin setters (`setFeeBps`, `setFrozenWindows`, `setMaxStakePerCell`, etc.).
- We need a final rule: immutable-by-pool config vs mutable risk params split.

3. Backstop reclaim path:
- `ADR-008` defines `reclaimBackstop(...)` on voided windows.
- `TASK_DIVISION.md` checklist includes `depositBackstop(...)` but not `reclaimBackstop(...)`.
- Confirm whether `reclaimBackstop` is in P0/P1 scope.

4. Reward integration trigger:
- Confirm whether `RideDistributor` is called directly by `PariHook` during bet/settle/claim, or rewards are distributed by a separate trusted operator/keeper using contract events.

## 9. Working Rules (from docs)

- Foundry only (no Hardhat)
- NatSpec on all public functions
- Strong test coverage before deploy
- If implementation deviates from docs, write a new ADR first
