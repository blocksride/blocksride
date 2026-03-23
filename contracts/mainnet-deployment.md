# Mainnet Deployment

## PariHook
- Hook address: `0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000`
- Deployment tx: `0xae35c7ca88d4da22a847673a77faa46c89ade115b0c9e653646198e45fec1456`
- Deployment block: `43742250`
- PoolManager: `0x498581fF718922c3f8e6A244956aF099B2652b2b`
- Pyth: `0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Roles
- DEFAULT_ADMIN / deployer: ``
- ADMIN_ROLE: ``
- TREASURY_ROLE: `0x4F832f59944ffD7e480Bd851a628419cb64140A4`
- RELAYER_ROLE: `0x4792F66EB24454D328Ac6F606802FBb13a4F13Fe`

## Uniswap v4 Pool Key
Important: Uniswap v4 requires sorted currencies. The live mainnet pool key uses native ETH first and USDC second.

- `currency0`: `0x0000000000000000000000000000000000000000`
- `currency1`: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- `fee`: `0`
- `tickSpacing`: `60`
- `hooks`: `0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000`
- `poolId`: `0x7b2a83b08744910a4c2308f93c3cf773bca48c13bf8fc509b533a5d884e72341`

## Grid Configuration
- Price feed: `ETH/USD`
- Feed ID: `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`
- `bandWidth`: `2_000_000` (`$2.00`)
- `windowDuration`: `60`
- `frozenWindows`: `3`
- `maxStakePerCell`: `100_000_000_000`
- `feeBps`: `200`
- `minPoolThreshold`: `1_000_000`
- `gridEpoch`: `1774275360` (`2026-03-23 14:16:00 UTC`)

Grid was verified on-chain from `gridConfigs(poolId)`.

## Post-Deployment Transactions
### configureGrid
- Tx: `0x6c058afca41605f98d0882a3fc6e0c431dbd8881571da16acf8c11d6893e64fa`
- Block: `43742571`
- Status: `success`

### PoolManager.initialize
- Tx: `0x6cf881dd950cf0401b211a4b8815d469a8bc9b61502ab585230c02b6fa7a7316`
- Block: `43742600`
- Status: `success`
- Initialized tick: `-199412`

## Local Env Updates Applied
### `blocksride-next-server/.env.local`
- `NEXT_PUBLIC_NETWORK=mainnet`
- `NETWORK=mainnet`
- `RPC_URL=https://base.drpc.org`
- `PARIHOOK_CONTRACT_ADDRESS=0x04b1AEd77e93D4FD2Ac23B02454C481C3271e000`
- `USDC_TOKEN_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- `PYTH_CONTRACT_ADDRESS=0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a`
- `KEEPER_POOLS` updated to the sorted mainnet pool key above
- `fromBlock=43742600`

### `blocksride/client/.env.local`
- `VITE_NETWORK=mainnet`
- `VITE_TOKEN_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Scripts Used
### Deployment
- `contracts/script/DeployPariHook.s.sol`

### Configure + Initialize
- `contracts/script/ConfigureAndInitializePariHook.s.sol`

## Notes
- The mainnet hook was deployed with CREATE2 and the correct Uniswap v4 hook flag pattern for `beforeInitialize` only.
- The old unsorted `USDC -> native` pool key should not be used for mainnet reads or writes.
- Starting `blocksride-next-server` with workers enabled will make it operate on Base mainnet using the addresses above.
