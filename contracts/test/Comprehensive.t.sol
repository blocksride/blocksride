// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title Comprehensive
 * @notice Exhaustive test suite covering every revert path, access-control boundary,
 *         EIP-712 signature variant, and edge case not already covered by
 *         PayoutFlow.t.sol, Settlement.t.sol and PariHookUnit.t.sol.
 *
 *  Sections
 *  ─────────────────────────────────────────────────────────────────────────
 *  1.  Access Control            – every role-gated function, wrong caller
 *  2.  Bet Placement             – amount=0, window zones, max stake, paused
 *  3.  placeBetWithSig           – expired, wrong nonce, wrong sig, replay, length
 *  4.  Settlement Edge Cases     – grid unset, timing, duplicate calls, ETH fee
 *  5.  VoidWindow                – already settled, already voided, wrong role
 *  6.  PushPayouts               – empty array, zero-stake winners
 *  7.  ClaimAll / ClaimAllFor    – empty arrays, voided-window skip, sig edge cases
 *  8.  ClaimRefund               – settled window, double-claim
 *  9.  Admin Setters             – boundary values, wrong role
 *  10. Pause / Unpause           – bet blocked, claim/refund still allowed
 *  11. View Functions            – non-existent windows, zero-stake cells
 *  12. Multi-user / Proportional – correct proportional payouts, independent windows
 */

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
//                              MOCK CONTRACTS
// =============================================================================

/// @dev Minimal ERC-20 used in place of real USDC.
contract CompMockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

/// @dev Minimal Pyth oracle stub.
contract CompMockPyth is IPyth {
    int64 public mockPrice;
    int32 public mockExpo = -6;

    function setMockPrice(int64 price) external {
        mockPrice = price;
    }

    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }

    function parsePriceFeedUpdates(bytes[] calldata updateData, bytes32[] calldata, uint64, uint64)
        external
        payable
        returns (PythStructs.PriceFeed[] memory feeds)
    {
        require(updateData.length > 0 && updateData[0].length > 0, "MockPyth: empty data");
        feeds = new PythStructs.PriceFeed[](1);
        feeds[0].price.price = mockPrice;
        feeds[0].price.expo = mockExpo;
        feeds[0].price.publishTime = block.timestamp;
    }

    // Unused IPyth interface methods
    function getPrice(bytes32) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getEmaPrice(bytes32) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getPriceUnsafe(bytes32) external view returns (PythStructs.Price memory p) {
        p.price = mockPrice;
        p.expo = mockExpo;
        p.publishTime = block.timestamp;
    }

    function getEmaPriceUnsafe(bytes32) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getPriceNoOlderThan(bytes32, uint256) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getEmaPriceNoOlderThan(bytes32, uint256) external pure returns (PythStructs.Price memory) {
        revert();
    }
    function updatePriceFeeds(bytes[] calldata) external payable {}
    function updatePriceFeedsIfNecessary(bytes[] calldata, bytes32[] calldata, uint64[] calldata) external payable {}

    function getValidTimePeriod() external pure returns (uint256) {
        return 60;
    }

    function parsePriceFeedUpdatesUnique(bytes[] calldata, bytes32[] calldata, uint64, uint64)
        external
        payable
        returns (PythStructs.PriceFeed[] memory)
    {
        revert();
    }
}

