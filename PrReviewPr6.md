# PR Review: `pr-6` vs `main`

## Findings

### High

1. `useTokenBalance` still reads the first Privy wallet, not the authenticated wallet  
   File: `client/src/hooks/useTokenBalance.ts:22`  
   The PR moves contest gating, funding prompts, and wallet display to on-chain USDC balance, but this hook still picks the first wallet returned by `useWallets()`. In a multi-wallet/multi-account Privy session, the app can show and gate against the wrong wallet balance. This directly affects `ContestRequirements`, `ContestHub`, `Terminal`, `WalletManager`, and `GridVisualizer`.

2. Real-mode positions are reconstructed from `BetPlaced` logs as permanently `ACTIVE`  
   File: `client/src/hooks/useGridPositions.ts:62`  
   The new on-chain path only reads `BetPlaced` and maps every log to a synthetic position with `state: 'ACTIVE'`. It does not read any resolution/claim state, so old bets never leave active state, `totalActiveStake` can grow incorrectly, and the UI can misreport resolved or claimed positions as still open.

### Medium

3. Contest refresh was reduced to 5 minutes, which is too slow for a 60-second market  
   File: `client/src/contexts/ContestContext.tsx:136`  
   The new polling interval is `300000ms`. For a minute-based market, that means contest transitions can remain stale for several windows. Users can sit on outdated active/upcoming state long after the backend has moved on.

## Open Questions

- Is `GuestTerminal` intended to show “Trading disabled in REST-only mode” for every authenticated user, or only when `VITE_REST_ONLY === 'true'`?  
  File: `client/src/components/terminal/GuestTerminal.tsx:262`

## Test Gaps

- No coverage for multi-wallet Privy sessions after switching all balance checks to on-chain reads.
- No coverage for resolved/claimed real-mode positions after replacing API-backed positions with on-chain log reconstruction.
- No coverage for contest status freshness with the new 5-minute polling cadence.
