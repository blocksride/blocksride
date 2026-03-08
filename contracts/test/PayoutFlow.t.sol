// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PariHook} from "../src/PariHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// =============================================================================
//                          MOCK PYTH ORACLE
// =============================================================================

/// @dev Minimal Pyth stub — only implements the two functions called by PariHook.settle().
///      Does NOT inherit IPyth to avoid implementing the full interface.
///      Casting to IPyth(address(mockPyth)) still works via ABI dispatch.
contract MockPyth {
    int64 public mockPrice;
    int32 public mockExpo = -6; // expo=-6 means price is already in 6-decimal USDC units

    function setMockPrice(int64 price) external {
        mockPrice = price;
    }

    /// @dev PariHook calls this to calculate the Pyth update fee (we return 0).
    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }

    /// @dev PariHook calls this to obtain the closing price.
    ///      We ignore publishTime bounds — the hook delegates that check to Pyth, which is us.
    ///      We return block.timestamp as publishTime, always within the grace window when
    ///      called from _forceSettle (which warps to windowEnd+5).
    function parsePriceFeedUpdates(
        bytes[] calldata,
        bytes32[] calldata priceIds,
        uint64,
        uint64
    ) external payable returns (PythStructs.PriceFeed[] memory feeds) {
        feeds = new PythStructs.PriceFeed[](priceIds.length);
        for (uint256 i = 0; i < priceIds.length; i++) {
            feeds[i].id = priceIds[i];
            feeds[i].price.price = mockPrice;
            feeds[i].price.expo = mockExpo;
            feeds[i].price.publishTime = block.timestamp;
        }
    }

    receive() external payable {}
}

// =============================================================================
//                         MOCK POOL MANAGER
// =============================================================================

