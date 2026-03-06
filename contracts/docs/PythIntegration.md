# Pyth Oracle Integration Architecture

## Overview

PariHook uses Pyth Network's pull oracle model for settlement. Unlike push oracles (e.g., Chainlink) that continuously update prices on-chain, Pyth requires users to submit price updates when needed.

## Architecture

```
┌─────────────┐
│   Keeper    │ (Off-chain TypeScript script)
│   Script    │
└──────┬──────┘
       │
       │ 1. Detects window end via polling (every 5s)
       │
       ├─> 2. Fetches VAA from Hermes API
       │      GET https://hermes.pyth.network/v2/updates/price/latest
       │      ?ids[]=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
       │      &publish_time=<windowEnd>
       │
       ↓
┌──────────────────────────────────────────────────┐
│                 Blockchain (Base)                │
│                                                  │
│  ┌────────────┐        3. Call settle()         │
│  │  PariHook  │ <─────────────────────────────  │
│  │            │                                  │
│  │  settle()  │                                  │
│  │     ↓      │                                  │
│  │  Parses    │ ───> 4. parsePriceFeedUpdates() │
│  │  Pyth VAA  │      (verifies signatures)      │
│  └────────────┘ <─── 5. Returns price + time    │
│                                                  │
│  ┌────────────┐                                  │
│  │   Pyth     │  On-chain price verification    │
│  │  Contract  │  (0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a) │
│  └────────────┘                                  │
│                                                  │
└──────────────────────────────────────────────────┘
```

## How It Works

### 1. Keeper Script (Off-chain)

```typescript
// Pseudocode for keeper script
async function settlementLoop() {
  while (true) {
    const currentTime = Date.now() / 1000;
    const currentWindow = Math.floor((currentTime - gridEpoch) / windowDuration);

    // Check if current window has ended and is unsettled
    const windowEnd = gridEpoch + (currentWindow * windowDuration);
    if (currentTime >= windowEnd && !isSettled(currentWindow)) {
      // Fetch Pyth price VAA at windowEnd timestamp
      const pythVAA = await fetchPythPrice(PYTH_PRICE_FEED_ID, windowEnd);

      // Submit settlement transaction
      await pariHook.settle(poolKey, currentWindow, pythVAA);
    }

    await sleep(5000); // Poll every 5 seconds
  }
}

async function fetchPythPrice(feedId: string, timestamp: number): Promise<bytes> {
  const response = await fetch(
    `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}&publish_time=${timestamp}`
  );
  const data = await response.json();
  return data.binary.data; // VAA (Verifiable Action Approval)
}
```

### 2. On-Chain Settlement

```solidity
function settle(
    PoolKey calldata key,
    uint256 windowId,
    bytes calldata pythUpdateData  // VAA from Hermes API
) external nonReentrant {
    PoolId poolId = key.toId();
    GridConfig storage cfg = gridConfigs[poolId];
    Window storage window = windows[poolId][windowId];

    // Verify window has ended
    uint256 windowEnd = cfg.gridEpoch + ((windowId + 1) * cfg.windowDuration);
    require(block.timestamp >= windowEnd, "Window not ended");
    require(!window.settled && !window.voided, "Already settled/voided");

    // Parse Pyth price (validates VAA signature on-chain)
    uint256 closingPrice = _parsePythPrice(
        pythUpdateData,
        cfg.pythPriceFeedId,
        windowEnd
    );

    // Calculate winning cell
    uint256 winningCell = closingPrice / cfg.bandWidth;

    // ... (rest of settlement logic)
}
```

### 3. Pyth Contract Interaction

```solidity
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

IPyth public immutable pythOracle;

constructor(IPoolManager _poolManager, address _pythOracle) {
    poolManager = _poolManager;
    pythOracle = IPyth(_pythOracle);
    // ...
}

function _parsePythPrice(
    bytes calldata pythUpdateData,
    bytes32 priceFeedId,
    uint256 expectedTimestamp
) internal returns (uint256 price) {
    // Parse and verify the Pyth price update
    bytes[] memory updateData = new bytes[](1);
    updateData[0] = pythUpdateData;

    PythStructs.Price memory pythPrice = pythOracle.parsePriceFeedUpdates{value: msg.value}(
        updateData,
        new bytes32[](1), // price feed IDs
        expectedTimestamp, // min publish time
        expectedTimestamp + 2 // max publish time (±2s buffer)
    )[0];

    // Verify timestamp matches window end
    require(
        pythPrice.publishTime >= expectedTimestamp - 2 &&
        pythPrice.publishTime <= expectedTimestamp + 2,
        "Price timestamp mismatch"
    );

    // Convert Pyth price to USDC 6-decimal format
    // Pyth prices have variable exponents (typically -8 for USD pairs)
    int32 expo = pythPrice.expo; // e.g., -8
    int64 basePrice = pythPrice.price; // e.g., 300120000000 (ETH = $3001.20)

    // Convert to 6-decimal USDC: price * 10^(6 - expo)
    if (expo < -6) {
        // Pyth has more decimals, divide
        price = uint256(uint64(basePrice)) / (10 ** uint32(-expo - 6));
    } else if (expo > -6) {
        // Pyth has fewer decimals, multiply
        price = uint256(uint64(basePrice)) * (10 ** uint32(6 + expo));
    } else {
        // Exact match
        price = uint256(uint64(basePrice));
    }

    return price;
}
```

