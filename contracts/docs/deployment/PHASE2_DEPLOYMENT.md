# Phase 2 Deployment - RIDE System (Base Sepolia)

**Date:** March 6, 2026  
**Network:** Base Sepolia (84532)

## Contracts

- `RIDE`: `0x0448E60F52021015D98BcD10252508Ce118AdCB6`
- `RideStaking`: `0x2cE4ACcD168aa7eb8B2B5b13Fa69e6CeBecA3b46`
- `RideDistributor`: `0x8aa1B67C99dBE706D1b9111f8429c25359a4A4F4`

## Deployment Transactions

- Deploy `RIDE`: `0x0c1dbc9b79f225805ccddc6dacbb44bbdf32216311bef2d9b3f060a9ecf7e04a`
- Deploy `RideStaking`: `0xe9df27558df96e8425f246399b2ff8e72499be6d8e53205d3000551457550277`
- Deploy `RideDistributor`: `0xa600dd533bc817c71fc8d7ef54d1205eb050c2bc8d489a5cca5561d8f7cec449`

## Setup Transactions

- Whitelist `RideStaking` in RIDE: `0xe14313ac7718d6b9e659a2b454cff98b6a6289d955a4b6fcf26e8ac3f7a74e09`
- Whitelist `RideDistributor` in RIDE: `0x4056573d99efacd6394b59ab06e2c9ad1c014c5edb3dc4710b16a3f82144bce0`
- Transfer full supply to distributor: `0x50503d2c3a178277644d2a1b33b42d985d32b173290f4e0233292e34356fda91`

## Verification Snapshot

- `RIDE.totalSupply()` = `100000000000000000000000000` (100M)
- Deployer `RIDE.balanceOf` = `0`
- Distributor `RIDE.balanceOf` = `100000000000000000000000000` (100M)
- `isTransferWhitelisted(RideStaking)` = `true`
- `isTransferWhitelisted(RideDistributor)` = `true`

