# Phase 2 RIDE System Structure

## Contracts

### `src/RIDE.sol`
- ERC20 + ERC20Permit token (`BlocksRide`, `RIDE`)
- Fixed supply: `100_000_000e18`
- Constructor mints full supply to an explicit `initialDistributor` contract address
- V1 transfer restrictions:
  - transfer allowed only when sender or receiver is whitelisted
  - mint/burn paths always allowed
- AccessControl roles:
  - `DEFAULT_ADMIN_ROLE` (cold role management)
  - `ADMIN_ROLE` (system transfer whitelist management)
  - `TREASURY_ROLE`
  - `RELAYER_ROLE`
- No owner fallback and no post-deploy mint path
- No global "disable restrictions" switch in V1

### `src/RideStaking.sol`
- Stake RIDE and derive fee discount tiers
- Uses AccessControl role separation for operational governance
- Core functions:
  - `stake(uint256)`
  - `initiateUnstake(uint256)` (starts cooldown)
  - `completeUnstake()` (after 7 days)
  - `getUserFeeBps(address)` (200/150/100/50 bps)

### `src/RideDistributor.sol`
- Uses AccessControl role separation for emissions/treasury operations
- Emission period management:
  - `createEmissionPeriod(start,end,allocation)`
- Reward allocations:
  - `allocateWindowReward(periodId,user,poolId,windowId,amount)`
  - `claimBetRewards(poolId,windowIds[])`
- Airdrop support:
  - `setAirdropMerkleRoot(bytes32)`
  - `claimAirdrop(bytes32[] proof, uint256 amount)`
- One-time token wiring:
  - `setRideToken(address)` (admin-only, can only be called once)

### `script/DeployRIDE.s.sol`
- Deploys and wires `RideDistributor`, `RIDE`, and `RideStaking` end-to-end
- Env support:
  - `PRIVATE_KEY` (required)
  - `RIDE_COLD_ADMIN` (required)
  - `RIDE_ADMIN` (required)
  - `RIDE_TREASURY` (required)
  - `RIDE_RELAYER` (required)

## Tests

### `test/RIDE.t.sol`
- max supply minted to distributor
- restricted transfer reverts for non-whitelisted path
- staking/distributor whitelisted flow succeeds
- admin-only whitelist access
- no further minting path
- role handoff (admin rotation) works

### `test/RideStaking.t.sol`
- stake accounting updates
- fee tier computation at thresholds
- unstake flow with cooldown enforcement
- role assignment checks

### `test/RideDistributor.t.sol`
- allocate rewards within active period + cap
- claim aggregated rewards across multiple windows
- airdrop merkle claim success
- double-claim airdrop revert
- cap overflow revert
- treasury-only privileged actions
- one-time token set protection
- role handoff (treasury rotation) works
