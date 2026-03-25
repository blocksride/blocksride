# BlocksRide Market Participant Skill

This document is for agents that need to reason about the live BlocksRide market on Base mainnet.

## Live Contracts

- Network: Base mainnet
- Chain ID: `8453`
- Hook contract (`PariHook`): `0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000`
- PoolManager: `0x498581fF718922c3f8e6A244956aF099B2652b2b`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Pyth: `0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a`
- PoolId: `0x7b2a83b08744910a4c2308f93c3cf773bca48c13bf8fc509b533a5d884e72341`
- ETH/USD feed ID: `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`

## Live Market Configuration

- `gridEpoch = 1774275360`
- `windowDuration = 60` seconds
- `frozenWindows = 3`
- `bandWidth = 2_000_000`
- `feeBps = 200`
- `minPoolThreshold = 1_000_000`

Interpretation:

- Each window is `60` seconds wide.
- Bands are `$2.00` wide because prices use 6 decimals and `2_000_000 = $2.00`.
- The immediate next few windows are not bettable because `frozenWindows = 3`.

## Pool Key

Use the sorted Uniswap v4 pool key:

```json
{
  "currency0": "0x0000000000000000000000000000000000000000",
  "currency1": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "fee": 0,
  "tickSpacing": 60,
  "hooks": "0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000"
}
```

## External Read Functions

Agents can use these `PariHook` view functions:

- `currentWindowId(PoolKey key) -> uint256`
- `getCurrentWindow(PoolKey key) -> uint256`
- `getWindow(PoolKey key, uint256 windowId) -> (totalPool, settled, voided, unresolved, winningCell, redemptionRate)`
- `getUnresolvedWindows(PoolKey key) -> uint256[]`
- `getBettableWindows(PoolKey key) -> (uint256 startWindowId, uint256 endWindowId)`
- `getUserStake(PoolKey key, uint256 windowId, uint256 cellId, address user) -> uint256`
- `getCellStake(PoolKey key, uint256 windowId, uint256 cellId) -> uint256`
- `getCellStakes(PoolKey key, uint256 windowId, uint256[] cellIds) -> uint256[]`
- `getUserStakes(PoolKey key, uint256 windowId, address user, uint256[] cellIds) -> uint256[]`
- `calculatePayout(PoolKey key, uint256 windowId, uint256 cellId, address user) -> uint256`
- `getLiveMultiplier(PoolKey key, uint256 windowId, uint256 cellId) -> uint256`
- `hasPendingClaim(PoolKey key, uint256 windowId, address user) -> bool`
- `getPendingClaims(PoolKey key, uint256[] windowIds, address user) -> uint256 totalUnclaimed`

## External Write Functions

Agents can reason about these `PariHook` external state-changing functions:

- `placeBet(PoolKey key, uint256 cellId, uint256 windowId, uint256 amount)`
- `placeBetWithSig(PoolKey key, uint256 cellId, uint256 windowId, uint256 amount, address user, uint256 nonce, uint256 deadline, bytes sig)`
- `permitAndPlaceBet(PoolKey key, uint256 cellId, uint256 windowId, uint256 amount, uint256 permitAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `seedWindow(PoolKey key, uint256 cellId, uint256 windowId, uint256 amount)`
- `settle(PoolKey key, uint256 windowId, bytes pythUpdateData)`
- `finalizeUnresolved(PoolKey key, uint256 windowId)`
- `pushPayouts(PoolKey key, uint256 windowId, address[] winners)`
- `claimAll(PoolKey key, uint256[] windowIds)`
- `claimAllFor(PoolKey key, uint256[] windowIds, address user, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `claimRefund(PoolKey key, uint256 windowId)`
- `depositBackstop(PoolKey key, uint256 windowId, uint256 amount)`
- `voidWindow(PoolKey key, uint256 windowId)`
- `withdrawFees(PoolKey key, uint256 amount)`

## Window Calculation

The contract computes the current window from the epoch:

```text
currentWindowId =
  0, if block.timestamp < gridEpoch
  floor((block.timestamp - gridEpoch) / windowDuration), otherwise
```

With the live config:

```text
currentWindowId = floor((unixTime - 1774275360) / 60)
```

Window start and end:

```text
windowStart = gridEpoch + (windowId * windowDuration)
windowEnd = windowStart + windowDuration
```

Example:

- If `windowId = 10`
- `windowStart = 1774275360 + (10 * 60) = 1774275960`
- `windowEnd = 1774276020`

## Bettable Window Calculation

The contract does not allow betting on the immediate near-term windows.

```text
bettableStart = currentWindowId + frozenWindows + 1
```

With `frozenWindows = 3`:

```text
bettableStart = currentWindowId + 4
```

So if `currentWindowId = 100`, the first bettable window is `104`.

Agents should prefer `getBettableWindows(...)` when available instead of recomputing locally.

## Cell Calculation

The winning cell is derived from the settlement price:

```text
winningCell = floor(openingPrice / bandWidth)
```

With the live config:

```text
winningCell = floor(price_6_decimals / 2_000_000)
```

Because price uses 6 decimals:

```text
cellId = floor(priceUsd / 2)
```

Examples:

- `$3,844.00` to `$3,845.999999` maps to `cellId = 1922`
- `$3,846.00` to `$3,847.999999` maps to `cellId = 1923`

Band bounds for a cell:

```text
bandLowUsd = cellId * 2
bandHighUsd = bandLowUsd + 2
```

Example:

- `cellId = 1922`
- band is `$3844.00` to `$3846.00`

## Worked Example

Given:

- `price = $3,845.27`
- `price_6_decimals = 3_845_270_000`

Then:

```text
cellId = floor(3_845_270_000 / 2_000_000) = 1922
```

If the current Unix timestamp is `1774276025`:

```text
currentWindowId = floor((1774276025 - 1774275360) / 60) = 11
bettableStart = 11 + 4 = 15
```

So an agent should not choose windows below `15`.

## How To Read Market State

### Viem example

```ts
const poolKey = {
  currency0: '0x0000000000000000000000000000000000000000',
  currency1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  fee: 0,
  tickSpacing: 60,
  hooks: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
} as const

const currentWindow = await publicClient.readContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'currentWindowId',
  args: [poolKey],
})

const [bettableStart, bettableEnd] = await publicClient.readContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'getBettableWindows',
  args: [poolKey],
})

const windowState = await publicClient.readContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'getWindow',
  args: [poolKey, 15n],
})
```

### Cast examples

```bash
POOL_KEY='(0x0000000000000000000000000000000000000000,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,0,60,0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000)'
HOOK=0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000
RPC=https://mainnet.base.org

cast call $HOOK \
  "currentWindowId((address,address,uint24,int24,address))(uint256)" \
  "$POOL_KEY" \
  --rpc-url $RPC

cast call $HOOK \
  "getBettableWindows((address,address,uint24,int24,address))(uint256,uint256)" \
  "$POOL_KEY" \
  --rpc-url $RPC

cast call $HOOK \
  "getWindow((address,address,uint24,int24,address),uint256)(uint256,bool,bool,bool,uint256,uint256)" \
  "$POOL_KEY" 15 \
  --rpc-url $RPC
```

## How To Choose A Window And Cell

1. Read `currentWindowId` or `getBettableWindows`.
2. Pick a `windowId >= bettableStart`.
3. Convert a target ETH/USD price into a `cellId` using `$2` bands.
4. Submit the bet for that `(windowId, cellId)` pair.

Example:

- Live ETH target price: `$3,851.22`
- `cellId = floor(3851.22 / 2) = 1925`
- If `bettableStart = 15`, then a valid target might be `windowId = 15` and `cellId = 1925`

## How To Place A Bet

### Direct transaction

Use `placeBet(...)` when the user submits their own transaction and pays gas.

```ts
await walletClient.writeContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'placeBet',
  args: [poolKey, 1925n, 15n, 1_000_000n],
})
```

Here `1_000_000` means `1.0 USDC` because USDC has 6 decimals.

### Gasless signed bet

Use `placeBetWithSig(...)` when a relayer submits the transaction.

Required signed fields:

- `user`
- `poolId`
- `cellId`
- `windowId`
- `amount`
- `nonce`
- `deadline`

Practical flow:

1. Read `betNonces[user]` from the backend or contract.
2. Sign the EIP-712 bet intent.
3. Send the signature to the relayer.
4. Relayer calls `placeBetWithSig(...)`.

### Permit + bet

Use `permitAndPlaceBet(...)` when the user needs to authorize USDC and place the bet in one flow.

Important:

- the permit spender is the hook contract itself
- spender = `0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000`
- not the relayer

If the user signs an EIP-2612 permit, the spender must be the hook address above.

## How To Check Claims

### Pending claim status

```ts
const hasClaim = await publicClient.readContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'hasPendingClaim',
  args: [poolKey, 15n, userAddress],
})
```

### Aggregate unclaimed value

```ts
const totalUnclaimed = await publicClient.readContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'getPendingClaims',
  args: [poolKey, [15n, 16n, 17n], userAddress],
})
```

### Claim winnings

```ts
await walletClient.writeContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'claimAll',
  args: [poolKey, [15n, 16n, 17n]],
})
```

### Claim refund from a voided window

```ts
await walletClient.writeContract({
  address: '0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000',
  abi: pariHookAbi,
  functionName: 'claimRefund',
  args: [poolKey, 15n],
})
```

## Settlement Notes

- Settlement is based on the opening price at `windowStart`.
- `settle(...)` attempts to resolve using a Pyth price in `[windowStart, windowStart + 10s]`.
- If Pyth has no price in range before the resolution deadline, the window can be marked unresolved.
- After the deadline, unresolved windows can be finalized and voided with `finalizeUnresolved(...)`.
- `pushPayouts(...)` requires a winner address list and does not enumerate winners by itself.

## Practical Agent Rules

- Treat `getBettableWindows(...)` as the source of truth for valid target windows.
- Treat `getWindow(...)` as the source of truth for settled, voided, unresolved, `winningCell`, and `redemptionRate`.
- Use the sorted pool key shown above.
- Use Base mainnet USDC, not Base Sepolia USDC.
- Use `$2` bands when converting a price to `cellId`.
- Do not assume the current window is bettable.
- For permit flows, the spender is the hook, not the relayer.
- For claims, use `hasPendingClaim(...)` or `getPendingClaims(...)` for a known user and window set.
