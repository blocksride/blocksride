# Testing with Real Pyth Network Prices

This guide shows how to test the PariHook settlement system with real ETH/USD prices from Pyth Network on Base Sepolia.

## Quick Start

### 1. Setup Environment

```bash
# Copy the example environment file
cp .env.example .env

# Get a free RPC URL from:
# - Alchemy: https://www.alchemy.com (recommended)
# - Infura: https://www.infura.io
# - Chainstack: https://www.chainstack.com

# Edit .env and add your RPC URL:
# BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
```

### 2. Test Real Price Fetching

```bash
# Load environment variables
source .env

# Run the Pyth integration test script
forge script script/TestPythIntegration.s.sol:TestPythIntegration \
  --fork-url $BASE_SEPOLIA_RPC_URL \
  -vvvv
```

**Expected Output:**
```
============================================
  PYTH NETWORK INTEGRATION TEST
  Base Sepolia Testnet
============================================

Testing: ETH/USD
Feed ID: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

Raw Pyth Data:
  price (int64): 250120000000
  expo (int32): -8
  conf (confidence): 81240000
  publishTime: 1709856234

Converted Price:
  $ 2501

USDC 6-Decimal Format:
  value: 2501200000
  dollars: 2501

Grid Cell Mapping:
  cellId: 1250
  range: $ 2500 - $ 2502

...
```

### 3. Run Integration Tests

```bash
# Run all integration tests with real Pyth oracle
forge test --match-contract SettlementIntegrationTest \
  --fork-url $BASE_SEPOLIA_RPC_URL \
  -vvv

# Run specific test
forge test --match-test test_FetchRealPythPrice_CurrentETHPrice \
  --fork-url $BASE_SEPOLIA_RPC_URL \
  -vvv
```

## Available Tests

### Integration Tests (SettlementIntegration.t.sol)
Uses **real Pyth oracle** on Base Sepolia:

- `test_FetchRealPythPrice_CurrentETHPrice()` - Fetch current ETH/USD price
- `test_FetchRealPythPrice_WithUpdateFee()` - Query Pyth update fees
- `test_PriceConversion_RealPythData()` - Test price conversion logic
- `test_SettlementWithRealPythPrice()` - Simulate settlement flow

**Requires:** `--fork-url $BASE_SEPOLIA_RPC_URL`

### Mock Tests (Settlement.t.sol)
Uses **mock oracle** for unit testing:

- 15 tests covering settlement, rollover, void scenarios
- No network dependency
- Fast execution

**Run without fork:** `forge test --match-contract SettlementTest`

## What Gets Tested

### 1. Price Fetching
✅ Connect to real Pyth oracle contract
✅ Fetch current ETH/USD price
✅ Validate price format (price, expo, conf, publishTime)
✅ Verify price is within reasonable range ($1000-$10000)

### 2. Price Conversion
✅ Convert Pyth format to USDC 6-decimal
✅ Handle various exponents (positive, negative, zero)
✅ Match PariHook._parsePythPrice() logic

### 3. Grid Mapping
✅ Calculate cell ID from price
✅ Determine cell price range ($2 bands)
✅ Verify cell boundaries

### 4. Update Fees
✅ Query Pyth update fee
✅ Verify fee is reasonable (~0.01 ETH)
✅ Confirm fee payment mechanism works

## Pyth Network Details

### Contracts
| Network | Address |
|---------|---------|
| Base Sepolia | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |
| Base Mainnet | `0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a` |

### Price Feed IDs
| Pair | Feed ID |
|------|---------|
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |

Full list: https://pyth.network/developers/price-feed-ids

## Production Deployment Flow

When ready to deploy to Base Sepolia testnet:

1. **Update .env with deployment keys:**
   ```bash
   PRIVATE_KEY=0x...          # Deployer wallet
   ADMIN_ADDRESS=0x...        # Admin role
   TREASURY_ADDRESS=0x...     # Treasury role
   RELAYER_ADDRESS=0x...      # Relayer role
   ```

2. **Deploy contracts:**
   ```bash
   forge script script/Deploy.s.sol:Deploy \
     --rpc-url $BASE_SEPOLIA_RPC_URL \
     --broadcast \
     --verify \
     -vvvv
   ```

3. **Test settlement with real keeper:**
   - Keeper fetches VAA from Hermes API
   - Keeper calls `settle{value: updateFee}(poolKey, windowId, vaa)`
   - Contract verifies price and settles window

## Troubleshooting

### "VM::skip" errors
**Cause:** Running integration tests without fork
**Fix:** Add `--fork-url $BASE_SEPOLIA_RPC_URL`

### "Failed to get EVM version" errors
**Cause:** Invalid or missing RPC URL
**Fix:** Check `.env` file has correct `BASE_SEPOLIA_RPC_URL`

### "Price outside reasonable range" failures
**Cause:** ETH price moved significantly
**Fix:** Update test assertions if ETH is genuinely outside $1000-$10000 range

### Fork RPC rate limits
**Cause:** Free tier RPC limits
**Solution:** Use Alchemy/Infura Growth tier or run tests less frequently

## Next Steps

After successful integration testing:

1. ✅ Price fetching verified
2. ✅ Conversion logic validated
3. ⏳ Build keeper script (TypeScript)
4. ⏳ Deploy to Base Sepolia
5. ⏳ End-to-end settlement test
6. ⏳ Mainnet deployment (after audit)

## Documentation

- **Pyth Docs:** https://docs.pyth.network/
- **EVM Integration:** https://docs.pyth.network/price-feeds/use-real-time-data/evm
- **Hermes API:** https://hermes.pyth.network/docs/
- **Pull Oracle Model:** https://docs.pyth.network/price-feeds/how-pyth-works/pull-updates

## Support

If you encounter issues:
1. Check Pyth Network status: https://pyth.network/
2. Verify RPC URL is working: `curl $BASE_SEPOLIA_RPC_URL`
3. Review test output with `-vvvv` flag for detailed logs
4. Check Pyth Discord: https://discord.gg/pythnetwork
