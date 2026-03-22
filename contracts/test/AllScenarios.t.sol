// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title AllScenariosTest
 * @notice Comprehensive tests covering every interaction path in PariHook:
 *
 *  SECTION A  — Bet placement (user flows, zone rules, limits, pause)
 *  SECTION B  — Settlement: all six outcome paths
 *  SECTION C  — Unresolved window tracking (EnumerableSet, finalizeUnresolved)
 *  SECTION D  — Late-resolution rollover (correct target skips frozen windows)
 *  SECTION E  — Payout flows (pushPayouts, claimAll, claimRefund, double-claim)
 *  SECTION F  — Backstop deposit and rollover
 *  SECTION G  — Admin controls (pause, void, parameter updates, fee withdrawal)
 *  SECTION H  — View functions (getBettableWindows, getLiveMultiplier, hasPendingClaim, etc.)
 */
contract AllScenariosTest is Test {
    using PoolIdLibrary for PoolKey;

    // =========================================================
    //                        CONTRACTS
    // =========================================================

    PariHook    public hook;
    MockPyth    public pyth;
    MockERC20   public usdc;
    MockPM      public pm;

    PoolKey public key;
    PoolId  public pid;

    // =========================================================
    //                        ACTORS
    // =========================================================

    address admin    = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address relayer  = makeAddr("relayer");
    address alice    = makeAddr("alice");
    address bob      = makeAddr("bob");
    address carol    = makeAddr("carol");
    address keeper   = makeAddr("keeper");
    address anyone   = makeAddr("anyone");

    // =========================================================
    //                      CONSTANTS
    // =========================================================

    bytes32 constant FEED_ID      = bytes32(uint256(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace));
    uint256 constant BAND         = 2_000_000;        // $2.00 per cell
    uint256 constant WIN_DUR      = 60;               // 60 s per window
    uint256 constant FROZEN       = 3;
    uint256 constant MAX_STAKE    = 100_000_000_000;
    uint256 constant FEE_BPS      = 200;              // 2%
    uint256 constant MIN_POOL     = 1_000_000;        // $1.00
    uint256 constant EPOCH        = 1_800_000_000;    // window-0 start

    // First window users can bet on when block.timestamp == EPOCH (current = 0)
    uint256 constant FIRST_BET = FROZEN + 1;   // 4

    // Reference prices
    uint256 constant PRICE_3000 = 3_000_000_000; // $3000 in USDC-6
    uint256 constant CELL_3000  = PRICE_3000 / BAND; // 1500

    // =========================================================
    //                        SETUP
    // =========================================================

    function setUp() public {
        pm   = new MockPM();
        usdc = new MockERC20();
        pyth = new MockPyth();

        hook = new PariHook(IPoolManager(address(pm)), IPyth(address(pyth)), admin, treasury, relayer);

        key = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: hook
        });
        pid = key.toId();

        vm.prank(admin);
        hook.configureGrid(key, FEED_ID, BAND, WIN_DUR, FROZEN, MAX_STAKE, FEE_BPS, MIN_POOL, EPOCH, address(usdc));

        vm.prank(address(pm));
        hook.beforeInitialize(address(this), key, 0);

        // Fund users with $1000 USDC each and approve hook
        address[] memory users = _users();
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], 1_000_000_000);
            vm.prank(users[i]);
            usdc.approve(address(hook), type(uint256).max);
        }

        // Fund treasury for seeding
        usdc.mint(treasury, 10_000_000_000);
        vm.prank(treasury);
        usdc.approve(address(hook), type(uint256).max);

        vm.deal(keeper, 10 ether);
        vm.deal(anyone, 1 ether);
    }

    // =========================================================
    //             SECTION A — BET PLACEMENT
    // =========================================================

    function test_PlaceBet_HappyPath() public {
        vm.prank(alice);
        hook.placeBet(key, CELL_3000, FIRST_BET, 10_000_000);

        assertEq(hook.getUserStake(key, FIRST_BET, CELL_3000, alice), 10_000_000);
        assertEq(hook.getCellStake(key, FIRST_BET, CELL_3000), 10_000_000);
    }

    function test_PlaceBet_MultipleUsers_SameCell() public {
        vm.prank(alice);
        hook.placeBet(key, CELL_3000, FIRST_BET, 10_000_000);
        vm.prank(bob);
        hook.placeBet(key, CELL_3000, FIRST_BET, 20_000_000);

        assertEq(hook.getCellStake(key, FIRST_BET, CELL_3000), 30_000_000);
    }

    function test_PlaceBet_MultipleUsers_DifferentCells() public {
        vm.prank(alice);
        hook.placeBet(key, CELL_3000, FIRST_BET, 10_000_000);
        vm.prank(bob);
        hook.placeBet(key, CELL_3000 + 1, FIRST_BET, 20_000_000);

        (uint256 totalPool,,,,, ) = hook.getWindow(key, FIRST_BET);
        assertEq(totalPool, 30_000_000);
    }

    function test_PlaceBet_AllThreeBettableWindows() public {
        vm.startPrank(alice);
        hook.placeBet(key, CELL_3000, FIRST_BET,      5_000_000);
        hook.placeBet(key, CELL_3000, FIRST_BET + 1,  5_000_000);
        hook.placeBet(key, CELL_3000, FIRST_BET + 10, 5_000_000);
        vm.stopPrank();
    }

    function test_PlaceBet_Reverts_WindowTooEarly_FrozenZone() public {
        // Windows 1, 2, 3 are frozen — cannot bet
        vm.prank(alice);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(key, CELL_3000, FROZEN, 10_000_000);
    }

    function test_PlaceBet_Reverts_ZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Amount must be > 0");
        hook.placeBet(key, CELL_3000, FIRST_BET, 0);
    }

    function test_PlaceBet_Reverts_ExceedsMaxStakePerCell() public {
        // Max stake = 100_000_000_000; mint extra for alice
        usdc.mint(alice, MAX_STAKE + 1);
        vm.prank(alice);
        vm.expectRevert("Exceeds max stake per cell");
        hook.placeBet(key, CELL_3000, FIRST_BET, MAX_STAKE + 1);
    }

    function test_PlaceBet_Reverts_WhenPaused() public {
        vm.prank(admin);
        hook.pause();

        vm.prank(alice);
        vm.expectRevert();
        hook.placeBet(key, CELL_3000, FIRST_BET, 10_000_000);
    }

    function test_PlaceBet_Succeeds_AfterUnpause() public {
        vm.prank(admin);
        hook.pause();

        vm.prank(admin);
        hook.unpause();

        vm.prank(alice);
        hook.placeBet(key, CELL_3000, FIRST_BET, 10_000_000);
        assertEq(hook.getUserStake(key, FIRST_BET, CELL_3000, alice), 10_000_000);
    }

    // =========================================================
    //         SECTION B — SETTLEMENT: ALL SIX OUTCOME PATHS
    // =========================================================

    // PATH 1 — Successful settlement with winner
    function test_Settle_Path1_Winner() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled, bool voided,,, uint256 rate) = hook.getWindow(key, FIRST_BET);
        assertTrue(settled);
        assertFalse(voided);
        // fee = 2% of 20M = 400K; netPool = 19.6M; winStakes = 10M; rate = 1.96x
        uint256 expectedRate = (20_000_000 - 400_000) * 1e18 / 10_000_000;
        assertEq(rate, expectedRate);
    }

    // PATH 2 — No bets on winning cell — rollover to next bettable window
    function test_Settle_Path2_Rollover_ToNextBettable() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000); // cell 1500
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000); // cell 1501

        uint256 ws = _windowStart(FIRST_BET);
        // Price lands on cell 1502 — nobody bet there
        uint256 price = (CELL_3000 + 2) * BAND;
        _setPrice(price, ws);
        vm.warp(ws);

        // current = FIRST_BET; rolloverTarget = FIRST_BET + FROZEN + 1
        uint256 expected_target = FIRST_BET + FROZEN + 1;

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled,,,, ) = hook.getWindow(key, FIRST_BET);
        assertTrue(settled, "Source window settled after rollover");

        (uint256 targetPool,,,,,) = hook.getWindow(key, expected_target);
        assertEq(targetPool, 20_000_000, "Rolled-over funds in next bettable window");
    }

    // PATH 3 — Organic pool below minPoolThreshold — auto void + full refund available
    function test_Settle_Path3_BelowThreshold_AutoVoid() public {
        _bet(alice, CELL_3000, FIRST_BET, 500_000); // $0.50 < $1.00 threshold

        uint256 ws = _windowStart(FIRST_BET);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled, bool voided,,,) = hook.getWindow(key, FIRST_BET);
        assertFalse(settled);
        assertTrue(voided, "Window auto-voided below threshold");
    }

    // PATH 4 — No Pyth price, before resolution deadline — marks unresolved
    function test_Settle_Path4_NoPythPrice_BeforeDeadline_Unresolved() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);
        // No price set — oracle will report no price in range
        vm.warp(ws);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled, bool voided, bool unresolved,,) = hook.getWindow(key, FIRST_BET);
        assertFalse(settled);
        assertFalse(voided);
        assertTrue(unresolved, "Window should be unresolved before deadline");
    }

    // PATH 5 — No Pyth price, after resolution deadline — settle() itself finalizes as void
    function test_Settle_Path5_NoPythPrice_AfterDeadline_Void() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);
        // Warp past the resolution deadline (windowStart + windowDuration)
        vm.warp(ws + WIN_DUR);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled, bool voided, bool unresolved,,) = hook.getWindow(key, FIRST_BET);
        assertFalse(settled);
        assertTrue(voided, "Window voided when settled after deadline with no price");
        assertFalse(unresolved);
    }

    // PATH 6 — Window previously unresolved, retry finds price — settles normally
    function test_Settle_Path6_Retry_FindsPrice_Settles() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);

        // First attempt: no price → unresolved
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, , , bool unresolved,,) = hook.getWindow(key, FIRST_BET);
        assertTrue(unresolved, "Should be unresolved after first attempt");

        // Price data arrives slightly late but still before resolution deadline
        _setPrice(PRICE_3000, ws + 5);
        vm.warp(ws + 5);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled2, bool voided2, bool unresolved2,,) = hook.getWindow(key, FIRST_BET);
        assertTrue(settled2,     "Should settle on retry");
        assertFalse(voided2);
        assertFalse(unresolved2, "Unresolved flag cleared on success");
    }

    // PATH 6b — Retry when previously unresolved, still no winner — rollover
    function test_Settle_Path6b_Retry_NoWinner_Rollover() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000); // cell 1500

        uint256 ws = _windowStart(FIRST_BET);

        // First attempt: no price → unresolved
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        // Price arrives at ws+5, but lands on cell 1502 (no bets there) → rollover
        uint256 price1502 = (CELL_3000 + 2) * BAND;
        _setPrice(price1502, ws + 5);
        vm.warp(ws + 5);

        uint256 rollTarget = FIRST_BET + FROZEN + 1;
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled,, bool unresolved,,) = hook.getWindow(key, FIRST_BET);
        assertTrue(settled,     "Source window settled after rollover");
        assertFalse(unresolved, "Unresolved flag cleared on rollover");

        (uint256 nextPool,,,,,) = hook.getWindow(key, rollTarget);
        assertEq(nextPool, 10_000_000, "Pool rolled to correct target");
    }

    // Revert: settle before window opens
    function test_Settle_Reverts_BeforeWindowStart() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        // Do NOT warp; block.timestamp < windowStart

        vm.prank(keeper);
        vm.expectRevert("Window not started");
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");
    }

    // Revert: settle already settled window
    function test_Settle_Reverts_AlreadySettled() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        uint256 ws = _windowStart(FIRST_BET);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        vm.prank(keeper);
        vm.expectRevert("Already settled");
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");
    }

    // Revert: settle already voided window
    function test_Settle_Reverts_AlreadyVoided() public {
        vm.prank(admin);
        hook.voidWindow(key, FIRST_BET);

        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);

        vm.prank(keeper);
        vm.expectRevert("Already voided");
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");
    }

    // Revert: insufficient Pyth fee
    function test_Settle_Reverts_InsufficientFee() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);

        vm.prank(keeper);
        vm.expectRevert("Insufficient Pyth update fee");
        hook.settle{value: 0.001 ether}(key, FIRST_BET, hex"01"); // 0.001 < 0.01 required
    }

    // =========================================================
    //    SECTION C — UNRESOLVED WINDOW TRACKING
    // =========================================================

    function test_Unresolved_AddedToEnumerableSet() public {
        _bet(alice, CELL_3000, FIRST_BET,     10_000_000);
        _bet(alice, CELL_3000, FIRST_BET + 1, 10_000_000);

        vm.warp(_windowStart(FIRST_BET));
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        vm.warp(_windowStart(FIRST_BET + 1));
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET + 1, hex"01");

        uint256[] memory unresolved = hook.getUnresolvedWindows(key);
        assertEq(unresolved.length, 2);
    }

    function test_Unresolved_RemovedWhenSettled() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01"); // no price → unresolved

        assertEq(hook.getUnresolvedWindows(key).length, 1);

        // Retry with price → settled
        _setPrice(PRICE_3000, ws + 3);
        vm.warp(ws + 3);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        assertEq(hook.getUnresolvedWindows(key).length, 0, "Removed from set on settle");
    }

    function test_Unresolved_RemovedWhenFinalized() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01"); // unresolved

        assertEq(hook.getUnresolvedWindows(key).length, 1);

        vm.warp(ws + WIN_DUR); // past deadline
        hook.finalizeUnresolved(key, FIRST_BET);

        assertEq(hook.getUnresolvedWindows(key).length, 0, "Removed from set on finalize");
    }

    function test_FinalizeUnresolved_Reverts_NotUnresolved() public {
        vm.expectRevert("Window is not unresolved");
        hook.finalizeUnresolved(key, FIRST_BET);
    }

    function test_FinalizeUnresolved_Reverts_BeforeDeadline() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01"); // unresolved

        vm.expectRevert("Resolution deadline not passed");
        hook.finalizeUnresolved(key, FIRST_BET); // deadline = ws + WIN_DUR, not there yet
    }

    function test_FinalizeUnresolved_Succeeds_AfterDeadline() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01"); // unresolved

        vm.warp(ws + WIN_DUR);
        hook.finalizeUnresolved(key, FIRST_BET); // anyone can call

        (, bool settled, bool voided, bool unresolved,,) = hook.getWindow(key, FIRST_BET);
        assertFalse(settled);
        assertTrue(voided,      "Finalized as voided after deadline");
        assertFalse(unresolved, "Unresolved flag cleared");
    }

    function test_FinalizeUnresolved_PermissionlessAnyone() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        vm.warp(ws + WIN_DUR);
        vm.prank(anyone); // not admin, not keeper — anyone can finalize
        hook.finalizeUnresolved(key, FIRST_BET);

        (, , bool voided,,,) = hook.getWindow(key, FIRST_BET);
        assertTrue(voided);
    }

    // =========================================================
    //     SECTION D — LATE-RESOLUTION ROLLOVER
    // =========================================================

    // Rollover target = max(windowId+1, current + FROZEN + 1)
    // When settled at windowStart: current == windowId, so target = windowId + FROZEN + 1

    function test_LateRollover_TargetSkipsFrozenWindows_ImmediateSettlement() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);
        uint256 price_other = (CELL_3000 + 50) * BAND; // cell nobody bet on
        _setPrice(price_other, ws);
        vm.warp(ws);

        // current = FIRST_BET; target = FIRST_BET + FROZEN + 1 = 4 + 3 + 1 = 8
        uint256 expectedTarget = FIRST_BET + FROZEN + 1;

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (uint256 pool,,,,,) = hook.getWindow(key, expectedTarget);
        assertEq(pool, 10_000_000, "Funds reach first bettable window, not frozen windowId+1");

        // Confirm no funds in windowId+1 (frozen)
        (uint256 frozenPool,,,,,) = hook.getWindow(key, FIRST_BET + 1);
        assertEq(frozenPool, 0, "Nothing in frozen window");
    }

    function test_LateRollover_TargetSkipsMany_LateResolution() public {
        uint256 wid = FIRST_BET;
        _bet(alice, CELL_3000, wid, 10_000_000);

        // Resolve 20 windows later — current = wid + 20
        uint256 laterCurrent = wid + 20;
        uint256 laterTime    = EPOCH + laterCurrent * WIN_DUR;
        uint256 ws           = _windowStart(wid);

        uint256 price_other  = (CELL_3000 + 50) * BAND;
        _setPrice(price_other, ws);

        // But settle at a much later time — after 20 windows have passed
        pyth.setUnresolved(true); // first call → unresolved
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid, hex"01");
        pyth.setUnresolved(false);

        // Now advance to laterTime and retry with the opening price
        _setPrice(price_other, ws); // price still at ws
        vm.warp(laterTime);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid, hex"01");

        // current at laterTime = laterCurrent = wid + 20
        // target = max(wid + 1, laterCurrent + FROZEN + 1) = laterCurrent + FROZEN + 1 = wid + 24
        uint256 expectedTarget = laterCurrent + FROZEN + 1;

        (uint256 pool,,,,,) = hook.getWindow(key, expectedTarget);
        assertEq(pool, 10_000_000, "Pool skipped to correct late rollover target");
    }

    function test_LateRollover_PoolAccumulatesOnTarget() public {
        // Two windows roll to the same target, funds should accumulate
        uint256 wid1 = FIRST_BET;
        uint256 wid2 = FIRST_BET + 1;

        _bet(alice, CELL_3000, wid1, 10_000_000);
        _bet(bob,   CELL_3000, wid2, 15_000_000);

        uint256 price_other = (CELL_3000 + 50) * BAND; // no bets on this cell

        // Settle wid1 at its start — target = wid1 + FROZEN + 1 = 8
        uint256 ws1 = _windowStart(wid1);
        _setPrice(price_other, ws1);
        vm.warp(ws1);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid1, hex"01");

        // Settle wid2 at its start — current = wid2, target = wid2 + FROZEN + 1 = 9
        uint256 ws2 = _windowStart(wid2);
        _setPrice(price_other, ws2);
        vm.warp(ws2);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid2, hex"01");

        // Check both targets received their funds
        (uint256 pool8,,,,,) = hook.getWindow(key, wid1 + FROZEN + 1);
        assertEq(pool8, 10_000_000);

        (uint256 pool9,,,,,) = hook.getWindow(key, wid2 + FROZEN + 1);
        assertEq(pool9, 15_000_000);
    }

    // =========================================================
    //        SECTION E — PAYOUT FLOWS
    // =========================================================

    // --- pushPayouts (keeper batch) ---

    function test_PushPayouts_SingleWinner() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256 aliceBefore = usdc.balanceOf(alice);

        address[] memory winners = new address[](1);
        winners[0] = alice;
        vm.prank(treasury);
        hook.pushPayouts(key, FIRST_BET, winners);

        uint256 aliceAfter = usdc.balanceOf(alice);
        // fee = 2% of 20M = 400K; netPool = 19.6M; alice stake = 10M / 10M total = all net
        uint256 expectedPayout = 20_000_000 - 400_000;
        assertEq(aliceAfter - aliceBefore, expectedPayout, "Alice received correct payout");
    }

    function test_PushPayouts_MultipleWinners_SameCell() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000); // 50% of winner pool
        _bet(bob,   CELL_3000, FIRST_BET, 10_000_000); // 50% of winner pool
        _bet(carol, CELL_3000 + 1, FIRST_BET, 20_000_000); // loser
        _settle(FIRST_BET, PRICE_3000);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        address[] memory winners = new address[](2);
        winners[0] = alice;
        winners[1] = bob;
        vm.prank(treasury);
        hook.pushPayouts(key, FIRST_BET, winners);

        // total = 40M; fee = 2% = 800K; net = 39.2M; winStakes = 20M; rate = 1.96x
        // alice payout = 10M * rate = 19.6M; bob payout = same
        uint256 fee        = (40_000_000 * FEE_BPS) / 10_000;
        uint256 net        = 40_000_000 - fee;
        uint256 winStakes  = 20_000_000;
        uint256 rate       = net * 1e18 / winStakes;
        uint256 expected   = 10_000_000 * rate / 1e18;

        assertEq(usdc.balanceOf(alice) - aliceBefore, expected);
        assertEq(usdc.balanceOf(bob)   - bobBefore,   expected);
    }

    function test_PushPayouts_Loser_ReceivesNothing() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000); // winner
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000); // loser
        _settle(FIRST_BET, PRICE_3000);

        uint256 bobBefore = usdc.balanceOf(bob);
        address[] memory losers = new address[](1);
        losers[0] = bob;
        vm.prank(treasury);
        hook.pushPayouts(key, FIRST_BET, losers);

        assertEq(usdc.balanceOf(bob), bobBefore, "Loser receives nothing");
    }

    function test_PushPayouts_Reverts_WindowNotSettled() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        address[] memory winners = new address[](1);
        winners[0] = alice;
        vm.prank(treasury);
        vm.expectRevert("Window not settled");
        hook.pushPayouts(key, FIRST_BET, winners);
    }

    function test_PushPayouts_NoDuplicate() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        address[] memory winners = new address[](1);
        winners[0] = alice;

        vm.prank(treasury);
        hook.pushPayouts(key, FIRST_BET, winners);

        uint256 aliceMid = usdc.balanceOf(alice);

        // Push again — second push should not transfer more
        vm.prank(treasury);
        hook.pushPayouts(key, FIRST_BET, winners);

        assertEq(usdc.balanceOf(alice), aliceMid, "No double payout on repeat push");
    }

    // --- claimAll (user self-claims) ---

    function test_ClaimAll_Winner_ReceivesPayout() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256 aliceBefore = usdc.balanceOf(alice);

        uint256[] memory wids = new uint256[](1);
        wids[0] = FIRST_BET;

        vm.prank(alice);
        hook.claimAll(key, wids);

        uint256 fee      = (20_000_000 * FEE_BPS) / 10_000;
        uint256 expected = 20_000_000 - fee;
        assertEq(usdc.balanceOf(alice) - aliceBefore, expected);
    }

    function test_ClaimAll_Loser_GetsNothing() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256 bobBefore = usdc.balanceOf(bob);
        uint256[] memory wids = new uint256[](1);
        wids[0] = FIRST_BET;

        vm.prank(bob);
        hook.claimAll(key, wids);

        assertEq(usdc.balanceOf(bob), bobBefore, "Loser gets nothing from claimAll");
    }

    function test_ClaimAll_MultiplePastWindows() public {
        uint256 wid2 = FIRST_BET + FROZEN + 1; // second bettable window for test
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        // After settling FIRST_BET, currentWindow == FIRST_BET so wid2 is in bettable zone
        _bet(alice, CELL_3000, wid2, 5_000_000);
        uint256 ws2 = _windowStart(wid2);
        _settleAt(wid2, PRICE_3000, ws2);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256[] memory wids = new uint256[](2);
        wids[0] = FIRST_BET;
        wids[1] = wid2;

        vm.prank(alice);
        hook.claimAll(key, wids);

        // Both payouts accumulated
        assertGt(usdc.balanceOf(alice) - aliceBefore, 0, "Alice claimed from both windows");
    }

    // --- claimRefund (voided window) ---

    function test_ClaimRefund_VoidedWindow() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        vm.prank(admin);
        hook.voidWindow(key, FIRST_BET);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        hook.claimRefund(key, FIRST_BET);

        assertEq(usdc.balanceOf(alice) - aliceBefore, 10_000_000, "Full refund on void");
    }

    function test_ClaimRefund_Reverts_WindowNotVoided() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        vm.prank(alice);
        vm.expectRevert("Window not voided");
        hook.claimRefund(key, FIRST_BET);
    }

    function test_ClaimRefund_Reverts_NoStake() public {
        vm.prank(admin);
        hook.voidWindow(key, FIRST_BET);

        vm.prank(carol); // carol never bet
        vm.expectRevert("No stake to refund");
        hook.claimRefund(key, FIRST_BET);
    }

    function test_ClaimRefund_NoDouble() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        vm.prank(admin);
        hook.voidWindow(key, FIRST_BET);

        vm.prank(alice);
        hook.claimRefund(key, FIRST_BET);

        vm.prank(alice);
        vm.expectRevert("No stake to refund");
        hook.claimRefund(key, FIRST_BET);
    }

    function test_ClaimRefund_AfterFinalizeUnresolved() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        uint256 ws = _windowStart(FIRST_BET);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01"); // unresolved

        vm.warp(ws + WIN_DUR);
        hook.finalizeUnresolved(key, FIRST_BET);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        hook.claimRefund(key, FIRST_BET);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 10_000_000);
    }

    // =========================================================
    //        SECTION F — BACKSTOP DEPOSIT AND ROLLOVER
    // =========================================================

    function test_DepositBackstop_AddsToTotalPool() public {
        vm.prank(treasury);
        hook.depositBackstop(key, FIRST_BET, 50_000_000);

        (uint256 pool,,,,,) = hook.getWindow(key, FIRST_BET);
        assertEq(pool, 50_000_000, "Backstop increases total pool");
        assertEq(hook.backstopBalances(pid), 50_000_000);
    }

    function test_DepositBackstop_DoesNotCountAsOrganic() public {
        vm.prank(treasury);
        hook.depositBackstop(key, FIRST_BET, 50_000_000);

        // organic pool stays 0 — backstop is tracked separately
        // To verify: settle with price but no organic bets → auto-void (below minPoolThreshold)
        uint256 ws = _windowStart(FIRST_BET);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, , bool voided,,,) = hook.getWindow(key, FIRST_BET);
        assertTrue(voided, "Void because organic pool is 0 (below threshold), backstop doesn't count");
    }

    function test_DepositBackstop_RolledOverWithWindow() public {
        // User bets organically; backstop seeds
        _bet(alice, CELL_3000, FIRST_BET, 5_000_000);
        vm.prank(treasury);
        hook.depositBackstop(key, FIRST_BET, 10_000_000);

        uint256 ws   = _windowStart(FIRST_BET);
        uint256 cell = (CELL_3000 + 50) * BAND; // nobody bet here
        _setPrice(cell, ws);
        vm.warp(ws);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        uint256 target = FIRST_BET + FROZEN + 1;
        (uint256 nextPool,,,,,) = hook.getWindow(key, target);
        assertEq(nextPool, 15_000_000, "Full pool (user + backstop) rolled over");
        assertEq(hook.rolloverBalances(pid), 15_000_000);
    }

    // =========================================================
    //        SECTION G — ADMIN CONTROLS
    // =========================================================

    function test_Pause_BlocksBetting() public {
        vm.prank(admin);
        hook.pause();

        vm.prank(alice);
        vm.expectRevert();
        hook.placeBet(key, CELL_3000, FIRST_BET, 10_000_000);
    }

    function test_Pause_DoesNotBlockSettle() public {
        // settle is not guarded by whenNotPaused
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        uint256 ws = _windowStart(FIRST_BET);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);

        vm.prank(admin);
        hook.pause();

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, bool settled,,,, ) = hook.getWindow(key, FIRST_BET);
        assertTrue(settled, "Settlement still works when paused");
    }

    function test_VoidWindow_AdminOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.voidWindow(key, FIRST_BET);
    }

    function test_VoidWindow_ManualVoid() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);

        vm.prank(admin);
        hook.voidWindow(key, FIRST_BET);

        (, bool settled, bool voided,,,) = hook.getWindow(key, FIRST_BET);
        assertFalse(settled);
        assertTrue(voided);
    }

    function test_VoidWindow_Reverts_AlreadySettled() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        vm.prank(admin);
        vm.expectRevert("Window already settled");
        hook.voidWindow(key, FIRST_BET);
    }

    function test_SetFeeBps_AffectsNextSettlement() public {
        vm.prank(admin);
        hook.setFeeBps(key, 500); // 5%

        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        (,,,,, uint256 rate) = hook.getWindow(key, FIRST_BET);
        // fee = 5% of 10M = 500K; net = 9.5M; winStakes = 10M; rate = 0.95x
        uint256 expected = (10_000_000 - 500_000) * 1e18 / 10_000_000;
        assertEq(rate, expected, "Rate reflects updated fee");
    }

    function test_SetFeeBps_Reverts_TooHigh() public {
        vm.prank(admin);
        vm.expectRevert();
        hook.setFeeBps(key, 1001); // > 10%
    }

    function test_SetFrozenWindows_ExpandsBettableZone() public {
        // Default: frozen = 3, bettable starts at window 4
        // Reduce frozen to 1: bettable starts at window 2
        vm.prank(admin);
        hook.setFrozenWindows(key, 1);

        (uint256 start,) = hook.getBettableWindows(key);
        assertEq(start, 2, "Bettable starts at current(0) + 1 + 1 = 2");
    }

    function test_SetMinPoolThreshold() public {
        vm.prank(admin);
        hook.setMinPoolThreshold(key, 5_000_000); // $5

        // $4 bet — below new threshold
        _bet(alice, CELL_3000, FIRST_BET, 4_000_000);
        uint256 ws = _windowStart(FIRST_BET);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        (, , bool voided,,,) = hook.getWindow(key, FIRST_BET);
        assertTrue(voided, "Auto-voided because pool < new threshold");
    }

    function test_WithdrawFees_Success() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256 fee = (20_000_000 * FEE_BPS) / 10_000; // 400_000
        assertEq(hook.collectedFees(pid), fee);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(treasury);
        hook.withdrawFees(key, fee);

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, fee);
        assertEq(hook.collectedFees(pid), 0);
    }

    function test_WithdrawFees_Reverts_Insufficient() public {
        vm.prank(treasury);
        vm.expectRevert("Insufficient collected fees");
        hook.withdrawFees(key, 1);
    }

    // =========================================================
    //        SECTION H — VIEW FUNCTIONS
    // =========================================================

    function test_GetBettableWindows_AtEpoch() public {
        // block.timestamp defaults to 1 in Forge; EPOCH is in the future → current = 0
        (uint256 start, uint256 end) = hook.getBettableWindows(key);
        assertEq(start, FROZEN + 1, "Start = current(0) + frozen + 1");
        assertEq(end,   type(uint256).max, "End is unbounded");
    }

    function test_GetBettableWindows_AdvancesWithTime() public {
        vm.warp(EPOCH + 10 * WIN_DUR); // current = 10
        (uint256 start, uint256 end) = hook.getBettableWindows(key);
        assertEq(start, 10 + FROZEN + 1, "Start advances with current window");
        assertEq(end,   type(uint256).max);
    }

    function test_GetLiveMultiplier_BeforeSettlement() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);

        // Live multiplier for alice's cell: (netPool * 1e18) / stake
        // netPool (estimate) = totalPool * (1 - feeBps/10000) = 20M * 0.98 = 19.6M
        uint256 mult = hook.getLiveMultiplier(key, FIRST_BET, CELL_3000);
        uint256 expected = (20_000_000 * (10_000 - FEE_BPS) / 10_000) * 1e18 / 10_000_000;
        assertEq(mult, expected, "Live multiplier matches formula");
    }

    function test_GetLiveMultiplier_ZeroIfNoBets() public {
        uint256 mult = hook.getLiveMultiplier(key, FIRST_BET, CELL_3000);
        assertEq(mult, 0, "Multiplier is 0 with no bets");
    }

    function test_HasPendingClaim_TrueForWinner() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        assertTrue(hook.hasPendingClaim(key, FIRST_BET, alice));
    }

    function test_HasPendingClaim_FalseForLoser() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        assertFalse(hook.hasPendingClaim(key, FIRST_BET, bob), "Loser has no pending claim");
    }

    function test_HasPendingClaim_FalseAfterClaim() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256[] memory wids = new uint256[](1);
        wids[0] = FIRST_BET;
        vm.prank(alice);
        hook.claimAll(key, wids);

        assertFalse(hook.hasPendingClaim(key, FIRST_BET, alice), "No pending claim after claiming");
    }

    function test_GetPendingClaims_CorrectSum() public {
        _bet(alice, CELL_3000, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256[] memory wids = new uint256[](1);
        wids[0] = FIRST_BET;
        uint256 pending = hook.getPendingClaims(key, wids, alice);

        uint256 fee      = (10_000_000 * FEE_BPS) / 10_000;
        uint256 expected = 10_000_000 - fee; // sole winner gets net pool
        assertEq(pending, expected);
    }

    function test_GetUnresolvedWindows_EmptyInitially() public {
        assertEq(hook.getUnresolvedWindows(key).length, 0);
    }

    function test_GetUserStake_ReturnsCorrectAmount() public {
        _bet(alice, CELL_3000, FIRST_BET, 7_000_000);
        assertEq(hook.getUserStake(key, FIRST_BET, CELL_3000, alice), 7_000_000);
    }

    function test_GetCellStakes_MultiCell() public {
        _bet(alice, CELL_3000,     FIRST_BET, 5_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 8_000_000);

        uint256[] memory cells = new uint256[](2);
        cells[0] = CELL_3000;
        cells[1] = CELL_3000 + 1;

        uint256[] memory stakes = hook.getCellStakes(key, FIRST_BET, cells);
        assertEq(stakes[0], 5_000_000);
        assertEq(stakes[1], 8_000_000);
    }

    function test_CalculatePayout_CorrectBeforeClaim() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256 payout = hook.calculatePayout(key, FIRST_BET, CELL_3000, alice);
        uint256 fee    = (20_000_000 * FEE_BPS) / 10_000;
        assertEq(payout, 20_000_000 - fee, "calculatePayout returns expected amount");
    }

    function test_CalculatePayout_ZeroForLoser() public {
        _bet(alice, CELL_3000,     FIRST_BET, 10_000_000);
        _bet(bob,   CELL_3000 + 1, FIRST_BET, 10_000_000);
        _settle(FIRST_BET, PRICE_3000);

        uint256 payout = hook.calculatePayout(key, FIRST_BET, CELL_3000 + 1, bob);
        assertEq(payout, 0);
    }

    // =========================================================
    //         SECTION I — END-TO-END SIMULATION
    // =========================================================

    /**
     * Full multi-window simulation covering:
     *
     *  Phase 0  t=EPOCH            currentWindow=0     Bettable: [4,5,6]
     *           Alice bets window 4, wrong cell  → will rollover
     *           Bob   bets window 5, right cell  → will win
     *           Carol bets window 6, right cell  → Pyth unavailable → unresolved → voided
     *
     *  Phase 1  t=windowStart(4)   currentWindow=4     Bettable: [8,9,10]
     *           Settle window 4 (no winner)       → rollover pool to window 8
     *           Window 5 is now frozen            → new bets on it revert
     *           Window 8 just opened for betting  → Carol adds a bet
     *
     *  Phase 2  t=windowStart(5)   currentWindow=5
     *           Settle window 5 (Bob wins)        → Bob claims payout
     *
     *  Phase 3  t=windowStart(6)   currentWindow=6
     *           Settle window 6, Pyth returns no price → unresolved (before deadline)
     *           getUnresolvedWindows lists window 6
     *
     *  Phase 4  t > window-6 deadline
     *           finalizeUnresolved (permissionless) → voided
     *           Carol claims full refund
     *           Unresolved set becomes empty
     *
     *  Phase 5  t=windowStart(8)   currentWindow=8     Bettable: [12,13,14]
     *           Settle window 8 (rollover + Carol's bet, Carol wins)
     *           Carol claims payout; bettable zone advanced to [12,13,14]
     */
    function test_Simulation_FullLifecycle() public {
        // ----------------------------------------------------------------
        //  PHASE 0 — bet placement; assert zone boundaries
        // ----------------------------------------------------------------
        vm.warp(EPOCH); // currentWindow = 0, bettable = [4, 5, 6]

        uint256 WRONG_CELL = CELL_3000 + 1;

        // Alice: window 4, wrong cell → no winner → rollover
        _bet(alice, WRONG_CELL, FIRST_BET,     20_000_000);
        // Bob:   window 5, winning cell
        _bet(bob,   CELL_3000,  FIRST_BET + 1, 15_000_000);
        // Carol: window 6, winning cell — but Pyth will have no price
        _bet(carol, CELL_3000,  FIRST_BET + 2, 10_000_000);

        // USDC left after bets
        assertEq(usdc.balanceOf(alice), 1_000_000_000 - 20_000_000, "P0: Alice balance");
        assertEq(usdc.balanceOf(bob),   1_000_000_000 - 15_000_000, "P0: Bob balance");
        assertEq(usdc.balanceOf(carol), 1_000_000_000 - 10_000_000, "P0: Carol balance");

        // ----------------------------------------------------------------
        //  PHASE 1 — settle window 4; bettable zone shifts; window 5 frozen
        // ----------------------------------------------------------------
        uint256 ws4 = _windowStart(FIRST_BET);
        _setPrice(PRICE_3000, ws4);   // price lands at CELL_3000; Alice bet WRONG_CELL → no winner
        vm.warp(ws4);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET, hex"01");

        // Window 4: settled (via rollover), not voided, winningCell=0 (no stakers on winning cell)
        (, bool s4, bool v4,, uint256 wc4,) = hook.getWindow(key, FIRST_BET);
        assertTrue(s4,           "P1: window 4 settled");
        assertFalse(v4,          "P1: window 4 not voided");
        assertEq(wc4, 0,         "P1: winningCell=0 when rolled over (no winner stored)");

        // Rollover target: max(4+1, 4+3+1) = 8; pool = Alice's $20
        uint256 rollTarget = FIRST_BET + FROZEN + 1; // 8
        (uint256 pool8a,,,,, ) = hook.getWindow(key, rollTarget);
        assertEq(pool8a, 20_000_000, "P1: rollover funds landed in window 8");

        // currentWindow is now 4 → window 5 is frozen; new bet must revert
        vm.prank(anyone);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(key, CELL_3000, FIRST_BET + 1, 1_000_000);

        // Window 8 is now open; Carol places an additional bet
        _bet(carol, CELL_3000, rollTarget, 10_000_000);
        (uint256 pool8b,,,,, ) = hook.getWindow(key, rollTarget);
        assertEq(pool8b, 30_000_000, "P1: window-8 pool = rollover $20 + Carol $10");

        // Bettable zone after settling window 4: [8, ∞)
        (uint256 bStart1,) = hook.getBettableWindows(key);
        assertEq(bStart1, rollTarget, "P1: bettable starts at 8");

        // ----------------------------------------------------------------
        //  PHASE 2 — settle window 5; Bob wins and claims
        // ----------------------------------------------------------------
        uint256 ws5 = _windowStart(FIRST_BET + 1);
        _setPrice(PRICE_3000, ws5);
        vm.warp(ws5);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FIRST_BET + 1, hex"01");

        (, bool s5,,,,  uint256 rate5) = hook.getWindow(key, FIRST_BET + 1);
        assertTrue(s5,      "P2: window 5 settled");
        assertGt(rate5, 0,  "P2: redemption rate > 0 (there is a winner)");

        uint256 bobBefore = usdc.balanceOf(bob);
        uint256[] memory w5 = new uint256[](1);
        w5[0] = FIRST_BET + 1;
        vm.prank(bob);
        hook.claimAll(key, w5);
        assertGt(usdc.balanceOf(bob) - bobBefore, 0, "P2: Bob received payout");

        // ----------------------------------------------------------------
        //  PHASE 3 — settle window 6 with no Pyth price → unresolved
        // ----------------------------------------------------------------
        uint256 ws6     = _windowStart(FIRST_BET + 2);
        uint256 wid6    = FIRST_BET + 2;
        uint256 dead6   = ws6 + WIN_DUR; // resolution deadline

        vm.warp(ws6);
        pyth.setUnresolved(true);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid6, hex"01");
        pyth.setUnresolved(false);

        (, bool s6, bool v6, bool u6,,) = hook.getWindow(key, wid6);
        assertFalse(s6, "P3: window 6 not yet settled");
        assertFalse(v6, "P3: window 6 not voided");
        assertTrue(u6,  "P3: window 6 marked unresolved");

        uint256[] memory unresolved1 = hook.getUnresolvedWindows(key);
        assertEq(unresolved1.length, 1,    "P3: one unresolved window tracked");
        assertEq(unresolved1[0], wid6,     "P3: window 6 in unresolved set");

        // Retry before deadline still marks unresolved (price still unavailable)
        vm.warp(ws6 + 10);
        pyth.setUnresolved(true);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid6, hex"01");
        pyth.setUnresolved(false);

        (, , , bool u6b,,) = hook.getWindow(key, wid6);
        assertTrue(u6b, "P3: still unresolved after second attempt before deadline");

        // ----------------------------------------------------------------
        //  PHASE 4 — deadline passes; anyone finalizes; Carol refunds
        // ----------------------------------------------------------------
        vm.warp(dead6);

        // finalizeUnresolved is permissionless
        vm.prank(anyone);
        hook.finalizeUnresolved(key, wid6);

        (, bool s6c, bool v6c, bool u6c,,) = hook.getWindow(key, wid6);
        assertFalse(s6c, "P4: window 6 still not settled");
        assertTrue(v6c,  "P4: window 6 voided after finalize");
        assertFalse(u6c, "P4: unresolved flag cleared");

        uint256[] memory unresolved2 = hook.getUnresolvedWindows(key);
        assertEq(unresolved2.length, 0, "P4: unresolved set now empty");

        // Carol claims full refund (she had $10 on window 6)
        uint256 carolBefore6 = usdc.balanceOf(carol);
        vm.prank(carol);
        hook.claimRefund(key, wid6);
        assertEq(usdc.balanceOf(carol) - carolBefore6, 10_000_000, "P4: Carol refunded $10");

        // ----------------------------------------------------------------
        //  PHASE 5 — settle window 8; carol wins rollover + her own bet
        // ----------------------------------------------------------------
        uint256 ws8 = _windowStart(rollTarget);
        _setPrice(PRICE_3000, ws8);
        vm.warp(ws8);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, rollTarget, hex"01");

        (, bool s8, bool v8,, uint256 wc8, uint256 rate8) = hook.getWindow(key, rollTarget);
        assertTrue(s8,           "P5: window 8 settled");
        assertFalse(v8,          "P5: window 8 not voided");
        assertEq(wc8, CELL_3000, "P5: winning cell = CELL_3000");
        assertGt(rate8, 0,       "P5: redemption rate set");

        // Carol bet $10 on CELL_3000 in window 8; pool = $30 (rollover $20 + her $10)
        // Carol is the sole staker on the winning cell → collects entire net pool
        uint256 carolBefore8 = usdc.balanceOf(carol);
        uint256[] memory w8 = new uint256[](1);
        w8[0] = rollTarget;
        vm.prank(carol);
        hook.claimAll(key, w8);
        uint256 fee8     = (30_000_000 * FEE_BPS) / 10_000;
        uint256 expected = 30_000_000 - fee8;
        assertEq(usdc.balanceOf(carol) - carolBefore8, expected, "P5: Carol wins full pool");

        // Bettable zone after settling window 8 (currentWindow=8): [12, ∞)
        (uint256 bStart2,) = hook.getBettableWindows(key);
        assertEq(bStart2, rollTarget + FROZEN + 1, "P5: bettable starts at 12");
    }

    // =========================================================
    //      SECTION J — FUTURE WINDOWS & BETTABLE ORDERING
    // =========================================================

    // Any window >= currentWindow + frozenWindows + 1 is bettable — no ceiling.

    // Betting on a window 1000 slots away records the stake correctly.
    function test_FutureWindows_FarWindowAcceptsBet() public {
        uint256 farWid = FIRST_BET + 1000;

        _bet(alice, CELL_3000, farWid, 10_000_000);

        (uint256 pool,,,,, ) = hook.getWindow(key, farWid);
        assertEq(pool, 10_000_000, "Far window pool recorded");

        uint256 stake = hook.getUserStake(key, farWid, CELL_3000, alice);
        assertEq(stake, 10_000_000, "Far window stake recorded for alice");
    }

    // Multiple users bet on different far windows simultaneously; pools are isolated.
    function test_FutureWindows_IndependentFarPools() public {
        uint256 widA = FIRST_BET + 50;
        uint256 widB = FIRST_BET + 500;
        uint256 widC = FIRST_BET + 5000;

        _bet(alice, CELL_3000,     widA, 10_000_000);
        _bet(bob,   CELL_3000 + 1, widB, 20_000_000);
        _bet(carol, CELL_3000,     widC, 30_000_000);

        (uint256 poolA,,,,, ) = hook.getWindow(key, widA);
        (uint256 poolB,,,,, ) = hook.getWindow(key, widB);
        (uint256 poolC,,,,, ) = hook.getWindow(key, widC);

        assertEq(poolA, 10_000_000, "Window A isolated");
        assertEq(poolB, 20_000_000, "Window B isolated");
        assertEq(poolC, 30_000_000, "Window C isolated");
    }

    // Settling a near window does not disturb a far window's pool.
    function test_FutureWindows_NearSettleDoesNotTouchFar() public {
        uint256 nearWid = FIRST_BET;
        uint256 farWid  = FIRST_BET + 200;

        _bet(alice, CELL_3000, nearWid, 10_000_000);
        _bet(bob,   CELL_3000, farWid,  25_000_000);

        // Settle the near window (Bob wins nothing here — only Alice bet on it)
        _settle(nearWid, PRICE_3000); // Alice is the sole bettor on the winning cell

        // Far window pool is untouched
        (uint256 farPool,,,,, ) = hook.getWindow(key, farWid);
        assertEq(farPool, 25_000_000, "Far window pool intact after near settle");
    }

    // A rollover from a near window never lands in a far window that already has bets.
    // It goes to the first window in the bettable zone at settlement time,
    // which is currentWindow + frozenWindows + 1 — well below farWid.
    function test_FutureWindows_RolloverGoesToFirstBettable_NotFarWindow() public {
        uint256 nearWid = FIRST_BET;        // window 4
        uint256 farWid  = FIRST_BET + 200;  // window 204

        _bet(alice, CELL_3000 + 1, nearWid, 10_000_000); // wrong cell → no winner → rollover
        _bet(bob,   CELL_3000,     farWid,  25_000_000);

        uint256 ws = _windowStart(nearWid);
        _setPrice(PRICE_3000, ws); // winning cell = CELL_3000, but Alice bet CELL_3000+1
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, nearWid, hex"01");

        // Rollover target: max(nearWid+1, nearWid+frozenWindows+1) = nearWid+frozenWindows+1 = 8
        uint256 rollTarget = nearWid + FROZEN + 1; // 8
        (uint256 rollPool,,,,, ) = hook.getWindow(key, rollTarget);
        assertEq(rollPool, 10_000_000, "Rollover landed in first bettable window");

        // Far window untouched by rollover
        (uint256 farPool,,,,, ) = hook.getWindow(key, farWid);
        assertEq(farPool, 25_000_000, "Far window pool not affected by rollover");
    }

    // Bet on a far window then warp to it and settle normally.
    function test_FutureWindows_FarWindowSettlesAndPays() public {
        uint256 farWid = FIRST_BET + 100; // window 104

        _bet(alice, CELL_3000,     farWid, 10_000_000);
        _bet(bob,   CELL_3000 + 1, farWid, 10_000_000); // loser

        uint256 ws = _windowStart(farWid);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, farWid, hex"01");

        (, bool settled, bool voided,, uint256 winCell,) = hook.getWindow(key, farWid);
        assertTrue(settled,          "Far window settled");
        assertFalse(voided,          "Far window not voided");
        assertEq(winCell, CELL_3000, "Far window winning cell correct");

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256[] memory wids = new uint256[](1);
        wids[0] = farWid;
        vm.prank(alice);
        hook.claimAll(key, wids);

        uint256 fee      = (20_000_000 * FEE_BPS) / 10_000;
        uint256 expected = 20_000_000 - fee;
        assertEq(usdc.balanceOf(alice) - aliceBefore, expected, "Alice wins full net pool");
    }

    // bettableStart advances each window; far windows stay bettable throughout.
    function test_FutureWindows_StartAdvancesButFarAlwaysBettable() public {
        uint256 farWid = FIRST_BET + 500;

        // t=EPOCH: currentWindow=0, bettableStart=4
        vm.warp(EPOCH);
        (uint256 s0, ) = hook.getBettableWindows(key);
        assertEq(s0, FIRST_BET, "Start at epoch = FIRST_BET");

        // farWid is bettable at epoch
        _bet(alice, CELL_3000, farWid, 5_000_000);

        // Warp forward 50 windows: currentWindow=50, bettableStart=54
        vm.warp(EPOCH + 50 * WIN_DUR);
        (uint256 s50, ) = hook.getBettableWindows(key);
        assertEq(s50, 50 + FROZEN + 1, "Start advanced to 54");

        // farWid (504) is still bettable (504 >= 54)
        _bet(bob, CELL_3000, farWid, 5_000_000);

        (uint256 pool,,,,, ) = hook.getWindow(key, farWid);
        assertEq(pool, 10_000_000, "Far window accumulated bets from two timestamps");
    }

    // Bets on windows placed out of chronological order are each independent.
    // Placing a bet on window 500, then window 10, then window 50 all succeed.
    function test_FutureWindows_BetsOutOfOrder() public {
        uint256 widLast  = FIRST_BET + 500;
        uint256 widFirst = FIRST_BET;
        uint256 widMid   = FIRST_BET + 50;

        // Bet on them in reverse order: far → near
        _bet(alice, CELL_3000, widLast,  10_000_000);
        _bet(alice, CELL_3000, widFirst, 10_000_000);
        _bet(alice, CELL_3000, widMid,   10_000_000);

        (uint256 pLast,  ,,,, ) = hook.getWindow(key, widLast);
        (uint256 pFirst, ,,,, ) = hook.getWindow(key, widFirst);
        (uint256 pMid,   ,,,, ) = hook.getWindow(key, widMid);

        assertEq(pLast,  10_000_000, "Far window has correct pool");
        assertEq(pFirst, 10_000_000, "Near window has correct pool");
        assertEq(pMid,   10_000_000, "Mid window has correct pool");

        // Frozen zone still enforced: window FROZEN (window 3) should revert
        vm.prank(alice);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(key, CELL_3000, FROZEN, 1_000_000); // frozen
    }

    // =========================================================
    //  SECTION K — SETTLEMENT GUARDS: FROZEN & FUTURE WINDOWS
    // =========================================================
    //
    //  Settlement requires block.timestamp >= windowStart.
    //  Neither frozen-zone windows nor far-future bettable windows
    //  can be settled before their start time arrives.
    //
    //  Betting zones (at any moment T, currentWindow = C):
    //    C+1 .. C+frozenWindows        frozen  — no betting, no settling
    //    C+frozenWindows+1 .. ∞        bettable — betting allowed, settling blocked until start
    //    <= C                          past/current — betting closed, settling allowed
    //

    // A window in the frozen zone cannot be settled even if time is at epoch.
    function test_Settlement_FrozenZoneWindow_Reverts_NotStarted() public {
        uint256 frozenWid = FROZEN; // window 3, in the frozen zone at t=EPOCH (currentWindow=0)

        vm.warp(EPOCH);
        vm.prank(keeper);
        vm.expectRevert("Window not started");
        hook.settle{value: 0.01 ether}(key, frozenWid, hex"01");
    }

    // A far bettable window (has bets placed) cannot be settled until its windowStart.
    function test_Settlement_FarBettableWindow_Reverts_BeforeStart() public {
        uint256 farWid = FIRST_BET + 100; // window 104

        _bet(alice, CELL_3000, farWid, 10_000_000);

        // Still at EPOCH — windowStart(104) is far in the future
        vm.warp(EPOCH);
        vm.prank(keeper);
        vm.expectRevert("Window not started");
        hook.settle{value: 0.01 ether}(key, farWid, hex"01");
    }

    // Settling exactly one second before windowStart reverts.
    function test_Settlement_FarWindow_Reverts_OneSecondBeforeStart() public {
        uint256 farWid = FIRST_BET + 50;

        _bet(alice, CELL_3000, farWid, 10_000_000);

        uint256 ws = _windowStart(farWid);
        vm.warp(ws - 1); // one second early
        vm.prank(keeper);
        vm.expectRevert("Window not started");
        hook.settle{value: 0.01 ether}(key, farWid, hex"01");
    }

    // Settling exactly at windowStart succeeds.
    function test_Settlement_FarWindow_Succeeds_AtExactStart() public {
        uint256 farWid = FIRST_BET + 50;

        _bet(alice, CELL_3000, farWid, 10_000_000);

        uint256 ws = _windowStart(farWid);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws); // exactly at start
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, farWid, hex"01");

        (, bool settled,,,, ) = hook.getWindow(key, farWid);
        assertTrue(settled, "Far window settles at its windowStart");
    }

    // Frozen-zone windows cannot be bet on AND cannot be settled.
    // After enough time passes (window leaves frozen zone), betting & settling open.
    function test_Settlement_FrozenWindow_BothBlockedUntilTimeAdvances() public {
        // At t=EPOCH, window FROZEN (=3) is in the frozen zone.
        // It cannot be bet on and cannot be settled.
        vm.warp(EPOCH);

        vm.prank(alice);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(key, CELL_3000, FROZEN, 1_000_000);

        vm.prank(keeper);
        vm.expectRevert("Window not started");
        hook.settle{value: 0.01 ether}(key, FROZEN, hex"01");

        // Warp to windowStart(FROZEN) — the window is no longer frozen and can now be settled
        uint256 ws = _windowStart(FROZEN);
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);

        // Betting is still closed (currentWindow == FROZEN, so it's past the bettable zone)
        vm.prank(alice);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(key, CELL_3000, FROZEN, 1_000_000);

        // But settling now succeeds (no bets → auto-void below threshold)
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, FROZEN, hex"01");

        (, , bool voided,,,) = hook.getWindow(key, FROZEN);
        assertTrue(voided, "Empty window auto-voided after threshold check");
    }

    // Confirming the boundary: windowStart-1 reverts, windowStart succeeds.
    function test_Settlement_ExactBoundary_FrozenWindow() public {
        uint256 wid = FROZEN; // window 3
        uint256 ws  = _windowStart(wid);

        // No bets — auto-void path, but the time guard comes first
        vm.warp(ws - 1);
        vm.prank(keeper);
        vm.expectRevert("Window not started");
        hook.settle{value: 0.01 ether}(key, wid, hex"01");

        // At exactly windowStart the time guard passes
        _setPrice(PRICE_3000, ws);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid, hex"01"); // succeeds (auto-void, no bets)
    }

    // =========================================================
    //                   INTERNAL HELPERS
    // =========================================================

    function _users() internal view returns (address[] memory) {
        address[] memory arr = new address[](3);
        arr[0] = alice;
        arr[1] = bob;
        arr[2] = carol;
        return arr;
    }

    function _windowStart(uint256 wid) internal pure returns (uint256) {
        return EPOCH + wid * WIN_DUR;
    }

    function _bet(address user, uint256 cell, uint256 wid, uint256 amount) internal {
        vm.prank(user);
        hook.placeBet(key, cell, wid, amount);
    }

    function _setPrice(uint256 usdcPrice, uint256 timestamp) internal {
        int32 expo = -8;
        int32  adj  = -expo - 6; // = 2
        int64  pyx  = SafeCast.toInt64(SafeCast.toInt256(usdcPrice * (10 ** uint32(adj))));
        pyth.setPrice(FEED_ID, pyx, expo, uint64(timestamp));
    }

    function _settle(uint256 wid, uint256 usdcPrice) internal {
        uint256 ws = _windowStart(wid);
        _setPrice(usdcPrice, ws);
        vm.warp(ws);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid, hex"01");
    }

    function _settleAt(uint256 wid, uint256 usdcPrice, uint256 atTime) internal {
        _setPrice(usdcPrice, atTime);
        vm.warp(atTime);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(key, wid, hex"01");
    }
}