/// @dev Minimal PoolManager stub for testing the unlock/unlockCallback pattern.
///      Implements exactly the functions that PariHook.unlockCallback calls:
///        sync()   — no-op (no transient-storage tracking needed in tests)
///        settle() — no-op (delta tracking not enforced in tests)
///        take()   — transfers ERC-20 from MockPoolManager's own balance to `to`
///      unlock() routes data straight to hook.unlockCallback(), which in turn
///      calls transferFrom/transfer to move tokens into/out of MockPoolManager,
///      then calls settle() and take() to complete the round-trip.
contract MockPoolManager {
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

/**
 * @title PayoutFlowTest
 * @notice End-to-end tests for the complete betting lifecycle:
 *         bet → settle → pushPayouts / claimAll / claimAllFor / claimRefund
 *
 * Settlement uses a MockPyth oracle so tests can call hook.settle() directly
 * without real Pyth VAA data. Void tests use hook.voidWindow() (ADMIN_ROLE).
 */
contract PayoutFlowTest is Test {
    using PoolIdLibrary for PoolKey;

    // ── Contracts ──────────────────────────────────────────────────────────
    PariHook public hook;
    MockPyth public mockPyth;
    MockPoolManager public mockPM;
    MockERC20 public usdc;

    // ── Roles ──────────────────────────────────────────────────────────────
    address public admin = address(this); // test contract is admin
    address public treasury = makeAddr("treasury");

    uint256 public relayerPk = 0xA11CE; // private key for EIP-712 signing
    address public relayer;

    // ── Users ──────────────────────────────────────────────────────────────
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    // ── Pool config ────────────────────────────────────────────────────────
    PoolKey public poolKey;
    PoolId public poolId;

    bytes32 constant PYTH_FEED_ID = bytes32(uint256(0x1234));
    uint256 constant BAND_WIDTH = 2_000_000; // $2.00
    uint256 constant WINDOW_DURATION = 60;
    uint256 constant FROZEN_WINDOWS = 3;
    uint256 constant MAX_STAKE = 100_000_000_000;
    uint256 constant FEE_BPS = 200; // 2%
    uint256 constant MIN_THRESHOLD = 1_000_000; // $1
    uint256 constant GRID_EPOCH = 120; // minute-aligned, forge default ts=1

    // ── Amounts ────────────────────────────────────────────────────────────
    uint256 constant ALICE_BET = 10_000_000; // $10
    uint256 constant BOB_BET = 40_000_000; // $40
    uint256 constant INITIAL_BALANCE = 1_000_000_000; // $1000

    // ── Test cell / window ─────────────────────────────────────────────────
    uint256 public targetCell;
    uint256 public targetWindow;
    uint256 public altCell;

    // ── Events ─────────────────────────────────────────────────────────────
    event PayoutPushed(PoolId indexed poolId, uint256 indexed windowId, address indexed winner, uint256 amount);
    event PayoutClaimed(PoolId indexed poolId, uint256 indexed windowId, address indexed winner, uint256 amount);
    event RefundClaimed(PoolId indexed poolId, uint256 indexed windowId, address indexed user, uint256 amount);

    // =======================================================================
    //                              SETUP
    // =======================================================================

    function setUp() public {
        relayer = vm.addr(relayerPk);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        mockPyth = new MockPyth();
        mockPM = new MockPoolManager();
        hook = new PariHook(
            IPoolManager(address(mockPM)),
            IPyth(address(mockPyth)),
            admin,
            treasury,
            relayer
        );

        poolKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // Configure grid
        hook.configureGrid(
            poolKey,
            PYTH_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE,
            FEE_BPS,
            MIN_THRESHOLD,
            GRID_EPOCH,
            address(usdc)
        );

        // Warp past epoch so grid is live
        vm.warp(GRID_EPOCH + 1);

        // Fund users
        usdc.mint(alice, INITIAL_BALANCE);
        usdc.mint(bob, INITIAL_BALANCE);
        usdc.mint(carol, INITIAL_BALANCE);
        usdc.mint(treasury, INITIAL_BALANCE);

        vm.prank(alice);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(treasury);
        usdc.approve(address(hook), type(uint256).max);

        // Pick a bettable window and cells
        (uint256 bettableStart,) = hook.getBettableWindows(poolKey);
        targetWindow = bettableStart;
        targetCell = 1500; // winning cell (we'll force settlement here)
        altCell = 1501; // losing cell
    }

    // =======================================================================
    //                     SETTLEMENT HELPERS
    // =======================================================================

    /// @dev Settles a window via the real hook.settle() path using MockPyth.
    ///      Sets mock price so that closingPrice / bandWidth == winningCell,
    ///      warps past the window's end time, then calls settle().
    ///      expo=-6 means the price integer is already in USDC 6-decimal units,
    ///      so no scaling is applied by _parsePythPrice.
    function _forceSettle(uint256 windowId, uint256 winningCell) internal {
        // Price = middle of the target band (avoids boundary rounding)
        int64 rawPrice = SafeCast.toInt64(SafeCast.toInt256(winningCell * BAND_WIDTH + BAND_WIDTH / 2));
        mockPyth.setMockPrice(rawPrice);

        // Warp into the 10-second grace window after windowEnd
        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd + 5);

        hook.settle(poolKey, windowId, bytes("X"));
    }

    /// @dev Voids a window via the privileged admin path (test contract holds ADMIN_ROLE).
    function _forceVoid(uint256 windowId) internal {
        hook.voidWindow(poolKey, windowId);
    }

    // =======================================================================
    //                    PUSH PAYOUTS TESTS
    // =======================================================================

    function test_PushPayouts_SingleWinner() public {
        // Alice bets on the winning cell
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        // Force settlement
        _forceSettle(targetWindow, targetCell);

        // Get expected payout
        uint256 expectedPayout = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        assertGt(expectedPayout, 0, "expectedPayout should be > 0");

        // Treasury pushes payout
        address[] memory winners = new address[](1);
        winners[0] = alice;

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.expectEmit(true, true, true, false);
        emit PayoutPushed(poolId, targetWindow, alice, 0); // amount checked separately

        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);

        // Verify Alice received her payout
        assertEq(usdc.balanceOf(alice), aliceBefore + expectedPayout, "Alice should receive payout");

        // Verify double-push is prevented
        uint256 aliceAfterFirst = usdc.balanceOf(alice);
        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);
        assertEq(usdc.balanceOf(alice), aliceAfterFirst, "Second push should be no-op");
    }

    function test_PushPayouts_MultipleWinners() public {
        // Alice and Bob both bet on the winning cell
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        vm.prank(bob);
        hook.placeBet(poolKey, targetCell, targetWindow, BOB_BET);

        _forceSettle(targetWindow, targetCell);

        uint256 alicePayout = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        uint256 bobPayout = hook.calculatePayout(poolKey, targetWindow, targetCell, bob);

        address[] memory winners = new address[](2);
        winners[0] = alice;
        winners[1] = bob;

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);

        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);

        assertEq(usdc.balanceOf(alice), aliceBefore + alicePayout, "Alice payout mismatch");
        assertEq(usdc.balanceOf(bob), bobBefore + bobPayout, "Bob payout mismatch");

        // Payouts should be proportional to stake
        // Alice: 10/(10+40) = 20%, Bob: 40/(10+40) = 80%
        assertApproxEqRel(alicePayout, bobPayout / 4, 0.01e18, "Payouts should be proportional");
    }

    function test_PushPayouts_LoserGetsNothing() public {
        // Alice bets on winning cell, Bob bets on losing cell
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        vm.prank(bob);
        hook.placeBet(poolKey, altCell, targetWindow, BOB_BET);

        _forceSettle(targetWindow, targetCell);

        address[] memory winners = new address[](2);
        winners[0] = alice;
        winners[1] = bob;

        uint256 bobBefore = usdc.balanceOf(bob);

        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);

        // Bob should get nothing
        assertEq(usdc.balanceOf(bob), bobBefore, "Bob (loser) should get nothing");
    }

    function test_PushPayouts_RevertWhen_NotSettled() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        address[] memory winners = new address[](1);
        winners[0] = alice;

        vm.expectRevert("Window not settled");
        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);
    }

    function test_PushPayouts_RevertWhen_NotTreasury() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        _forceSettle(targetWindow, targetCell);

        address[] memory winners = new address[](1);
        winners[0] = alice;

        vm.expectRevert();
        vm.prank(alice);
        hook.pushPayouts(poolKey, targetWindow, winners);
    }

    // =======================================================================
    //                       CLAIM ALL (PULL) TESTS
    // =======================================================================

    function test_ClaimAll_Winner() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        _forceSettle(targetWindow, targetCell);

        uint256 expectedPayout = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        uint256 aliceBefore = usdc.balanceOf(alice);

        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;

        vm.expectEmit(true, true, true, false);
        emit PayoutClaimed(poolId, targetWindow, alice, 0);

        vm.prank(alice);
        hook.claimAll(poolKey, windowIds);

        assertEq(usdc.balanceOf(alice), aliceBefore + expectedPayout, "Alice should receive payout");
    }

    function test_ClaimAll_MultipleWindows() public {
        (uint256 bStart,) = hook.getBettableWindows(poolKey);
        uint256 window2 = bStart + 1;

        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, window2, ALICE_BET);

        _forceSettle(targetWindow, targetCell);
        _forceSettle(window2, targetCell);

        uint256 payout1 = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        uint256 payout2 = hook.calculatePayout(poolKey, window2, targetCell, alice);

        uint256 aliceBefore = usdc.balanceOf(alice);

        uint256[] memory windowIds = new uint256[](2);
        windowIds[0] = targetWindow;
        windowIds[1] = window2;

        vm.prank(alice);
        hook.claimAll(poolKey, windowIds);

        assertEq(usdc.balanceOf(alice), aliceBefore + payout1 + payout2, "Should claim both windows");
    }

    function test_ClaimAll_SkipsUnsettledWindows() public {
        (uint256 bStart,) = hook.getBettableWindows(poolKey);
        uint256 window2 = bStart + 1;

        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, window2, ALICE_BET);

        // Only settle the first window
        _forceSettle(targetWindow, targetCell);

        uint256 payout1 = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        uint256 aliceBefore = usdc.balanceOf(alice);

        uint256[] memory windowIds = new uint256[](2);
        windowIds[0] = targetWindow;
        windowIds[1] = window2; // unsettled — should be skipped

        vm.prank(alice);
        hook.claimAll(poolKey, windowIds);

        assertEq(usdc.balanceOf(alice), aliceBefore + payout1, "Should only get payout for settled window");
    }

    function test_ClaimAll_NoPayout_WhenLoser() public {
        vm.prank(alice);
        hook.placeBet(poolKey, altCell, targetWindow, ALICE_BET); // wrong cell

        _forceSettle(targetWindow, targetCell);

        uint256 aliceBefore = usdc.balanceOf(alice);

        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;

        vm.prank(alice);
        hook.claimAll(poolKey, windowIds); // should not revert, just no payout

        assertEq(usdc.balanceOf(alice), aliceBefore, "Loser should receive nothing");
    }

    function test_ClaimAll_PreventDoubleClaim() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        _forceSettle(targetWindow, targetCell);

        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;

        vm.prank(alice);
        hook.claimAll(poolKey, windowIds);

        uint256 aliceAfterFirst = usdc.balanceOf(alice);

        vm.prank(alice);
        hook.claimAll(poolKey, windowIds); // second claim

        assertEq(usdc.balanceOf(alice), aliceAfterFirst, "Second claim should be no-op");
    }

    // =======================================================================
    //                     CLAIM ALL FOR (GASLESS) TESTS
    // =======================================================================

    function test_ClaimAllFor_WithValidSignature() public {
        // Use Alice's embedded wallet (we control her private key for testing)
        uint256 alicePk = 0xA11CE2;
        address aliceSigner = vm.addr(alicePk);

        usdc.mint(aliceSigner, INITIAL_BALANCE);
        vm.prank(aliceSigner);
        usdc.approve(address(hook), type(uint256).max);

        vm.prank(aliceSigner);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        _forceSettle(targetWindow, targetCell);

        uint256 expectedPayout = hook.calculatePayout(poolKey, targetWindow, targetCell, aliceSigner);

        // Build EIP-712 ClaimIntent digest
        uint256 nonce = hook.claimNonces(aliceSigner);
        uint256 deadline = block.timestamp + 300;
        bytes32 pid = bytes32(PoolId.unwrap(poolId));

        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;

        bytes32 windowIdsHash = keccak256(abi.encodePacked(windowIds));
        bytes32 structHash = keccak256(
            abi.encode(hook.CLAIM_INTENT_TYPEHASH(), aliceSigner, pid, windowIdsHash, nonce, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", hook.DOMAIN_SEPARATOR(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        uint256 balanceBefore = usdc.balanceOf(aliceSigner);

        vm.expectEmit(true, true, true, false);
        emit PayoutClaimed(poolId, targetWindow, aliceSigner, 0);

        vm.prank(relayer);
        hook.claimAllFor(poolKey, windowIds, aliceSigner, deadline, v, r, s);

        assertEq(usdc.balanceOf(aliceSigner), balanceBefore + expectedPayout, "claimAllFor payout mismatch");

        // Nonce should be incremented
        assertEq(hook.claimNonces(aliceSigner), nonce + 1, "Nonce should increment after claim");
    }

    function test_ClaimAllFor_RevertWhen_InvalidSignature() public {
        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;

        uint256 deadline = block.timestamp + 300;

        // Sign with wrong private key
        uint256 wrongPk = 0xBAD;
        bytes32 digest = keccak256("wrong data");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);

        vm.expectRevert("Invalid signature");
        vm.prank(relayer);
        hook.claimAllFor(poolKey, windowIds, alice, deadline, v, r, s);
    }

    function test_ClaimAllFor_RevertWhen_Expired() public {
        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;

        uint256 deadline = block.timestamp - 1; // already expired

        vm.expectRevert("Signature expired");
        vm.prank(relayer);
        hook.claimAllFor(poolKey, windowIds, alice, deadline, 0, 0, 0);
    }

    function test_ClaimAllFor_RevertWhen_NotRelayer() public {
        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;

        vm.expectRevert();
        vm.prank(alice);
        hook.claimAllFor(poolKey, windowIds, alice, block.timestamp + 300, 0, 0, 0);
    }

    // =======================================================================
    //                       CLAIM REFUND TESTS
    // =======================================================================

    function test_ClaimRefund_VoidedWindow() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        vm.prank(bob);
        hook.placeBet(poolKey, altCell, targetWindow, BOB_BET);

        // Void the window
        _forceVoid(targetWindow);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);

        vm.expectEmit(true, true, true, false);
        emit RefundClaimed(poolId, targetWindow, alice, 0);

        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);

        assertEq(usdc.balanceOf(alice), aliceBefore + ALICE_BET, "Alice should get full refund");

        vm.prank(bob);
        hook.claimRefund(poolKey, targetWindow);

        assertEq(usdc.balanceOf(bob), bobBefore + BOB_BET, "Bob should get full refund");
    }

    function test_ClaimRefund_RevertWhen_NotVoided() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        // Window is active (not voided)
        vm.expectRevert("Window not voided");
        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);
    }

    function test_ClaimRefund_RevertWhen_NoStake() public {
        _forceVoid(targetWindow);

        // Carol has no stake in this window
        vm.expectRevert("No stake to refund");
        vm.prank(carol);
        hook.claimRefund(poolKey, targetWindow);
    }

    function test_ClaimRefund_PreventDoubleRefund() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        _forceVoid(targetWindow);

        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);

        uint256 aliceAfterFirst = usdc.balanceOf(alice);

        vm.expectRevert("No stake to refund");
        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);

        assertEq(usdc.balanceOf(alice), aliceAfterFirst, "Balance should not change on second refund attempt");
    }

    // =======================================================================
    //                        ADMIN FUNCTION TESTS
    // =======================================================================

    function test_WithdrawFees_Success() public {
        // Alice bets, we settle to generate fees
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        _forceSettle(targetWindow, targetCell);

        // Push payout to generate the fee (fee stays in contract, not pushed)
        address[] memory winners = new address[](1);
        winners[0] = alice;
        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);

        uint256 fees = hook.collectedFees(poolId);

        if (fees > 0) {
            uint256 treasuryBefore = usdc.balanceOf(treasury);
            vm.prank(treasury);
            hook.withdrawFees(poolKey, fees);
            assertEq(usdc.balanceOf(treasury), treasuryBefore + fees, "Treasury should receive fees");
            assertEq(hook.collectedFees(poolId), 0, "Fees should be zeroed");
        }
    }

    function test_WithdrawFees_RevertWhen_InsufficientFees() public {
        vm.expectRevert("Insufficient collected fees");
        vm.prank(treasury);
        hook.withdrawFees(poolKey, 1);
    }

    function test_DepositBackstop_Success() public {
        uint256 backstopAmount = 1_000_000; // $1

        (uint256 bStart,) = hook.getBettableWindows(poolKey);
        uint256 futureWindow = bStart;

        uint256 hookBefore = usdc.balanceOf(address(hook));

        vm.prank(treasury);
        hook.depositBackstop(poolKey, futureWindow, backstopAmount);

        assertEq(usdc.balanceOf(address(hook)), hookBefore + backstopAmount, "Hook should hold backstop");
        assertEq(hook.backstopBalances(poolId), backstopAmount, "Backstop balance should be tracked");
    }

    // =======================================================================
    //                     VIEW FUNCTION TESTS
    // =======================================================================

    function test_CalculatePayout_BeforeSettlement() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        uint256 payout = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        assertEq(payout, 0, "Payout should be 0 before settlement");
    }

    function test_CalculatePayout_AfterSettlement_Winner() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        vm.prank(bob);
        hook.placeBet(poolKey, altCell, targetWindow, BOB_BET);

        _forceSettle(targetWindow, targetCell);

        uint256 totalPool = ALICE_BET + BOB_BET;
        uint256 fee = (totalPool * FEE_BPS) / 10000;
        uint256 netPool = totalPool - fee;
        uint256 expectedPayout = (ALICE_BET * netPool) / ALICE_BET; // Alice is sole winner

        uint256 payout = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        assertApproxEqAbs(payout, expectedPayout, 1, "Payout calculation mismatch");
    }

    function test_CalculatePayout_AfterSettlement_Loser() public {
        vm.prank(alice);
        hook.placeBet(poolKey, altCell, targetWindow, ALICE_BET); // wrong cell

        _forceSettle(targetWindow, targetCell);

        uint256 payout = hook.calculatePayout(poolKey, targetWindow, targetCell, alice);
        assertEq(payout, 0, "Loser should have 0 payout");
    }

    function test_GetLiveMultiplier_NoStake() public view {
        uint256 multiplier = hook.getLiveMultiplier(poolKey, targetWindow, targetCell);
        assertEq(multiplier, 0, "Multiplier should be 0 when no stake");
    }

    function test_GetLiveMultiplier_SingleBettor() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        uint256 multiplier = hook.getLiveMultiplier(poolKey, targetWindow, targetCell);
        // Solo bettor: multiplier = (totalPool * 0.98) / stake = (ALICE_BET * 0.98) / ALICE_BET = 0.98e18
        uint256 expected = (ALICE_BET * (10000 - FEE_BPS) * 1e18) / (10000 * ALICE_BET);
        assertApproxEqAbs(multiplier, expected, 1, "Solo multiplier mismatch");
    }

    function test_GetLiveMultiplier_MultipleCell() public {
        // Alice on target, Bob on alt — Alice's multiplier should be > 1 (gets Bob's pool too)
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        vm.prank(bob);
        hook.placeBet(poolKey, altCell, targetWindow, BOB_BET);

        uint256 totalPool = ALICE_BET + BOB_BET;
        uint256 netPool = (totalPool * (10000 - FEE_BPS)) / 10000;
        uint256 aliceMultiplier = hook.getLiveMultiplier(poolKey, targetWindow, targetCell);
        uint256 expected = (netPool * 1e18) / ALICE_BET;

        assertApproxEqAbs(aliceMultiplier, expected, 1, "Alice multiplier mismatch");
        assertGt(aliceMultiplier, 1e18, "Alice multiplier should be > 1x (she gets Bob's pool)");
    }

    function test_HasPendingClaim_AfterSettle() public {
        vm.prank(alice);
        hook.placeBet(poolKey, targetCell, targetWindow, ALICE_BET);

        assertFalse(hook.hasPendingClaim(poolKey, targetWindow, alice), "No claim before settlement");

        _forceSettle(targetWindow, targetCell);

        assertTrue(hook.hasPendingClaim(poolKey, targetWindow, alice), "Should have pending claim after settlement");

        // After claiming, no more pending
        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;
        vm.prank(alice);
        hook.claimAll(poolKey, windowIds);

        assertFalse(hook.hasPendingClaim(poolKey, targetWindow, alice), "No claim after pulling payout");
    }

    // =======================================================================
    //                     ADMIN SETTERS TESTS
    // =======================================================================

    function test_SetFeeBps() public {
        hook.setFeeBps(poolKey, 500);
        (,,,,, uint256 feeBps,,,) = hook.gridConfigs(poolId);
        assertEq(feeBps, 500);
    }

    function test_SetFeeBps_RevertWhen_TooHigh() public {
        vm.expectRevert("Max 10%");
        hook.setFeeBps(poolKey, 1001);
    }

    function test_SetFrozenWindows() public {
        hook.setFrozenWindows(poolKey, 5);
        (,,, uint256 frozenWindows,,,,,) = hook.gridConfigs(poolId);
        assertEq(frozenWindows, 5);
    }

    function test_SetFrozenWindows_RevertWhen_Zero() public {
        vm.expectRevert("Min 1 frozen window");
        hook.setFrozenWindows(poolKey, 0);
    }

    function test_SetMinPoolThreshold() public {
        hook.setMinPoolThreshold(poolKey, 5_000_000);
        (,,,,,,,, uint256 minThreshold) = hook.gridConfigs(poolId);
        assertEq(minThreshold, 5_000_000);
    }

    function test_SetMaxStakePerCell() public {
        hook.setMaxStakePerCell(poolKey, 200_000_000_000);
        (,,,, uint256 maxStakePerCell,,,,) = hook.gridConfigs(poolId);
        assertEq(maxStakePerCell, 200_000_000_000);
    }
}

// =============================================================================
//                              MOCK ERC20
// =============================================================================

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        _totalSupply += amount;
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(_balances[msg.sender] >= amount, "Insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(_balances[from] >= amount, "Insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "Insufficient allowance");
        _balances[from] -= amount;
        _balances[to] += amount;
        _allowances[from][msg.sender] -= amount;
        return true;
    }
}
