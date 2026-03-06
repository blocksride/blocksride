# BlocksRide Testing

This is the single testing reference for PariHook contract validation, Pyth integration, and Base Sepolia test results.

## Scope

This document combines:

- local contract test execution
- Base Sepolia fork-based Pyth testing
- Phase 1 betting validation results
- troubleshooting notes for common failures

## Test Commands

### Full local suite

```bash
forge test
```

### Settlement unit tests only

```bash
forge test --match-contract SettlementTest -vvv
```

### Real Pyth integration tests on Base Sepolia fork

```bash
source .env
forge test --match-contract SettlementIntegrationTest \
  --fork-url $BASE_SEPOLIA_RPC_URL \
  -vvv
```

### Real Pyth script

```bash
source .env
forge script script/TestPythIntegration.s.sol:TestPythIntegration \
  --fork-url $BASE_SEPOLIA_RPC_URL \
  -vvvv
```

## What Is Covered

### Unit and local scenarios

- successful settlement with one or multiple winners
- no-winner rollover into the next window
- excess ETH refund handling in `settle()`
- auto-void on missing price
- auto-void on low organic pool
- revert behavior for:
  - empty Pyth update data
  - malformed update data
  - insufficient Pyth fee
  - already settled windows
  - already voided windows
  - windows that have not ended
- bet placement window validation
- minute-aligned `gridEpoch` enforcement

### Fork and live-oracle scenarios

- real ETH/USD fetch from the Base Sepolia Pyth contract
- update fee querying
- price conversion against live Pyth data
- integration test guards that skip cleanly when no fork is active

## Latest Results

### Full Forge Suite

Latest local run completed with:

- `138 passed`
- `0 failed`
- `2 skipped`

The skipped suite was `SettlementIntegrationTest`, which only runs on an active Base Sepolia fork.

### Base Sepolia Validation

**Validation date:** March 2, 2026  
**Contract:** `0xA1b7Aad793601d9C6bcE03a2a2CD0B80eEE229b7`

Verified successfully:

- deployment state
- role assignments
- ETH/USD grid configuration
- `getCurrentWindow()` and `getBettableWindows()`
- real-time Pyth price reads for ETH/USD and BTC/USD
- hook permission registration

## Phase 1 Functional Validation

### Bet placement

Verified:

- USDC approval flow
- direct `placeBet()` execution
- betting zone enforcement
- cell and user stake accounting
- pool accounting

### Settlement

Verified:

- `settle()` executes correctly
- auto-void is triggered when oracle data is unavailable
- refund path is available for voided windows
- rollover logic carries value into the next window

### Security and control behavior

Verified:

- frozen-window bet protection
- role-gated admin actions
- graceful behavior on oracle failure
- state remains unchanged on malformed settlement inputs

## Known Testnet Limitations

### Historical Pyth data

Real historical settlement depends on obtaining Pyth update data for the exact window close timestamp. On testnet this can be inconsistent depending on retained data and timing.

### Fork-only integration tests

`SettlementIntegrationTest` is designed to skip unless:

- there is contract code at the Base Sepolia Pyth address
- the Pyth contract call succeeds on the fork

## Troubleshooting

### `VM::skip` in `SettlementIntegrationTest`

Cause:

- no Base Sepolia fork was provided
- or the fork could not reach the real Pyth contract

Fix:

```bash
forge test --match-contract SettlementIntegrationTest \
  --fork-url $BASE_SEPOLIA_RPC_URL \
  -vvv
```

### NatSpec compile errors in vendored Pyth files

If `solc` rejects `@pythnetwork/pyth-sdk-solidity` inside vendor comments, patch the three files under `lib/pyth-sdk-solidity/` to remove or rewrite that doc text.

### Missing submodule files

Initialize submodules:

```bash
git submodule update --init --recursive
```

### RPC or fork issues

- verify `BASE_SEPOLIA_RPC_URL` is present in `.env`
- confirm the endpoint is reachable
- retry against a higher-quality RPC if you hit rate limits

## Recommended Next Tests

- keeper-driven settlement using live Hermes-fetched updates
- relayer-driven gasless bet placement end to end
- winner payout and pull-claim paths against live windows
- mainnet-style role separation and multisig operations

## Related Docs

- `Deployment.md`
- `PythIntegration.md`
- `SmartContractArchitecture.md`
