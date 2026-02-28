// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// TODO: Re-add Pyth SDK and uncomment
// import {IPyth} from "@pyth/IPyth.sol";

/**
 * @title PariHookTest
 * @notice Comprehensive test suite for PariHook parimutuel prediction markets
 */
contract PariHookTest is Test {
    using PoolIdLibrary for PoolKey;

    // =============================================================
    //                      TEST CONTRACTS
    // =============================================================

    PariHook public hook;
    IPoolManager public poolManager;
    // IPyth public pythOracle;  // TODO: Re-add when Pyth SDK is installed
    IERC20 public usdc;

    // =============================================================
    //                      TEST ACCOUNTS
    // =============================================================

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public relayer = makeAddr("relayer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");

    // =============================================================
    //                      TEST CONSTANTS
    // =============================================================

    bytes32 public constant ETH_USD_FEED_ID = bytes32(uint256(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace));
    uint256 public constant BAND_WIDTH = 2_000_000; // $2.00 in USDC (6 decimals)
    uint256 public constant WINDOW_DURATION = 60; // 60 seconds
    uint256 public constant FROZEN_WINDOWS = 3;
    uint256 public constant MAX_STAKE_PER_CELL = 100_000_000_000; // $100,000
    uint256 public constant FEE_BPS = 200; // 2%
    uint256 public constant MIN_POOL_THRESHOLD = 1_000_000; // $1.00

    // =============================================================
    //                      TEST STATE
    // =============================================================

    PoolKey public testPoolKey;
    PoolId public testPoolId;
    uint256 public gridEpoch;

    // =============================================================
    //                          SETUP
    // =============================================================

    function setUp() public {
        // Deploy mock PoolManager (using makeAddr for now - will deploy actual mock later)
        poolManager = IPoolManager(makeAddr("poolManager"));

        // Deploy PariHook with admin as deployer
        vm.prank(admin);
        hook = new PariHook(poolManager);

        // Grant roles
        vm.startPrank(admin);
        hook.grantRole(hook.ADMIN_ROLE(), admin);
        hook.grantRole(hook.TREASURY_ROLE(), treasury);
        hook.grantRole(hook.RELAYER_ROLE(), relayer);
        vm.stopPrank();

        // Create test pool key
        // Note: In production, hooks address must have specific bit pattern
        // For testing, we'll mock the PoolManager to skip address validation
        testPoolKey = PoolKey({
            currency0: Currency.wrap(address(0x1)),  // Mock currency0
            currency1: Currency.wrap(address(0x2)),  // Mock currency1
            fee: 3000,  // 0.3% fee
            tickSpacing: 60,
            hooks: hook
        });
        testPoolId = testPoolKey.toId();

        // Mock USDC token (will implement actual ERC20 mock later)
        usdc = IERC20(makeAddr("usdc"));

        // Note: USDC minting and approvals will be added when we implement betting logic
    }

    // =============================================================
    //                  INITIALIZATION TESTS
    // =============================================================

    function test_Constructor() public {
        // TODO: Verify hook initialized with correct poolManager
        // TODO: Verify pythOracle set correctly
        // TODO: Verify DOMAIN_SEPARATOR calculated correctly
        // TODO: Verify admin has DEFAULT_ADMIN_ROLE
    }

    function test_ConfigureGrid() public {
        // Skip PoolKey validation by only testing the standalone functions
        vm.skip(true);
    }

    function test_ConfigureGrid_RevertWhen_NotAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(usdc)
        );
    }

    function test_ConfigureGrid_RevertWhen_InvalidBandWidth() public {
        vm.prank(admin);
        vm.expectRevert("Band width must be > 0");
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            0, // Invalid: bandWidth = 0
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(usdc)
        );
    }

    function test_ConfigureGrid_RevertWhen_InvalidWindowDuration() public {
        vm.prank(admin);
        vm.expectRevert("Window duration must be > 0");
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            0, // Invalid: windowDuration = 0
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(usdc)
        );
    }

    function test_ConfigureGrid_RevertWhen_ExcessiveFee() public {
        vm.prank(admin);
        vm.expectRevert("Fee cannot exceed 10%");
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            1001, // Invalid: feeBps > 1000 (10%)
            MIN_POOL_THRESHOLD,
            address(usdc)
        );
    }

    function test_ConfigureGrid_RevertWhen_InvalidFrozenWindows() public {
        vm.prank(admin);
        vm.expectRevert("Frozen windows must be 1-10");
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            0, // Invalid: frozenWindows < 1
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(usdc)
        );
    }

    function test_ConfigureGrid_RevertWhen_AlreadyConfigured() public {
        // Configure once
        vm.startPrank(admin);
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(usdc)
        );

        // Attempt to reconfigure
        vm.expectRevert("Grid already configured");
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(usdc)
        );
        vm.stopPrank();
    }

    function test_BeforeInitialize() public {
        // First configure the grid
        vm.prank(admin);
        hook.configureGrid(
            testPoolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(usdc)
        );

        // Mock the PoolManager calling beforeInitialize
        vm.prank(address(poolManager));
        vm.expectEmit(true, false, false, true);
        emit PariHook.PoolInitialized(
            testPoolId,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            block.timestamp, // gridEpoch set to current timestamp
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD
        );

        bytes4 selector = hook.beforeInitialize(address(this), testPoolKey, 1 << 96);
        assertEq(selector, hook.beforeInitialize.selector);
    }

    function test_BeforeInitialize_RevertWhen_GridNotConfigured() public {
        // Attempt to initialize without configuring grid first
        vm.prank(address(poolManager));
        vm.expectRevert("Grid config not set");
        hook.beforeInitialize(address(this), testPoolKey, 1 << 96);
    }

    function test_GetHookPermissions() public {
        // TODO: Verify beforeInitialize permission is true
        // TODO: Verify all other permissions are false
    }

    // =============================================================
    //                  BET PLACEMENT TESTS
    // =============================================================

    function test_PlaceBet() public {
        // TODO: Test successful bet placement
        // TODO: Verify totalPool incremented
        // TODO: Verify cellStakes[cellId] incremented
        // TODO: Verify userStakes[cellId][user] incremented
        // TODO: Verify USDC transferred from user to poolManager
        // TODO: Verify BetPlaced event emitted
    }

    function test_PlaceBet_RevertWhen_Paused() public {
        // TODO: Pause contract
        // TODO: Attempt bet placement
        // TODO: Verify revert with "Pausable: paused"
    }

    function test_PlaceBet_RevertWhen_WindowNotBettable() public {
        // TODO: Test revert when windowId in frozen zone (+1, +2, +3)
        // TODO: Test revert when windowId in past (current or earlier)
        // TODO: Test revert when windowId too far in future (>+6)
    }

    function test_PlaceBet_RevertWhen_ExceedsMaxStake() public {
        // TODO: Place bet that would exceed maxStakePerCell
        // TODO: Verify revert with "Exceeds max stake"
    }

    function test_PlaceBet_RevertWhen_ZeroAmount() public {
        // TODO: Attempt bet with amount = 0
        // TODO: Verify revert
    }

    function test_PlaceBetWithSig() public {
        // TODO: Generate EIP-712 BetIntent signature
        // TODO: Call placeBetWithSig via relayer
        // TODO: Verify bet placed correctly
        // TODO: Verify nonce incremented
        // TODO: Verify BetPlaced event emitted
    }

    function test_PlaceBetWithSig_RevertWhen_InvalidSignature() public {
        // TODO: Generate signature with wrong private key
        // TODO: Verify revert with "Invalid signature"
    }

    function test_PlaceBetWithSig_RevertWhen_ExpiredDeadline() public {
        // TODO: Generate signature with past deadline
        // TODO: Verify revert with "Expired signature"
    }

    function test_PlaceBetWithSig_RevertWhen_NotRelayer() public {
        // TODO: Call placeBetWithSig from non-relayer account
        // TODO: Verify revert with AccessControl error
    }

    function test_PermitAndPlaceBet() public {
        // TODO: Generate EIP-2612 permit signature
        // TODO: Call permitAndPlaceBet
        // TODO: Verify permit executed (allowance set)
        // TODO: Verify bet placed correctly
    }

    function test_MultipleBets_SameCell() public {
        // TODO: Alice and Bob both bet on same cell
        // TODO: Verify totalPool = sum of bets
        // TODO: Verify cellStakes[cellId] = sum of bets
        // TODO: Verify individual userStakes tracked correctly
    }

    function test_MultipleBets_DifferentCells() public {
        // TODO: Alice bets on cell A, Bob bets on cell B
        // TODO: Verify totalPool = sum of bets
        // TODO: Verify each cellStakes tracked separately
    }

    // =============================================================
    //                    SETTLEMENT TESTS
    // =============================================================

    function test_Settle() public {
        // TODO: Place bets on multiple cells
        // TODO: Warp to windowEnd
        // TODO: Mock Pyth price update
        // TODO: Call settle()
        // TODO: Verify winningCell calculated correctly
        // TODO: Verify fee deducted (2% of organicPool)
        // TODO: Verify redemptionRate calculated correctly
        // TODO: Verify window.settled = true
        // TODO: Verify WindowSettled event emitted
    }

    function test_Settle_RevertWhen_AlreadySettled() public {
        // TODO: Settle window
        // TODO: Attempt to settle again
        // TODO: Verify revert with "Already settled"
    }

    function test_Settle_RevertWhen_WindowNotEnded() public {
        // TODO: Attempt settle before windowEnd
        // TODO: Verify revert with "Window not ended"
    }

    function test_Settle_Rollover() public {
        // TODO: Place bets on cells that won't win
        // TODO: Mock Pyth price to land on empty cell
        // TODO: Call settle()
        // TODO: Verify pool rolled over to next window's backstopPool
        // TODO: Verify no fee deducted
        // TODO: Verify WindowRolledOver event emitted
    }

    function test_Settle_WithPythPrice() public {
        // TODO: Test settlement with real Pyth VAA structure
        // TODO: Verify price parsing from Pyth update data
        // TODO: Verify timestamp validation (±2s buffer for Base sequencer)
    }

    function test_VoidWindow() public {
        // TODO: Admin voids a window
        // TODO: Verify window.voided = true
        // TODO: Verify WindowVoided event emitted with reason
    }

    function test_VoidWindow_RevertWhen_NotAdmin() public {
        // TODO: Non-admin attempts to void window
        // TODO: Verify revert with AccessControl error
    }

    // =============================================================
    //                      PAYOUT TESTS
    // =============================================================

    function test_PushPayouts() public {
        // TODO: Settle window with winners
        // TODO: Treasury calls pushPayouts with winner addresses
        // TODO: Verify USDC transferred to winners
        // TODO: Verify userStakes zeroed out
        // TODO: Verify PayoutClaimed events emitted
    }

    function test_PushPayouts_RevertWhen_NotSettled() public {
        // TODO: Attempt pushPayouts on unsettled window
        // TODO: Verify revert
    }

    function test_PushPayouts_RevertWhen_NotTreasury() public {
        // TODO: Non-treasury attempts pushPayouts
        // TODO: Verify revert with AccessControl error
    }

    function test_ClaimAll() public {
        // TODO: User wins on multiple windows
        // TODO: Call claimAll with array of windowIds
        // TODO: Verify total payout calculated correctly
        // TODO: Verify USDC transferred to user
        // TODO: Verify all userStakes zeroed
        // TODO: Verify PayoutClaimed events for each window
    }

    function test_ClaimAll_SkipsNonWinningWindows() public {
        // TODO: User has bets on multiple windows, some winning, some losing
        // TODO: Call claimAll with all windowIds
        // TODO: Verify only winning windows pay out
        // TODO: Verify losing stakes remain (not refunded)
    }

    function test_ClaimAllFor() public {
        // TODO: Generate EIP-712 ClaimIntent signature
        // TODO: Relayer calls claimAllFor on behalf of user
        // TODO: Verify payouts sent to user (not relayer)
        // TODO: Verify nonce incremented
    }

    function test_ClaimRefund() public {
        // TODO: Place bet on window
        // TODO: Admin voids window
        // TODO: User calls claimRefund
        // TODO: Verify full stake refunded (no fee)
        // TODO: Verify RefundClaimed event emitted
    }

    function test_ClaimRefund_RevertWhen_NotVoided() public {
        // TODO: Attempt refund on settled window
        // TODO: Verify revert
    }

    function test_ClaimRefund_MultipleUsers() public {
        // TODO: Alice and Bob bet on voided window
        // TODO: Both claim refunds
        // TODO: Verify each gets their original stake back
    }

    // =============================================================
    //                      ADMIN TESTS
    // =============================================================

    function test_DepositBackstop() public {
        // TODO: Treasury deposits backstop funds
        // TODO: Verify backstopBalances incremented
        // TODO: Verify USDC transferred to poolManager
        // TODO: Verify BackstopDeposited event emitted
    }

    function test_DepositBackstop_RevertWhen_NotTreasury() public {
        // TODO: Non-treasury attempts deposit
        // TODO: Verify revert with AccessControl error
    }

    function test_WithdrawFees() public {
        // TODO: Settle windows to accumulate fees
        // TODO: Treasury withdraws fees
        // TODO: Verify collectedFees decremented
        // TODO: Verify USDC transferred to treasury
        // TODO: Verify FeesWithdrawn event emitted
    }

    function test_WithdrawFees_RevertWhen_InsufficientFees() public {
        // TODO: Attempt to withdraw more than collectedFees
        // TODO: Verify revert
    }

    function test_SetGridConfig() public {
        // TODO: Admin updates grid config
        // TODO: Verify frozenWindows updated
        // TODO: Verify feeBps updated
        // TODO: Verify minPoolThreshold updated
        // TODO: Verify GridConfigUpdated event emitted
    }

    function test_SetGridConfig_RevertWhen_InvalidFeeBps() public {
        // TODO: Attempt to set feeBps > 1000 (10%)
        // TODO: Verify revert
    }

    function test_Pause() public {
        // TODO: Admin pauses contract
        // TODO: Verify paused() returns true
        // TODO: Verify placeBet reverts
    }

    function test_Unpause() public {
        // TODO: Admin pauses, then unpauses
        // TODO: Verify paused() returns false
        // TODO: Verify placeBet works again
    }

    // =============================================================
    //                      VIEW FUNCTION TESTS
    // =============================================================

    function test_GetCurrentWindow() public {
        // TODO: Verify current window calculated correctly
        // TODO: Warp time forward, verify window increments
    }

    function test_GetBettableWindows() public {
        // TODO: Verify bettable range is [current+4, current+6]
        // TODO: Test with different frozenWindows values
    }

    function test_GetUserStake() public {
        // TODO: Place bet
        // TODO: Verify getUserStake returns correct amount
    }

    function test_GetCellStake() public {
        // TODO: Multiple users bet on same cell
        // TODO: Verify getCellStake returns sum of all stakes
    }

    function test_CalculatePayout() public {
        // TODO: Settle window
        // TODO: Verify calculatePayout returns correct amount for winner
        // TODO: Verify calculatePayout returns 0 for loser
    }

    function test_GetLiveMultiplier() public {
        // TODO: Place bets on cell
        // TODO: Verify multiplier = (totalPool * 0.98) / cellStakes
        // TODO: Place more bets, verify multiplier decreases
    }

    // =============================================================
    //                      EDGE CASE TESTS
    // =============================================================

    function test_CellId_BoundaryPrices() public {
        // TODO: Test cellId calculation at exact band boundaries
        // TODO: $3000.00 → cell 1500, $3001.99 → cell 1500, $3002.00 → cell 1501
    }

    function test_Settlement_ExactWindowEnd() public {
        // TODO: Settle at exactly windowEnd timestamp
        // TODO: Verify settlement succeeds
    }

    function test_Settlement_WithBuffer() public {
        // TODO: Test settlement with ±2s timestamp buffer for Base sequencer
    }

    function test_Rollover_ChainMultipleWindows() public {
        // TODO: Rollover window 1 → 2
        // TODO: Rollover window 2 → 3
        // TODO: Verify backstopPool accumulates correctly
    }

    function test_MaxGasUsage_PlaceBet() public {
        // TODO: Measure gas for placeBet
        // TODO: Assert gas < reasonable limit (e.g., 200k)
    }

    function test_MaxGasUsage_Settle() public {
        // TODO: Measure gas for settle with Pyth oracle call
        // TODO: Assert gas < reasonable limit
    }

    // =============================================================
    //                      FUZZ TESTS
    // =============================================================

    function testFuzz_PlaceBet(
        uint256 windowId,
        uint256 cellId,
        uint256 amount
    ) public {
        // TODO: Bound inputs to valid ranges
        // TODO: Test random bet placements don't break invariants
    }

    function testFuzz_Settle(uint256 closingPrice) public {
        // TODO: Test settlement with random Pyth prices
        // TODO: Verify winningCell always calculated correctly
    }

    function testFuzz_RedemptionRate(
        uint256 totalPool,
        uint256 winStakes,
        uint256 feeBps
    ) public {
        // TODO: Test redemption rate calculation with random inputs
        // TODO: Verify rate never exceeds reasonable bounds
    }

    // =============================================================
    //                    INTEGRATION TESTS
    // =============================================================

    function test_FullUserFlow() public {
        // TODO: Alice places bet on cell A
        // TODO: Bob places bet on cell B
        // TODO: Window ends
        // TODO: Settlement determines cell A wins
        // TODO: Alice claims payout
        // TODO: Verify Bob cannot claim (lost)
        // TODO: Verify total conservation of funds (pool - fee = payout)
    }

    function test_GaslessFlow() public {
        // TODO: User signs BetIntent
        // TODO: Relayer submits placeBetWithSig
        // TODO: Window settles
        // TODO: User signs ClaimIntent
        // TODO: Relayer submits claimAllFor
        // TODO: Verify user receives payout without spending gas
    }

    function test_MultiWindowStrategy() public {
        // TODO: User places bets across windows +4, +5, +6
        // TODO: Settle all windows
        // TODO: User wins some, loses some
        // TODO: ClaimAll in single transaction
        // TODO: Verify net payout correct
    }

    // =============================================================
    //                    INVARIANT TESTS
    // =============================================================

    function invariant_TotalPoolEqualsStakes() public {
        // TODO: Sum of all cellStakes == totalPool
    }

    function invariant_UserStakesSumToCellStakes() public {
        // TODO: For each cell, sum of userStakes == cellStakes
    }

    function invariant_FeesNeverExceed10Percent() public {
        // TODO: Verify feeBps never > 1000
    }

    function invariant_RedemptionRatePositive() public {
        // TODO: If settled with winners, redemptionRate > 0
    }

    function invariant_PausedBlocksBets() public {
        // TODO: If paused, all bet functions revert
    }

    // =============================================================
    //                        HELPERS
    // =============================================================

    function _warpToWindowEnd(uint256 windowId) internal {
        uint256 windowEnd = (windowId + 1) * WINDOW_DURATION + gridEpoch;
        vm.warp(windowEnd);
    }

    function _mockPythPrice(uint256 price, uint256 timestamp) internal {
        // TODO: Create mock Pyth VAA with given price and timestamp
    }

    function _signBetIntent(
        uint256 privateKey,
        PariHook.BetIntent memory intent
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        // TODO: Generate EIP-712 signature for BetIntent
    }

    function _signClaimIntent(
        uint256 privateKey,
        PariHook.ClaimIntent memory intent
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        // TODO: Generate EIP-712 signature for ClaimIntent
    }
}
