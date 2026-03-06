# Phase 2 RIDE System Structure

## Contracts

### `src/RIDE.sol`
- ERC20 + ERC20Permit token (`BlocksRide`, `RIDE`)
- Fixed supply: `100_000_000e18`
- Constructor mints full supply to an `initialDistributor` address
- V1 transfer restrictions:
  - transfer allowed only when sender or receiver is whitelisted
  - mint/burn paths always allowed
- Owner controls:
  - `setTransferWhitelist(address,bool)`
  - `setTransfersRestricted(bool)` for future V2 unlock

### `src/RideStaking.sol`
- Stake RIDE and derive fee discount tiers
- Core functions:
  - `stake(uint256)`
  - `initiateUnstake(uint256)` (starts cooldown)
  - `completeUnstake()` (after 7 days)
  - `getUserFeeBps(address)` (200/150/100/50 bps)

### `src/RideDistributor.sol`
- Emission period management:
  - `createEmissionPeriod(start,end,allocation)`
- Reward allocations:
  - `allocateWindowReward(periodId,user,poolId,windowId,amount)`
  - `claimBetRewards(poolId,windowIds[])`
- Airdrop support:
  - `setAirdropMerkleRoot(bytes32)`
  - `claimAirdrop(bytes32[] proof, uint256 amount)`

### `script/DeployRIDE.s.sol`
- Deploy helper for RIDE token
- Env support:
  - `PRIVATE_KEY` (required)
  - `RIDE_OWNER` (optional)
  - `RIDE_DISTRIBUTOR` (optional)

## Tests

### `test/RIDE.t.sol`
- max supply minted to distributor
- restricted transfer reverts for non-whitelisted path
- whitelisted path succeeds
- restrictions can be disabled
- owner-only whitelist access

### `test/RideStaking.t.sol`
- stake accounting updates
- fee tier computation at thresholds
- unstake flow with cooldown enforcement

### `test/RideDistributor.t.sol`
- allocate rewards within active period + cap
- claim aggregated rewards across multiple windows
- airdrop merkle claim success
- double-claim airdrop revert
- cap overflow revert