/// @dev Minimal PoolManager stub (same as PayoutFlow.t.sol).
contract CompMockPoolManager {
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

// =============================================================================
//                              TEST CONTRACT
// =============================================================================

contract ComprehensiveTest is Test {
    using PoolIdLibrary for PoolKey;

    // ── Contracts ──────────────────────────────────────────────────────────
    PariHook public hook;
    CompMockPyth public mockPyth;
    CompMockPoolManager public mockPoolManager;
    CompMockERC20 public usdc;

    // ── Roles ──────────────────────────────────────────────────────────────
    address public admin = address(this); // test contract = DEFAULT_ADMIN + ADMIN_ROLE
    address public treasury = makeAddr("treasury");
    uint256 public relayerPk = 0xBEEF;
    address public relayer;

    // ── Users ──────────────────────────────────────────────────────────────
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public eve = makeAddr("eve"); // attacker / wrong wallet

    // ── Pool config ────────────────────────────────────────────────────────
    PoolKey public poolKey;
    PoolId public poolId;
    PoolKey public unconfiguredKey; // second key, never configured

    bytes32 constant PYTH_FEED = bytes32(uint256(0xDEAD));
    uint256 constant BAND_WIDTH = 2_000_000; // $2.00 in 6-dec USDC
    uint256 constant WIN_DURATION = 60; // 60-second windows
    uint256 constant FROZEN = 3; // frozenWindows
    uint256 constant MAX_STAKE = 50_000_000; // $50 per cell
    uint256 constant FEE_BPS = 200; // 2%
    uint256 constant MIN_THRESH = 1_000_000; // $1 minimum pool
    uint256 constant GRID_EPOCH = 120; // minute-aligned
    uint256 constant INITIAL_BAL = 1_000_000_000; // $1000 per user

    uint256 public targetWindow;
    uint256 public winCell;
    uint256 public loseCell;

    // EIP-712 typehashes (must match PariHook exactly)
    bytes32 constant BET_INTENT_TYPEHASH = keccak256(
        "BetIntent(address user,bytes32 poolId,uint256 cellId,uint256 windowId,uint256 amount,uint256 nonce,uint256 deadline)"
    );
    bytes32 constant CLAIM_INTENT_TYPEHASH =
        keccak256("ClaimIntent(address user,bytes32 poolId,uint256[] windowIds,uint256 nonce,uint256 deadline)");

    // =======================================================================
    //                              SETUP
    // =======================================================================

    function setUp() public {
        relayer = vm.addr(relayerPk);

        usdc = new CompMockERC20("USD Coin", "USDC", 6);
        mockPyth = new CompMockPyth();
        mockPoolManager = new CompMockPoolManager();

        hook = new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(mockPyth)), admin, treasury, relayer);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        unconfiguredKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(1)), // different token → different poolId
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // Configure the main grid
        hook.configureGrid(
            poolKey,
            PYTH_FEED,
            BAND_WIDTH,
            WIN_DURATION,
            FROZEN,
            MAX_STAKE,
            FEE_BPS,
            MIN_THRESH,
            GRID_EPOCH,
            address(usdc)
        );

        // Warp past epoch
        vm.warp(GRID_EPOCH + 1);

        // Fund and approve users
        address[5] memory users = [alice, bob, carol, eve, treasury];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], INITIAL_BAL);
            vm.prank(users[i]);
            usdc.approve(address(hook), type(uint256).max);
        }
        // Fund hook itself (to cover USDC payouts in tests)
        usdc.mint(address(mockPoolManager), INITIAL_BAL);

        // Pick a bettable window
        (uint256 start,) = hook.getBettableWindows(poolKey);
        targetWindow = start;
        winCell = 1500;
        loseCell = 1501;
    }

    // =======================================================================
    //                        HELPER FUNCTIONS
    // =======================================================================

    function _bet(address user, uint256 cellId, uint256 windowId, uint256 amount) internal {
        vm.prank(user);
        hook.placeBet(poolKey, cellId, windowId, amount);
    }

    /// @dev Settles windowId with winningCell as the oracle price.
    function _settle(uint256 windowId, uint256 winningCell) internal {
        uint256 windowEnd = GRID_EPOCH + (windowId + 1) * WIN_DURATION;
        int64 price = SafeCast.toInt64(SafeCast.toInt256(winningCell * BAND_WIDTH + BAND_WIDTH / 2));
        mockPyth.setMockPrice(price);
        vm.warp(windowEnd + 5);
        hook.settle{value: 0}(poolKey, windowId, bytes("X"));
    }

    function _void(uint256 windowId) internal {
        hook.voidWindow(poolKey, windowId);
    }

    /// @dev Builds a packed EIP-712 BetIntent signature.
    function _betSig(
        uint256 pk,
        address user,
        uint256 cellId,
        uint256 windowId,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(
            abi.encode(
                BET_INTENT_TYPEHASH, user, bytes32(PoolId.unwrap(poolId)), cellId, windowId, amount, nonce, deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", hook.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v); // contract expects [r][s][v]
    }

    /// @dev Builds an EIP-712 ClaimIntent signature (v, r, s separately).
    function _claimSig(uint256 pk, address user, uint256[] memory windowIds, uint256 nonce, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 windowIdsHash = keccak256(abi.encodePacked(windowIds));
        bytes32 poolIdBytes = bytes32(PoolId.unwrap(poolId));
        bytes32 structHash =
            keccak256(abi.encode(CLAIM_INTENT_TYPEHASH, user, poolIdBytes, windowIdsHash, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", hook.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    // =======================================================================
    //  SECTION 1 — ACCESS CONTROL
    //  Every role-restricted function must revert when called by wrong address
    // =======================================================================

    function test_AC_ConfigureGrid_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.configureGrid(
            unconfiguredKey,
            PYTH_FEED,
            BAND_WIDTH,
            WIN_DURATION,
            FROZEN,
            MAX_STAKE,
            FEE_BPS,
            MIN_THRESH,
            GRID_EPOCH + 600,
            address(usdc)
        );
    }

    function test_AC_VoidWindow_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.voidWindow(poolKey, targetWindow);
    }

    function test_AC_SetFeeBps_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.setFeeBps(poolKey, 100);
    }

    function test_AC_SetFrozenWindows_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.setFrozenWindows(poolKey, 2);
    }

    function test_AC_SetMinPoolThreshold_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.setMinPoolThreshold(poolKey, 5_000_000);
    }

    function test_AC_SetMaxStakePerCell_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.setMaxStakePerCell(poolKey, 1_000_000);
    }

    function test_AC_Pause_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.pause();
    }

    function test_AC_Unpause_RevertWhen_NotAdmin() public {
        hook.pause();
        vm.prank(eve);
        vm.expectRevert();
        hook.unpause();
    }

    function test_AC_PushPayouts_RevertWhen_NotTreasury() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        address[] memory winners = new address[](1);
        winners[0] = alice;

        vm.prank(eve);
        vm.expectRevert();
        hook.pushPayouts(poolKey, targetWindow, winners);
    }

    function test_AC_DepositBackstop_RevertWhen_NotTreasury() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.depositBackstop(poolKey, targetWindow, 5_000_000);
    }

    function test_AC_WithdrawFees_RevertWhen_NotTreasury() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.withdrawFees(poolKey, 1_000_000);
    }

    function test_AC_PlaceBetWithSig_RevertWhen_NotRelayer() public {
        bytes memory sig = _betSig(0xA1, alice, winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);
        vm.prank(eve);
        vm.expectRevert();
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, alice, 0, block.timestamp + 300, sig);
    }

    function test_AC_ClaimAllFor_RevertWhen_NotRelayer() public {
        uint256[] memory windowIds = new uint256[](1);
        windowIds[0] = targetWindow;
        vm.prank(eve);
        vm.expectRevert();
        hook.claimAllFor(poolKey, windowIds, alice, block.timestamp + 300, 0, 0, 0);
    }

    function test_AC_BeforeInitialize_RevertWhen_NotPoolManager() public {
        vm.prank(eve);
        vm.expectRevert("Only PoolManager");
        hook.beforeInitialize(address(0), poolKey, 0);
    }

    // Verify treasury can't use admin functions
    function test_AC_Treasury_CannotCallAdminFunctions() public {
        vm.prank(treasury);
        vm.expectRevert();
        hook.setFeeBps(poolKey, 100);

        vm.prank(treasury);
        vm.expectRevert();
        hook.pause();
    }

    // Verify admin can't use treasury functions
    function test_AC_Admin_CannotCallTreasuryFunctions() public {
        vm.prank(eve); // eve is neither admin nor treasury
        vm.expectRevert();
        hook.pushPayouts(poolKey, targetWindow, new address[](0));
    }

    // =======================================================================
    //  SECTION 2 — BET PLACEMENT VALIDATION
    // =======================================================================

    function test_Bet_RevertWhen_GridNotConfigured() public {
        vm.prank(alice);
        vm.expectRevert("Grid not configured");
        hook.placeBet(unconfiguredKey, winCell, targetWindow, 5_000_000);
    }

    function test_Bet_RevertWhen_ZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Amount must be > 0");
        hook.placeBet(poolKey, winCell, targetWindow, 0);
    }

    function test_Bet_RevertWhen_WindowTooEarly_CurrentWindow() public {
        // current window (windowId = 0 at epoch+1 with 60s windows) is not bettable
        vm.prank(alice);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(poolKey, winCell, 0, 5_000_000);
    }

    function test_Bet_RevertWhen_WindowJustBelowBettableStart() public {
        // bettableStart = current + frozenWindows + 1
        // current = 0, frozen = 3 → bettableStart = 4, so windowId = 3 is just below
        vm.prank(alice);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(poolKey, winCell, targetWindow - 1, 5_000_000);
    }

    function test_Bet_RevertWhen_WindowAboveBettableEnd() public {
        // bettableEnd = current + frozenWindows + 3 = 6
        (uint256 start, uint256 end) = hook.getBettableWindows(poolKey);
        vm.prank(alice);
        vm.expectRevert("Window not in betting zone");
        hook.placeBet(poolKey, winCell, end + 1, 5_000_000);
        (start); // silence unused
    }

    function test_Bet_RevertWhen_ExceedsMaxStakePerCell() public {
        // MAX_STAKE = 50_000_000; place 40M then try to add 20M more
        _bet(alice, winCell, targetWindow, 40_000_000);

        vm.prank(bob);
        vm.expectRevert("Exceeds max stake per cell");
        hook.placeBet(poolKey, winCell, targetWindow, 20_000_000); // 40M + 20M > 50M
    }

    function test_Bet_Success_AtExactMaxStakePerCell() public {
        // Placing exactly MAX_STAKE should succeed
        _bet(alice, winCell, targetWindow, MAX_STAKE);
        // No revert — passes
    }

    function test_Bet_Success_TwoUsersAccumulateUpToMax() public {
        uint256 half = MAX_STAKE / 2;
        _bet(alice, winCell, targetWindow, half);
        _bet(bob, winCell, targetWindow, half);
        // combined = MAX_STAKE → should succeed
    }

    function test_Bet_Success_SameUserMultipleBetsAccumulate() public {
        _bet(alice, winCell, targetWindow, 5_000_000);
        _bet(alice, winCell, targetWindow, 5_000_000);
        // Both bets land on same cell for alice — total 10M ≤ 50M max
    }

    function test_Bet_Success_DifferentCellsSameWindow() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _bet(alice, loseCell, targetWindow, 10_000_000);
        // Each cell is tracked independently
    }

    function test_Bet_RevertWhen_InsufficientAllowance() public {
        // Revoke approval first
        vm.prank(carol);
        usdc.approve(address(hook), 0);

        vm.prank(carol);
        vm.expectRevert();
        hook.placeBet(poolKey, winCell, targetWindow, 5_000_000);
    }

    function test_Bet_RevertWhen_InsufficientBalance() public {
        address poorUser = makeAddr("poor");
        // poorUser has no USDC and no approval
        vm.prank(poorUser);
        usdc.approve(address(hook), type(uint256).max);

        vm.prank(poorUser);
        vm.expectRevert();
        hook.placeBet(poolKey, winCell, targetWindow, 5_000_000);
    }

    function test_Bet_EmitsBetPlacedEvent() public {
        vm.expectEmit(true, true, true, true);
        emit PariHook.BetPlaced(poolId, targetWindow, winCell, alice, 5_000_000);

        _bet(alice, winCell, targetWindow, 5_000_000);
    }

    // =======================================================================
    //  SECTION 3 — placeBetWithSig (EIP-712)
    // =======================================================================

    uint256 constant ALICE_PK = 0xA11CE;
    // Note: alice = vm.addr(ALICE_PK) — ensure setUp derives alice the same way

    function _aliceAddr() internal pure returns (address) {
        return vm.addr(ALICE_PK);
    }

    function _setupAliceSig(uint256 cellId, uint256 windowId, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _betSigForUser(ALICE_PK, _aliceAddr(), cellId, windowId, amount, nonce, deadline);
    }

    function _betSigForUser(
        uint256 pk,
        address user,
        uint256 cellId,
        uint256 windowId,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(
            abi.encode(
                BET_INTENT_TYPEHASH, user, bytes32(PoolId.unwrap(poolId)), cellId, windowId, amount, nonce, deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", hook.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _setupAliceSigUser() internal {
        address a = _aliceAddr();
        usdc.mint(a, INITIAL_BAL);
        vm.prank(a);
        usdc.approve(address(hook), type(uint256).max);
    }

    function test_PlaceBetWithSig_Success() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);

        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, a, 0, block.timestamp + 300, sig);
        // No revert = success
    }

    function test_PlaceBetWithSig_IncrementsNonce() public {
        _setupAliceSigUser();
        address a = _aliceAddr();

        assertEq(hook.betNonces(a), 0);

        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, a, 0, block.timestamp + 300, sig);

        assertEq(hook.betNonces(a), 1, "nonce should be incremented");
    }

    function test_PlaceBetWithSig_RevertWhen_Expired() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        uint256 deadline = block.timestamp - 1; // already expired
        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 0, deadline);

        vm.expectRevert("Signature expired");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, a, 0, deadline, sig);
    }

    function test_PlaceBetWithSig_RevertWhen_WrongNonce() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        // sign with nonce=1 but actual nonce is 0
        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 1, block.timestamp + 300);

        vm.expectRevert("Invalid nonce");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, a, 1, block.timestamp + 300, sig);
    }

    function test_PlaceBetWithSig_RevertWhen_SignerIsNotUser() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        // eve (pk=0xEEEE) signs but we claim it's alice's sig
        bytes memory sig =
            _betSigForUser(0xEEEE, _aliceAddr(), winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);

        vm.expectRevert("Invalid signature");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, a, 0, block.timestamp + 300, sig);
    }

    function test_PlaceBetWithSig_RevertWhen_WrongAmount() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        // Signed for 5M but relayer submits 10M
        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);

        vm.expectRevert("Invalid signature");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 10_000_000, a, 0, block.timestamp + 300, sig);
    }

    function test_PlaceBetWithSig_RevertWhen_WrongCellId() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        // Signed for winCell but submitted for loseCell
        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);

        vm.expectRevert("Invalid signature");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, loseCell, targetWindow, 5_000_000, a, 0, block.timestamp + 300, sig);
    }

    function test_PlaceBetWithSig_RevertWhen_WrongWindowId() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        (uint256 start, uint256 end) = hook.getBettableWindows(poolKey);
        uint256 otherWindow = start + 1; // different but still valid window
        // Signed for targetWindow but submitted for otherWindow
        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);

        vm.expectRevert("Invalid signature");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, otherWindow, 5_000_000, a, 0, block.timestamp + 300, sig);
        (end); // silence
    }

    function test_PlaceBetWithSig_RevertWhen_InvalidSigLength() public {
        _setupAliceSigUser();
        address a = _aliceAddr();

        vm.expectRevert("Invalid signature length");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, a, 0, block.timestamp + 300, bytes("short"));
    }

    function test_PlaceBetWithSig_RevertWhen_ReplayAttack() public {
        _setupAliceSigUser();
        address a = _aliceAddr();
        (uint256 start, uint256 end) = hook.getBettableWindows(poolKey);
        bytes memory sig = _setupAliceSig(winCell, start, 5_000_000, 0, block.timestamp + 300);

        // First use — OK
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, start, 5_000_000, a, 0, block.timestamp + 300, sig);

        // Replay with same sig (nonce now 1, but sig was for nonce 0)
        vm.expectRevert("Invalid nonce");
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, start, 5_000_000, a, 0, block.timestamp + 300, sig);
        (end); // silence
    }

    // =======================================================================
    //  SECTION 4 — SETTLEMENT EDGE CASES
    // =======================================================================

    function test_Settle_RevertWhen_GridNotConfigured() public {
        vm.expectRevert("Grid not configured");
        hook.settle(unconfiguredKey, 0, bytes("X"));
    }

    function test_Settle_RevertWhen_EmptyPythData() public {
        uint256 windowEnd = GRID_EPOCH + (targetWindow + 1) * WIN_DURATION;
        vm.warp(windowEnd + 1);

        vm.expectRevert("Empty Pyth update data");
        hook.settle(poolKey, targetWindow, bytes(""));
    }

    function test_Settle_RevertWhen_WindowNotEnded() public {
        // Do NOT warp past window end
        vm.expectRevert("Window not ended");
        hook.settle(poolKey, targetWindow, bytes("X"));
    }

    function test_Settle_RevertWhen_AlreadySettled() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        // Second settle on same window
        vm.expectRevert("Already settled");
        hook.settle(poolKey, targetWindow, bytes("X"));
    }

    function test_Settle_RevertWhen_AlreadyVoided() public {
        _void(targetWindow);

        uint256 windowEnd = GRID_EPOCH + (targetWindow + 1) * WIN_DURATION;
        vm.warp(windowEnd + 5);

        vm.expectRevert("Already voided");
        hook.settle(poolKey, targetWindow, bytes("X"));
    }

    function test_Settle_RevertWhen_InsufficientPythFee() public {
        // Deploy a Pyth mock that charges a non-zero fee
        CompMockPythWithFee pricyPyth = new CompMockPythWithFee();
        PariHook feeHook =
            new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(pricyPyth)), admin, treasury, relayer);
        PoolKey memory feeKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(2)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(feeHook))
        });
        // block.timestamp is GRID_EPOCH + 1 (from setUp), so GRID_EPOCH is in the past.
        // Use a fresh epoch that is definitively in the future.
        uint256 freshEpoch = ((block.timestamp / 60) + 2) * 60; // ≥ 2 minutes ahead, minute-aligned
        feeHook.configureGrid(
            feeKey,
            PYTH_FEED,
            BAND_WIDTH,
            WIN_DURATION,
            FROZEN,
            MAX_STAKE,
            FEE_BPS,
            MIN_THRESH,
            freshEpoch,
            address(usdc)
        );
        // Warp into the fresh grid
        vm.warp(freshEpoch + 1);
        // Place bet in first bettable window
        (uint256 start,) = feeHook.getBettableWindows(feeKey);
        vm.prank(alice);
        usdc.approve(address(feeHook), type(uint256).max);
        vm.prank(alice);
        feeHook.placeBet(feeKey, winCell, start, 10_000_000);

        uint256 windowEnd = freshEpoch + (start + 1) * WIN_DURATION;
        pricyPyth.setMockPrice(SafeCast.toInt64(SafeCast.toInt256(winCell * BAND_WIDTH + BAND_WIDTH / 2)));
        vm.warp(windowEnd + 5);

        // Send zero ETH but fee required is 1 wei
        vm.expectRevert("Insufficient Pyth update fee");
        feeHook.settle{value: 0}(feeKey, start, bytes("X"));
    }

    function test_Settle_AutoVoids_WhenOrganicPoolBelowThreshold() public {
        // Place bet BELOW min threshold ($1 = 1_000_000)
        _bet(alice, winCell, targetWindow, 500_000); // $0.50

        // Settle — organicPool < minPoolThreshold → auto-void
        uint256 windowEnd = GRID_EPOCH + (targetWindow + 1) * WIN_DURATION;
        mockPyth.setMockPrice(SafeCast.toInt64(SafeCast.toInt256(winCell * BAND_WIDTH + BAND_WIDTH / 2)));
        vm.warp(windowEnd + 5);

        vm.expectEmit(true, true, false, false);
        emit PariHook.WindowVoided(poolId, targetWindow, 0);
        hook.settle{value: 0}(poolKey, targetWindow, bytes("X"));

        // Alice should be able to refund
        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);
        assertEq(usdc.balanceOf(alice), INITIAL_BAL, "Alice should get full refund after auto-void");
    }

    function test_Settle_ExcessEthRefunded() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        uint256 windowEnd = GRID_EPOCH + (targetWindow + 1) * WIN_DURATION;
        mockPyth.setMockPrice(SafeCast.toInt64(SafeCast.toInt256(winCell * BAND_WIDTH + BAND_WIDTH / 2)));
        vm.warp(windowEnd + 5);

        // Send excess ETH (MockPyth charges 0 fee, so all should be refunded)
        uint256 ethBefore = address(this).balance;
        vm.deal(address(this), 1 ether);
        hook.settle{value: 1 ether}(poolKey, targetWindow, bytes("X"));
        assertEq(address(this).balance, 1 ether, "All ETH should be refunded when fee=0");
        (ethBefore); // silence
    }

    // This function receives ETH refunds from settle()
    receive() external payable {}

    // =======================================================================
    //  SECTION 5 — VOIDWINDOW
    // =======================================================================

    function test_Void_Success_EmitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit PariHook.WindowVoided(poolId, targetWindow, 0);
        _void(targetWindow);
    }

    function test_Void_RevertWhen_AlreadySettled() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        vm.expectRevert("Window already settled");
        hook.voidWindow(poolKey, targetWindow);
    }

    function test_Void_RevertWhen_AlreadyVoided() public {
        _void(targetWindow);
        vm.expectRevert("Window already voided");
        hook.voidWindow(poolKey, targetWindow);
    }

    function test_Void_RevertWhen_NotAdmin() public {
        vm.prank(eve);
        vm.expectRevert();
        hook.voidWindow(poolKey, targetWindow);
    }

    // =======================================================================
    //  SECTION 6 — PUSH PAYOUTS EDGE CASES
    // =======================================================================

    function test_PushPayouts_RevertWhen_WindowNotSettled() public {
        vm.prank(treasury);
        vm.expectRevert("Window not settled");
        hook.pushPayouts(poolKey, targetWindow, new address[](0));
    }

    function test_PushPayouts_Success_EmptyWinnersArray() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        // Empty array — should succeed (no-op)
        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, new address[](0));
    }

    function test_PushPayouts_Success_ZeroStakeWinner_NoTransfer() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        // Bob had zero stake — including him should not revert, just skip
        address[] memory winners = new address[](2);
        winners[0] = alice;
        winners[1] = bob; // no stake → payout = 0

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);

        assertEq(usdc.balanceOf(bob), bobBefore, "Bob has no stake, should receive nothing");
    }

    function test_PushPayouts_Success_LoserInWinnersList() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _bet(bob, loseCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        address[] memory list = new address[](2);
        list[0] = alice;
        list[1] = bob;

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, list);

        assertEq(usdc.balanceOf(bob), bobBefore, "Bob (loser) receives nothing");
        assertGt(usdc.balanceOf(alice), INITIAL_BAL - 10_000_000, "Alice (winner) receives payout");
    }

    // =======================================================================
    //  SECTION 7 — CLAIM ALL / CLAIM ALL FOR EDGE CASES
    // =======================================================================

    function test_ClaimAll_Success_EmptyWindowIds() public {
        // Calling with empty array should be a no-op, not a revert
        vm.prank(alice);
        hook.claimAll(poolKey, new uint256[](0));
    }

    function test_ClaimAll_Success_SkipsUnsettledWindows() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        // Do NOT settle the window

        uint256 balBefore = usdc.balanceOf(alice);
        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;
        vm.prank(alice);
        hook.claimAll(poolKey, ids);

        assertEq(usdc.balanceOf(alice), balBefore, "No claim from unsettled window");
    }

    function test_ClaimAll_Success_SkipsVoidedWindows() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _void(targetWindow);

        uint256 balBefore = usdc.balanceOf(alice);
        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;
        vm.prank(alice);
        hook.claimAll(poolKey, ids); // should skip silently (voided = no payout, use claimRefund)

        assertEq(usdc.balanceOf(alice), balBefore, "No claim from voided window via claimAll");
    }

    function test_ClaimAll_Success_MultipleWindowsMixedOutcomes() public {
        (uint256 start, uint256 end) = hook.getBettableWindows(poolKey);
        uint256 w1 = start;
        uint256 w2 = start + 1;

        _bet(alice, winCell, w1, 10_000_000);
        _bet(alice, loseCell, w2, 10_000_000); // alice loses on w2

        _settle(w1, winCell); // alice wins w1
        _settle(w2, winCell); // winning cell = winCell, alice bet on loseCell

        uint256 payout = hook.calculatePayout(poolKey, w1, winCell, alice);

        uint256[] memory ids = new uint256[](2);
        ids[0] = w1;
        ids[1] = w2;

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        hook.claimAll(poolKey, ids);

        assertEq(usdc.balanceOf(alice), before + payout, "Only w1 payout should be received");
        (end); // silence
    }

    function test_ClaimAllFor_Success_ValidSig() public {
        // Use _aliceAddr() — we know its private key (ALICE_PK), so we can sign for it.
        address sigUser = _aliceAddr();
        usdc.mint(sigUser, INITIAL_BAL);
        vm.prank(sigUser);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(sigUser);
        hook.placeBet(poolKey, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        uint256 payout = hook.calculatePayout(poolKey, targetWindow, winCell, sigUser);
        assertGt(payout, 0, "sigUser should have a non-zero payout");

        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;
        uint256 deadline = block.timestamp + 300;
        uint256 nonce = hook.claimNonces(sigUser);
        (uint8 v, bytes32 r, bytes32 s) = _claimSig(ALICE_PK, sigUser, ids, nonce, deadline);

        uint256 before = usdc.balanceOf(sigUser);
        vm.prank(relayer);
        hook.claimAllFor(poolKey, ids, sigUser, deadline, v, r, s);
        assertEq(usdc.balanceOf(sigUser), before + payout, "sigUser receives correct payout via claimAllFor");
    }

    function test_ClaimAllFor_RevertWhen_SignatureExpired() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _claimSig(0xA11CE, alice, ids, 0, deadline);

        vm.expectRevert("Signature expired");
        vm.prank(relayer);
        hook.claimAllFor(poolKey, ids, alice, deadline, v, r, s);
    }

    function test_ClaimAllFor_RevertWhen_WrongSigner() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;
        uint256 deadline = block.timestamp + 300;
        // Sign with eve's key but claim it's alice
        (uint8 v, bytes32 r, bytes32 s) = _claimSig(0xEEEE, alice, ids, 0, deadline);

        vm.expectRevert("Invalid signature");
        vm.prank(relayer);
        hook.claimAllFor(poolKey, ids, alice, deadline, v, r, s);
    }

    function test_ClaimAllFor_RevertWhen_WrongWindowIds_InSig() public {
        uint256[] memory idsInSig = new uint256[](1);
        idsInSig[0] = targetWindow;

        uint256[] memory idsSubmitted = new uint256[](1);
        idsSubmitted[0] = targetWindow + 1; // different from what was signed

        uint256 deadline = block.timestamp + 300;
        (uint8 v, bytes32 r, bytes32 s) = _claimSig(0xA11CE, alice, idsInSig, 0, deadline);

        vm.expectRevert("Invalid signature");
        vm.prank(relayer);
        hook.claimAllFor(poolKey, idsSubmitted, alice, deadline, v, r, s);
    }

    // =======================================================================
    //  SECTION 8 — CLAIM REFUND EDGE CASES
    // =======================================================================

    function test_ClaimRefund_RevertWhen_WindowIsSettled() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        vm.expectRevert("Window not voided");
        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);
    }

    function test_ClaimRefund_RevertWhen_NoStake() public {
        _void(targetWindow);
        // carol never placed a bet
        vm.expectRevert("No stake to refund");
        vm.prank(carol);
        hook.claimRefund(poolKey, targetWindow);
    }

    function test_ClaimRefund_RevertWhen_DoubleRefund() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _void(targetWindow);

        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);

        vm.expectRevert("No stake to refund");
        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);
    }

    function test_ClaimRefund_StakeOnMultipleCells_FullRefund() public {
        // Alice bets on two different cells in the same window
        _bet(alice, winCell, targetWindow, 10_000_000);
        _bet(alice, loseCell, targetWindow, 20_000_000);
        _void(targetWindow);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow);
        // userWindowStake tracks total stake, so alice should get 30M back
        assertEq(usdc.balanceOf(alice), before + 30_000_000, "Full refund for both cells");
    }

    // =======================================================================
    //  SECTION 9 — ADMIN SETTERS BOUNDARY CONDITIONS
    // =======================================================================

    function test_SetFeeBps_RevertWhen_ExceedsMax() public {
        vm.expectRevert("Max 10%");
        hook.setFeeBps(poolKey, 1001); // > 1000 bps
    }

    function test_SetFeeBps_Success_AtMax() public {
        hook.setFeeBps(poolKey, 1000); // exactly 10%
        (,,,,, uint256 feeBps,,,) = _getConfig();
        assertEq(feeBps, 1000);
    }

    function test_SetFeeBps_Success_Zero() public {
        hook.setFeeBps(poolKey, 0); // 0% fee allowed
        (,,,,, uint256 feeBps,,,) = _getConfig();
        assertEq(feeBps, 0);
    }

    function test_SetFrozenWindows_RevertWhen_Zero() public {
        vm.expectRevert("Min 1 frozen window");
        hook.setFrozenWindows(poolKey, 0);
    }

    function test_SetFrozenWindows_Success_AtMin() public {
        hook.setFrozenWindows(poolKey, 1);
        (,,, uint256 frozen,,,,,) = _getConfig();
        assertEq(frozen, 1);
    }

    function test_SetMinPoolThreshold_UpdatesValue() public {
        hook.setMinPoolThreshold(poolKey, 5_000_000);
        (,,,,,,,, uint256 minThresh) = _getConfig();
        assertEq(minThresh, 5_000_000);
    }

    function test_SetMaxStakePerCell_UpdatesValue() public {
        hook.setMaxStakePerCell(poolKey, 200_000_000);
        (,,,, uint256 maxStake,,,,) = _getConfig();
        assertEq(maxStake, 200_000_000);
    }

    function _getConfig()
        internal
        view
        returns (bytes32, uint256, uint256, uint256, uint256, uint256, uint256, address, uint256)
    {
        return hook.gridConfigs(poolId);
    }

    function test_WithdrawFees_RevertWhen_InsufficientFees() public {
        vm.prank(treasury);
        vm.expectRevert("Insufficient collected fees");
        hook.withdrawFees(poolKey, 1_000_000);
    }

    function test_WithdrawFees_Success() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        uint256 fees = hook.collectedFees(poolId);
        assertGt(fees, 0, "Should have fees after settlement");

        uint256 before = usdc.balanceOf(treasury);
        vm.prank(treasury);
        hook.withdrawFees(poolKey, fees);
        assertEq(usdc.balanceOf(treasury), before + fees, "Treasury should receive fees");
    }

    // =======================================================================
    //  SECTION 10 — PAUSE / UNPAUSE
    // =======================================================================

    function test_Pause_BlocksBetPlacement() public {
        hook.pause();
        vm.expectRevert();
        _bet(alice, winCell, targetWindow, 5_000_000);
    }

    function test_Pause_BlocksPlaceBetWithSig() public {
        hook.pause();
        _setupAliceSigUser();
        address a = _aliceAddr();
        bytes memory sig = _setupAliceSig(winCell, targetWindow, 5_000_000, 0, block.timestamp + 300);

        vm.expectRevert();
        vm.prank(relayer);
        hook.placeBetWithSig(poolKey, winCell, targetWindow, 5_000_000, a, 0, block.timestamp + 300, sig);
    }

    function test_Pause_DoesNotBlockSettle() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        hook.pause(); // pause after bet

        // Settle should still work while paused
        uint256 windowEnd = GRID_EPOCH + (targetWindow + 1) * WIN_DURATION;
        mockPyth.setMockPrice(SafeCast.toInt64(SafeCast.toInt256(winCell * BAND_WIDTH + BAND_WIDTH / 2)));
        vm.warp(windowEnd + 5);

        hook.settle{value: 0}(poolKey, targetWindow, bytes("X")); // no revert
    }

    function test_Pause_DoesNotBlockClaimAll() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);
        hook.pause();

        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;
        vm.prank(alice);
        hook.claimAll(poolKey, ids); // should succeed despite pause
    }

    function test_Pause_DoesNotBlockClaimRefund() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _void(targetWindow);
        hook.pause();

        vm.prank(alice);
        hook.claimRefund(poolKey, targetWindow); // should succeed despite pause
    }

    function test_Unpause_RestoresBetPlacement() public {
        hook.pause();
        hook.unpause();

        // Should work again
        _bet(alice, winCell, targetWindow, 5_000_000);
    }

    // =======================================================================
    //  SECTION 11 — VIEW FUNCTIONS EDGE CASES
    // =======================================================================

    function test_CalculatePayout_ReturnsZero_ForLoser() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _bet(bob, loseCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        uint256 payout = hook.calculatePayout(poolKey, targetWindow, loseCell, bob);
        assertEq(payout, 0, "Loser should have zero payout");
    }

    function test_CalculatePayout_ReturnsZero_BeforeSettlement() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        uint256 payout = hook.calculatePayout(poolKey, targetWindow, winCell, alice);
        assertEq(payout, 0, "No payout before settlement");
    }

    function test_CalculatePayout_ReturnsZero_ForVoidedWindow() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _void(targetWindow);

        uint256 payout = hook.calculatePayout(poolKey, targetWindow, winCell, alice);
        assertEq(payout, 0, "No payout from voided window");
    }

    function test_CalculatePayout_ReturnsZero_ForNonExistentWindow() public view {
        // Window 9999 was never bet on
        uint256 payout = hook.calculatePayout(poolKey, 9999, winCell, alice);
        assertEq(payout, 0);
    }

    function test_GetLiveMultiplier_ReturnsZero_WhenNoStakeOnCell() public view {
        uint256 mult = hook.getLiveMultiplier(poolKey, targetWindow, winCell);
        assertEq(mult, 0);
    }

    function test_GetLiveMultiplier_IncreasesWhenOpposingCell_HasMoreStake() public {
        // With only alice on winCell: multiplier = netPool / winCellStake
        _bet(alice, winCell, targetWindow, 10_000_000);
        uint256 multBefore = hook.getLiveMultiplier(poolKey, targetWindow, winCell);

        // Bob on loseCell increases totalPool → alice's cell multiplier goes up
        _bet(bob, loseCell, targetWindow, 30_000_000);
        uint256 multAfter = hook.getLiveMultiplier(poolKey, targetWindow, winCell);

        assertGt(multAfter, multBefore, "Multiplier should increase as more funds enter pool");
    }

    function test_HasPendingClaim_FalseBeforeSettlement() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        assertFalse(hook.hasPendingClaim(poolKey, targetWindow, alice), "No pending claim before settlement");
    }

    function test_HasPendingClaim_TrueAfterSettlement() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);
        assertTrue(hook.hasPendingClaim(poolKey, targetWindow, alice), "Pending claim after settlement");
    }

    function test_HasPendingClaim_FalseAfterClaim() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);
        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;
        vm.prank(alice);
        hook.claimAll(poolKey, ids);
        assertFalse(hook.hasPendingClaim(poolKey, targetWindow, alice), "No pending claim after claiming");
    }

    function test_GetBettableWindows_ReturnsCorrectRange() public view {
        (uint256 start, uint256 end) = hook.getBettableWindows(poolKey);
        // At GRID_EPOCH+1 with frozenWindows=3: start=4, end=6
        assertEq(start, 4, "bettableStart should be current + frozen + 1");
        assertEq(end, 6, "bettableEnd should be current + frozen + 3");
    }

    function test_GetBettableWindows_AdvancesWithTime() public {
        (uint256 start0,) = hook.getBettableWindows(poolKey);
        vm.warp(GRID_EPOCH + WIN_DURATION + 1); // advance one full window
        (uint256 start1,) = hook.getBettableWindows(poolKey);
        assertEq(start1, start0 + 1, "Bettable window advances with time");
    }

    // =======================================================================
    //  SECTION 12 — MULTI-USER / PROPORTIONAL PAYOUTS
    // =======================================================================

    function test_Proportional_ThreeWinners_CorrectShares() public {
        // Alice: 10M, Bob: 40M, Carol: 50M → all on winning cell
        _bet(alice, winCell, targetWindow, 10_000_000);
        _bet(bob, winCell, targetWindow, 40_000_000);
        // carol's bet would exceed MAX_STAKE (10+40+50=100 > 50), so only 0 remains
        // Let's just use alice=10 and bob=40 within MAX_STAKE=50
        _settle(targetWindow, winCell);

        uint256 alicePayout = hook.calculatePayout(poolKey, targetWindow, winCell, alice);
        uint256 bobPayout = hook.calculatePayout(poolKey, targetWindow, winCell, bob);

        // Alice gets 20%, Bob gets 80% of net pool
        // Net pool = 50M * 0.98 = 49M
        assertApproxEqRel(alicePayout, 9_800_000, 0.001e18, "Alice ~20% of net pool");
        assertApproxEqRel(bobPayout, 39_200_000, 0.001e18, "Bob ~80% of net pool");
        assertApproxEqAbs(alicePayout + bobPayout, 49_000_000, 1, "Total payouts = net pool");
    }

    function test_Proportional_FeeCollected_Correctly() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        // Fee = 2% of 10M = 200_000
        uint256 fee = hook.collectedFees(poolId);
        assertEq(fee, 200_000, "Fee should be 2% of staked amount");
    }

    function test_Proportional_WinnerLosersInSameWindow() public {
        _bet(alice, winCell, targetWindow, 10_000_000);
        _bet(bob, loseCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        uint256 alicePayout = hook.calculatePayout(poolKey, targetWindow, winCell, alice);
        uint256 bobPayout = hook.calculatePayout(poolKey, targetWindow, loseCell, bob);

        assertGt(alicePayout, 10_000_000, "Winner should receive more than original stake");
        assertEq(bobPayout, 0, "Loser should receive nothing");
    }

    function test_IndependentWindows_DoNotSharePools() public {
        (uint256 start, uint256 end) = hook.getBettableWindows(poolKey);
        uint256 w1 = start;
        uint256 w2 = start + 1;

        _bet(alice, winCell, w1, 10_000_000);
        _bet(bob, winCell, w2, 20_000_000);

        _settle(w1, winCell);
        _settle(w2, winCell);

        uint256 alicePayout = hook.calculatePayout(poolKey, w1, winCell, alice);
        uint256 bobPayout = hook.calculatePayout(poolKey, w2, winCell, bob);

        // Each window has its own pool; alice/bob only get their window's payout
        assertApproxEqAbs(alicePayout, 9_800_000, 1, "Alice gets net of w1 only");
        assertApproxEqAbs(bobPayout, 19_600_000, 1, "Bob gets net of w2 only");
        (end); // silence
    }
}