// =============================================================
//                        MOCKS
// =============================================================

contract MockPM {
    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function sync(Currency) external {}

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        require(IERC20(Currency.unwrap(currency)).transfer(to, amount), "MockPM: take failed");
    }
}

contract MockERC20 is IERC20 {
    string  public name     = "USD Coin";
    string  public symbol   = "USDC";
    uint8   public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply   += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (msg.sender != from) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        return true;
    }
}

contract MockPyth is IPyth {
    struct Entry { int64 price; int32 expo; uint64 ts; }
    mapping(bytes32 => Entry) private _prices;
    bool private _forceUnresolved;

    function setPrice(bytes32 id, int64 price, int32 expo, uint64 ts) external {
        _prices[id] = Entry(price, expo, ts);
    }

    /// @dev When true, parsePriceFeedUpdates always throws PriceFeedNotFoundWithinRange
    function setUnresolved(bool v) external { _forceUnresolved = v; }

    error PriceFeedNotFoundWithinRange();

    function parsePriceFeedUpdates(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory feeds) {
        if (msg.value < 0.01 ether) revert("Insufficient fee");
        if (_forceUnresolved || updateData.length == 0 || updateData[0][0] == bytes1(0xff)) {
            revert PriceFeedNotFoundWithinRange();
        }

        feeds = new PythStructs.PriceFeed[](priceIds.length);
        for (uint256 i = 0; i < priceIds.length; i++) {
            Entry storage e = _prices[priceIds[i]];
            if (e.ts < minPublishTime || e.ts > maxPublishTime) {
                revert PriceFeedNotFoundWithinRange();
            }
            feeds[i] = PythStructs.PriceFeed({
                id: priceIds[i],
                price: PythStructs.Price(e.price, 0, e.expo, e.ts),
                emaPrice: PythStructs.Price(e.price, 0, e.expo, e.ts)
            });
        }
    }

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory) {
        return this.parsePriceFeedUpdates{value: msg.value}(updateData, priceIds, minPublishTime, maxPublishTime);
    }

    function getUpdateFee(bytes[] calldata) external pure override returns (uint256) { return 0.01 ether; }
    function getValidTimePeriod() external pure override returns (uint256) { return 60; }
    function getPrice(bytes32) external pure override returns (PythStructs.Price memory) { return PythStructs.Price(0,0,0,0); }
    function getEmaPrice(bytes32) external pure override returns (PythStructs.Price memory) { return PythStructs.Price(0,0,0,0); }
    function getPriceUnsafe(bytes32) external pure override returns (PythStructs.Price memory) { return PythStructs.Price(0,0,0,0); }
    function getPriceNoOlderThan(bytes32, uint256) external pure override returns (PythStructs.Price memory) { return PythStructs.Price(0,0,0,0); }
    function getEmaPriceUnsafe(bytes32) external pure override returns (PythStructs.Price memory) { return PythStructs.Price(0,0,0,0); }
    function getEmaPriceNoOlderThan(bytes32, uint256) external pure override returns (PythStructs.Price memory) { return PythStructs.Price(0,0,0,0); }
    function updatePriceFeeds(bytes[] calldata) external payable override {}
    function updatePriceFeedsIfNecessary(bytes[] calldata, bytes32[] calldata, uint64[] calldata) external payable override {}
}
