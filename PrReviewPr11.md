# PR Review: `pr-11` vs `main`

## Findings

### High

1. Full RIDE supply can still be minted to the deployer instead of `RideDistributor`
   File: `contracts/script/DeployRIDE.s.sol:14`
   `DeployRIDE.s.sol` defaults `RIDE_DISTRIBUTOR` to the deployer EOA, and `RIDE.sol` mints the entire 100M supply to whatever `initialDistributor` is passed in. That violates the documented invariant that all supply is minted to `RideDistributor.sol` at deploy time and creates a real footgun: one missing env var leaves the deployer holding the whole supply.
   Relevant code:
   - `contracts/script/DeployRIDE.s.sol:14`
   - `contracts/script/DeployRIDE.s.sol:22`
   - `contracts/src/RIDE.sol:23`
   - `contracts/src/RIDE.sol:31`
   Docs:
   - `blocksride-docs/tokenomics.md:13`
   - `blocksride-docs/tokenomics.md:15`

2. The PR collapses the documented role model into a single `owner`
   Files:
   - `contracts/src/RIDE.sol:10`
   - `contracts/src/RideDistributor.sol:12`
   - `contracts/src/RideStaking.sol:10`
   The docs require separated `DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `TREASURY_ROLE`, and `RELAYER_ROLE`, with the cold admin only granting roles and operational wallets kept narrow. The new token contracts use `Ownable` only, so one address controls transfer restrictions, reward emissions, airdrop root updates, and any future operational changes. That removes the blast-radius reduction the docs explicitly call for.
   Docs:
   - `blocksride-docs/prd.md:414`
   - `blocksride-docs/prd.md:474`

### Medium

3. “V1 transfers only for stake/unstake/claim” is not enforced as an invariant
   File: `contracts/src/RIDE.sol:34`
   The owner can whitelist any arbitrary EOA or simply call `setTransfersRestricted(false)`. That means V1 non-transferability is governance policy, not a protocol guarantee. If that is intended, the docs should say so. If it is not intended, this needs narrower permissions or one-way gating.
   Relevant code:
   - `contracts/src/RIDE.sol:34`
   - `contracts/src/RIDE.sol:40`
   Docs:
   - `blocksride-docs/tokenomics.md:97`

4. The PR adds token contracts, but not the deployment wiring for distributor/staking ownership and permissions
   File: `contracts/script/DeployRIDE.s.sol:10`
   There is a deployment script for `RIDE.sol`, but no equivalent deployment/setup script for `RideDistributor.sol` and `RideStaking.sol`, and no scripted ownership handoff. Given the current `Ownable` design, that leaves too much room for incorrect manual setup of token custody and admin control.

## Open Questions

- Is the intent to keep the PRD/architecture role model (`AccessControl` with separated wallets), or to deliberately simplify Phase 2 to single-owner control?
- If single-owner is intentional for testnet, should the docs be downgraded to describe that temporary model explicitly?

## Test Gaps

- No test proves the deploy path mints directly to `RideDistributor.sol` rather than an arbitrary distributor address.
- No test covers ownership/permission handoff for `RideDistributor` and `RideStaking`.
- No test asserts that only staking/distributor claim paths remain usable while transfer restrictions are enabled.