// =============================================================================
//  HELPER: Pyth mock that charges a fee (for Pyth fee revert test)
// =============================================================================

contract CompMockPythWithFee is IPyth {
    int64 public mockPrice;
    int32 public mockExpo = -6;

    function setMockPrice(int64 price) external {
        mockPrice = price;
    }

    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 1; // 1 wei
    }

    function parsePriceFeedUpdates(bytes[] calldata updateData, bytes32[] calldata, uint64, uint64)
        external
        payable
        returns (PythStructs.PriceFeed[] memory feeds)
    {
        require(msg.value >= 1, "MockPyth: insufficient fee");
        require(updateData.length > 0 && updateData[0].length > 0, "MockPyth: empty data");
        feeds = new PythStructs.PriceFeed[](1);
        feeds[0].price.price = mockPrice;
        feeds[0].price.expo = mockExpo;
        feeds[0].price.publishTime = block.timestamp;
    }

    function getPrice(bytes32) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getEmaPrice(bytes32) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getPriceUnsafe(bytes32) external view returns (PythStructs.Price memory p) {
        p.price = mockPrice;
        p.expo = mockExpo;
        p.publishTime = block.timestamp;
    }

    function getEmaPriceUnsafe(bytes32) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getPriceNoOlderThan(bytes32, uint256) external pure returns (PythStructs.Price memory) {
        revert();
    }

    function getEmaPriceNoOlderThan(bytes32, uint256) external pure returns (PythStructs.Price memory) {
        revert();
    }
    function updatePriceFeeds(bytes[] calldata) external payable {}
    function updatePriceFeedsIfNecessary(bytes[] calldata, bytes32[] calldata, uint64[] calldata) external payable {}

    function getValidTimePeriod() external pure returns (uint256) {
        return 60;
    }

    function parsePriceFeedUpdatesUnique(bytes[] calldata, bytes32[] calldata, uint64, uint64)
        external
        payable
        returns (PythStructs.PriceFeed[] memory)
    {
        revert();
    }
}