## Key Points

### No Adapter Contract Needed

- **Direct Integration**: PariHook calls Pyth's contract directly via `parsePriceFeedUpdates()`
- **On-Chain Verification**: Pyth verifies the VAA signatures on-chain (no trust needed)
- **Single Point of Truth**: All price verification logic is in PariHook.sol

### Why This Model?

1. **Point-in-Time Accuracy**: We need the price at a specific `windowEnd` timestamp, not "latest" price
2. **Cost Efficiency**: Pay for price updates only when settling (not continuous updates)
3. **Permissionless**: Anyone can call `settle()` - keeper is optional (but ensures timely settlement)
4. **Cryptographic Security**: VAAs are signed by Pyth's validator network (Byzantine fault tolerant)

### Update Fees

Pyth charges a small fee for parsing price updates (typically ~$0.01). This fee is paid in native ETH via `msg.value`:

```solidity
// Keeper estimates update fee and includes it in the transaction
uint256 updateFee = pythOracle.getUpdateFee(updateData);
pariHook.settle{value: updateFee}(poolKey, windowId, pythVAA);
```

## Pyth Contract Addresses

| Network | Pyth Contract Address |
|---------|----------------------|
| Base Mainnet | `0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a` |
| Base Sepolia | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |

Source: https://docs.pyth.network/price-feeds/contract-addresses/evm

## Price Feed IDs

Common price feeds for ETH Ride:

| Asset Pair | Feed ID |
|------------|---------|
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |

Full list: https://pyth.network/developers/price-feed-ids

## Implementation Checklist

- [x] Research Pyth Network (completed)
- [x] Add Pyth SDK dependency to foundry.toml
- [x] Import Pyth contracts in PariHook.sol
- [x] Implement `_parsePythPrice()` helper function
- [x] Implement `settle()` function
- [x] Create settlement test suite with mock Pyth VAAs (Settlement.t.sol - 15 tests passing)
- [x] Create real Pyth integration tests (SettlementIntegration.t.sol)
- [ ] Build TypeScript keeper script (~100 lines)
- [ ] Test end-to-end settlement on testnet
- [ ] Deploy to Base Sepolia testnet

## Testing with Real Pyth Network Prices

### Quick Test Script

Run the Pyth integration test script to fetch real ETH/USD prices:

```bash
# Copy .env.example to .env and add your RPC URL
cp .env.example .env

# Edit .env and add:
# BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Load environment
source .env

# Run integration script
forge script script/TestPythIntegration.s.sol:TestPythIntegration \
  --fork-url $BASE_SEPOLIA_RPC_URL \
  -vvvv
```

This will display:
- Current ETH/USD and BTC/USD prices from Pyth
- Raw Pyth format (price, expo, conf, publishTime)
- Converted human-readable price
- USDC 6-decimal format (used by PariHook)
- Grid cell mapping (cellId, price range)
- Pyth update fee in wei/ETH/USD

### Integration Tests

Run full integration tests with real Pyth oracle:

```bash
# Run all integration tests
forge test --match-contract SettlementIntegrationTest --fork-url $BASE_SEPOLIA_RPC_URL -vvv

# Run specific test
forge test --match-test test_FetchRealPythPrice_CurrentETHPrice --fork-url $BASE_SEPOLIA_RPC_URL -vvv
```

Integration test coverage:
- `test_FetchRealPythPrice_CurrentETHPrice()` - Fetch and verify current ETH price
- `test_FetchRealPythPrice_WithUpdateFee()` - Query and validate update fees
- `test_PriceConversion_RealPythData()` - Test price conversion with real data
- `test_SettlementWithRealPythPrice()` - Simulate settlement with real prices

### Mock vs Real Testing

**Mock Tests (Settlement.t.sol)**
- Use `MockPythOracle` for isolated unit testing
- No network dependency
- Fast execution
- Controlled price scenarios
- Run without fork: `forge test --match-contract SettlementTest`

**Integration Tests (SettlementIntegration.t.sol)**
- Use real Pyth oracle on Base Sepolia
- Requires network connection via fork
- Tests actual network integration
- Validates real-world price handling
- Run with fork: `forge test --match-contract SettlementIntegrationTest --fork-url $BASE_SEPOLIA_RPC_URL`

### Environment Variables

Create a `.env` file (never commit this):

```bash
# Base Sepolia RPC
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Pyth Oracle (DO NOT CHANGE)
PYTH_ORACLE_SEPOLIA=0xA2aa501b19aff244D90cc15a4Cf739D2725B5729

# Price Feed IDs (official Pyth feeds)
ETH_USD_FEED_ID=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
BTC_USD_FEED_ID=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
```

## References

- **Pyth Docs**: https://docs.pyth.network/
- **EVM Integration**: https://docs.pyth.network/price-feeds/use-real-time-data/evm
- **Pull Oracle Model**: https://docs.pyth.network/price-feeds/how-pyth-works/pull-updates
- **Hermes API**: https://hermes.pyth.network/docs/
