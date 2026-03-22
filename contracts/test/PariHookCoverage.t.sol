// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PariHookCoverageTest
 * @notice Tests specifically targeting uncovered lines/branches/functions
 *         identified from lcov coverage report.
 *
 *  Covers:
 *   1. Hook callbacks (afterInitialize, before/afterAddLiquidity, etc.) — all revert
 *   2. permitAndPlaceBet — sufficient-allowance branch AND permit branch
 *   3. currentWindowId — before-epoch branch (returns 0)
 *   4. getPendingClaims — multi-window with unsettled/voided/pushed/zero-stake skips
 *   5. getCellStakes / getUserStakes — array batch queries
 *   6. _calculateCellId / _getCellPriceRange — verified via winningCell after settle
 *   7. _isNoPriceInRangeError — short reason (< 4 bytes) → bubbleRevert path
 *   8. _bubbleRevert — empty reason → "Pyth parse failed"
 *   9. unlockCallback — non-PoolManager caller reverts
 *  10. configureGrid — gridEpoch-in-past revert branch
 */

import {Test} from "forge-std/Test.sol";
import {PariHook} from "../src/PariHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// =============================================================================
//                              MOCK CONTRACTS
// =============================================================================

/// @dev ERC-20 with a minimal permit() that just sets the allowance (no sig check).
contract CovMockERC20 is IERC20, IERC20Permit {
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

    // IERC20Permit — no real sig verification; just sets allowance
    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32) external {
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function nonces(address) external pure returns (uint256) {
        return 0;
    }

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return bytes32(0);
    }
}

/// @dev Normal Pyth mock (price always available).
contract CovMockPyth is IPyth {
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
        virtual
        returns (PythStructs.PriceFeed[] memory feeds)
    {
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

/// @dev Pyth mock that reverts with short data (< 4 bytes) to exercise _isNoPriceInRangeError false branch.
contract CovMockPythShortRevert is CovMockPyth {
    function parsePriceFeedUpdates(bytes[] calldata, bytes32[] calldata, uint64, uint64)
        external
        payable
        override
        returns (PythStructs.PriceFeed[] memory)
    {
        assembly {
            // Revert with 3 bytes — too short for a valid 4-byte selector
            mstore(0x00, 0xaabbcc0000000000000000000000000000000000000000000000000000000000)
            revert(0x00, 3)
        }
    }
}

/// @dev Pyth mock that reverts with empty data to trigger _bubbleRevert("Pyth parse failed").
contract CovMockPythEmptyRevert is CovMockPyth {
    function parsePriceFeedUpdates(bytes[] calldata, bytes32[] calldata, uint64, uint64)
        external
        payable
        override
        returns (PythStructs.PriceFeed[] memory)
    {
        assembly {
            revert(0x00, 0)
        }
    }
}

/// @dev Pyth mock that reverts with the exact PriceFeedNotFoundWithinRange() selector → auto-void.
contract CovMockPythNoPriceInRange is CovMockPyth {
    bytes4 constant ERR_SELECTOR = bytes4(keccak256("PriceFeedNotFoundWithinRange()"));

    function parsePriceFeedUpdates(bytes[] calldata, bytes32[] calldata, uint64, uint64)
        external
        payable
        override
        returns (PythStructs.PriceFeed[] memory)
    {
        bytes4 sel = ERR_SELECTOR;
        assembly {
            mstore(0x00, sel)
            revert(0x00, 4)
        }
    }
}

/// @dev PoolManager mock.
contract CovMockPoolManager {
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

contract PariHookCoverageTest is Test {
    using PoolIdLibrary for PoolKey;

    PariHook public hook;
    CovMockPyth public mockPyth;
    CovMockPoolManager public mockPoolManager;
    CovMockERC20 public usdc;

    address public admin = address(this);
    address public treasury = makeAddr("treasury");
    address public relayer = makeAddr("relayer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    PoolKey public poolKey;
    PoolId public poolId;

    bytes32 constant PYTH_FEED = bytes32(uint256(0xABCD));
    uint256 constant BAND_WIDTH = 2_000_000; // $2.00
    uint256 constant WIN_DURATION = 60;
    uint256 constant FROZEN = 3;
    uint256 constant MAX_STAKE = 100_000_000_000;
    uint256 constant FEE_BPS = 200;
    uint256 constant MIN_THRESH = 1_000_000;
    uint256 constant GRID_EPOCH = 120;
    uint256 constant INITIAL_BAL = 1_000_000_000;

    // A window far enough in the future to be bettable
    uint256 public targetWindow;

    function setUp() public {
        usdc = new CovMockERC20("USD Coin", "USDC", 6);
        mockPyth = new CovMockPyth();
        mockPoolManager = new CovMockPoolManager();

        hook = new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(mockPyth)), admin, treasury, relayer);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

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

        // Warp to 1 second past epoch so the grid is live
        vm.warp(GRID_EPOCH + 1);

        // targetWindow = current + FROZEN + 1 (first bettable window)
        (targetWindow,) = hook.getBettableWindows(poolKey);

        usdc.mint(alice, INITIAL_BAL);
        usdc.mint(bob, INITIAL_BAL);
        usdc.mint(address(hook), INITIAL_BAL); // so hook can pay out

        vm.prank(alice);
        usdc.approve(address(hook), type(uint256).max);

        vm.prank(bob);
        usdc.approve(address(hook), type(uint256).max);
    }

    // =========================================================================
    //  HELPERS
    // =========================================================================

    function _bet(address user, uint256 cellId, uint256 windowId, uint256 amount) internal {
        vm.prank(user);
        hook.placeBet(poolKey, cellId, windowId, amount);
    }

    function _settle(uint256 windowId, uint256 winCell) internal {
        uint256 windowEnd = GRID_EPOCH + (windowId + 1) * WIN_DURATION;
        mockPyth.setMockPrice(SafeCast.toInt64(SafeCast.toInt256(winCell * BAND_WIDTH + BAND_WIDTH / 2)));
        vm.warp(windowEnd + 5);
        hook.settle{value: 0}(poolKey, windowId, bytes("X"));
    }

    function _void(uint256 windowId) internal {
        uint256 windowEnd = GRID_EPOCH + (windowId + 1) * WIN_DURATION;
        vm.warp(windowEnd + 5);
        vm.prank(admin);
        hook.voidWindow(poolKey, windowId);
    }

    // =========================================================================
    //  SECTION 1 — HOOK CALLBACKS (all must revert "Hook not implemented")
    // =========================================================================

    function test_AfterInitialize_Reverts() public {
        vm.expectRevert("Hook not implemented");
        hook.afterInitialize(address(0), poolKey, 0, 0);
    }

    function test_BeforeAddLiquidity_Reverts() public {
        ModifyLiquidityParams memory params;
        vm.expectRevert("Hook not implemented");
        hook.beforeAddLiquidity(address(0), poolKey, params, "");
    }

    function test_AfterAddLiquidity_Reverts() public {
        ModifyLiquidityParams memory params;
        BalanceDelta delta;
        vm.expectRevert("Hook not implemented");
        hook.afterAddLiquidity(address(0), poolKey, params, delta, delta, "");
    }

    function test_BeforeRemoveLiquidity_Reverts() public {
        ModifyLiquidityParams memory params;
        vm.expectRevert("Hook not implemented");
        hook.beforeRemoveLiquidity(address(0), poolKey, params, "");
    }

    function test_AfterRemoveLiquidity_Reverts() public {
        ModifyLiquidityParams memory params;
        BalanceDelta delta;
        vm.expectRevert("Hook not implemented");
        hook.afterRemoveLiquidity(address(0), poolKey, params, delta, delta, "");
    }

    function test_BeforeSwap_Reverts() public {
        SwapParams memory params;
        vm.expectRevert("Hook not implemented");
        hook.beforeSwap(address(0), poolKey, params, "");
    }

    function test_AfterSwap_Reverts() public {
        SwapParams memory params;
        BalanceDelta delta;
        vm.expectRevert("Hook not implemented");
        hook.afterSwap(address(0), poolKey, params, delta, "");
    }

    function test_BeforeDonate_Reverts() public {
        vm.expectRevert("Hook not implemented");
        hook.beforeDonate(address(0), poolKey, 0, 0, "");
    }

    function test_AfterDonate_Reverts() public {
        vm.expectRevert("Hook not implemented");
        hook.afterDonate(address(0), poolKey, 0, 0, "");
    }

    // =========================================================================
    //  SECTION 2 — permitAndPlaceBet
    // =========================================================================

    /// Allowance already sufficient — permit() must NOT be called, bet must succeed.
    function test_PermitAndPlaceBet_SufficientAllowance_SkipsPermit() public {
        // alice already has unlimited approval from setUp
        uint256 cellId = 1500;
        uint256 amount = 10_000_000;

        uint256 balBefore = usdc.balanceOf(address(hook));

        vm.prank(alice);
        hook.permitAndPlaceBet(
            poolKey,
            cellId,
            targetWindow,
            amount,
            type(uint256).max, // permitAmount (should be unused)
            block.timestamp + 60, // deadline
            0, // v
            bytes32(0), // r
            bytes32(0) // s
        );

        assertEq(usdc.balanceOf(address(hook)) - balBefore, amount, "Hook should have received USDC");
        assertEq(hook.getUserStake(poolKey, targetWindow, cellId, alice), amount);
    }

    /// Allowance zero — permit() IS called, then bet succeeds.
    function test_PermitAndPlaceBet_InsufficientAllowance_CallsPermit() public {
        // Revoke alice's approval so allowance is 0
        vm.prank(alice);
        usdc.approve(address(hook), 0);

        uint256 cellId = 1501;
        uint256 amount = 5_000_000;
        uint256 permitAmount = type(uint256).max;

        uint256 balBefore = usdc.balanceOf(address(hook));

        // permit() in CovMockERC20 just sets allowance — v/r/s are ignored
        vm.prank(alice);
        hook.permitAndPlaceBet(
            poolKey, cellId, targetWindow, amount, permitAmount, block.timestamp + 60, 27, bytes32(0), bytes32(0)
        );

        assertEq(usdc.balanceOf(address(hook)) - balBefore, amount, "Hook should have received USDC via permit flow");
        assertEq(hook.getUserStake(poolKey, targetWindow, cellId, alice), amount);
    }

    // =========================================================================
    //  SECTION 3 — currentWindowId
    // =========================================================================

    /// Before gridEpoch → must return 0.
    function test_CurrentWindowId_BeforeEpoch_ReturnsZero() public {
        // Deploy a fresh hook with a far-future epoch so block.timestamp < gridEpoch
        CovMockERC20 usdc2 = new CovMockERC20("USDC2", "USDC2", 6);
        PariHook hook2 =
            new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(mockPyth)), admin, treasury, relayer);

        PoolKey memory key2 = PoolKey({
            currency0: Currency.wrap(address(usdc2)),
            currency1: Currency.wrap(address(0)),
            fee: 1,
            tickSpacing: 60,
            hooks: IHooks(address(hook2))
        });

        uint256 futureEpoch = block.timestamp + 3600; // 1 hour from now, ensure minute-aligned
        futureEpoch = (futureEpoch / 60) * 60;

        hook2.configureGrid(
            key2,
            PYTH_FEED,
            BAND_WIDTH,
            WIN_DURATION,
            FROZEN,
            MAX_STAKE,
            FEE_BPS,
            MIN_THRESH,
            futureEpoch,
            address(usdc2)
        );

        // block.timestamp < futureEpoch → should return 0
        assertEq(hook2.currentWindowId(key2), 0, "currentWindowId before epoch must be 0");
    }

    /// After gridEpoch → returns correct computed window ID.
    function test_CurrentWindowId_AfterEpoch_ReturnsCorrectId() public {
        // Warp 5 complete windows past epoch
        vm.warp(GRID_EPOCH + 5 * WIN_DURATION + 10);
        assertEq(hook.currentWindowId(poolKey), 5, "currentWindowId should be 5");
    }

    // =========================================================================
    //  SECTION 4 — getPendingClaims
    // =========================================================================

    function test_GetPendingClaims_SkipsUnsettledWindows() public {
        // targetWindow not settled at all
        _bet(alice, 1500, targetWindow, 10_000_000);

        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;

        uint256 pending = hook.getPendingClaims(poolKey, ids, alice);
        assertEq(pending, 0, "Unsettled window should contribute 0");
    }

    function test_GetPendingClaims_SkipsVoidedWindows() public {
        _bet(alice, 1500, targetWindow, 10_000_000);
        _void(targetWindow);

        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;

        uint256 pending = hook.getPendingClaims(poolKey, ids, alice);
        assertEq(pending, 0, "Voided window should contribute 0");
    }

    function test_GetPendingClaims_SkipsAlreadyPushed() public {
        uint256 winCell = 1500;
        _bet(alice, winCell, targetWindow, 10_000_000);
        _settle(targetWindow, winCell);

        // Push payout to alice so payoutPushed[...][alice] = true
        address[] memory winners = new address[](1);
        winners[0] = alice;
        vm.prank(treasury);
        hook.pushPayouts(poolKey, targetWindow, winners);

        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;

        uint256 pending = hook.getPendingClaims(poolKey, ids, alice);
        assertEq(pending, 0, "Already-pushed winner should contribute 0");
    }

    function test_GetPendingClaims_SkipsZeroStake() public {
        uint256 winCell = 1500;
        // bob wins, alice has no stake on winCell
        _bet(bob, winCell, targetWindow, 10_000_000);
        _bet(alice, 1501, targetWindow, 10_000_000); // alice on losing cell
        _settle(targetWindow, winCell);

        uint256[] memory ids = new uint256[](1);
        ids[0] = targetWindow;

        uint256 pending = hook.getPendingClaims(poolKey, ids, alice);
        assertEq(pending, 0, "Zero stake on winning cell should contribute 0");
    }

    function test_GetPendingClaims_SumsMultipleWindows() public {
        // Place bets on two separate windows
        (uint256 w1,) = hook.getBettableWindows(poolKey);
        uint256 w2 = w1 + 1; // second bettable window

        uint256 winCell = 1500;
        _bet(alice, winCell, w1, 10_000_000);
        _bet(alice, winCell, w2, 20_000_000);

        _settle(w1, winCell);
        _settle(w2, winCell);

        uint256[] memory ids = new uint256[](2);
        ids[0] = w1;
        ids[1] = w2;

        uint256 pending = hook.getPendingClaims(poolKey, ids, alice);
        // Both windows are settled, alice is the only winner → gets full net pool
        assertGt(pending, 0, "Should have positive pending claims across two windows");
        // totalPool w1=10M, w2=20M → net = pool - 2% fee → alice gets all of each net
        uint256 expectedW1 = (10_000_000 * (10000 - FEE_BPS)) / 10000;
        uint256 expectedW2 = (20_000_000 * (10000 - FEE_BPS)) / 10000;
        assertEq(pending, expectedW1 + expectedW2, "Pending should equal sum of net pools");
    }

    // =========================================================================
    //  SECTION 5 — getCellStakes (batch)
    // =========================================================================

    function test_GetCellStakes_EmptyArray() public view {
        uint256[] memory cellIds = new uint256[](0);
        uint256[] memory stakes = hook.getCellStakes(poolKey, targetWindow, cellIds);
        assertEq(stakes.length, 0);
    }

    function test_GetCellStakes_MultipleIds() public {
        uint256 cellA = 1500;
        uint256 cellB = 1501;
        uint256 cellC = 1502;

        _bet(alice, cellA, targetWindow, 10_000_000);
        _bet(bob, cellB, targetWindow, 20_000_000);
        // cellC has no stake

        uint256[] memory cellIds = new uint256[](3);
        cellIds[0] = cellA;
        cellIds[1] = cellB;
        cellIds[2] = cellC;

        uint256[] memory stakes = hook.getCellStakes(poolKey, targetWindow, cellIds);

        assertEq(stakes.length, 3);
        assertEq(stakes[0], 10_000_000, "cellA stake");
        assertEq(stakes[1], 20_000_000, "cellB stake");
        assertEq(stakes[2], 0, "cellC has no stake");
    }

    // =========================================================================
    //  SECTION 6 — getUserStakes (batch)
    // =========================================================================

    function test_GetUserStakes_EmptyArray() public view {
        uint256[] memory cellIds = new uint256[](0);
        uint256[] memory stakes = hook.getUserStakes(poolKey, targetWindow, alice, cellIds);
        assertEq(stakes.length, 0);
    }

    function test_GetUserStakes_MultipleIds() public {
        uint256 cellA = 1500;
        uint256 cellB = 1501;
        uint256 cellC = 1502;

        _bet(alice, cellA, targetWindow, 5_000_000);
        _bet(alice, cellB, targetWindow, 15_000_000);
        // alice has no stake on cellC

        uint256[] memory cellIds = new uint256[](3);
        cellIds[0] = cellA;
        cellIds[1] = cellB;
        cellIds[2] = cellC;

        uint256[] memory stakes = hook.getUserStakes(poolKey, targetWindow, alice, cellIds);

        assertEq(stakes.length, 3);
        assertEq(stakes[0], 5_000_000, "alice's stake on cellA");
        assertEq(stakes[1], 15_000_000, "alice's stake on cellB");
        assertEq(stakes[2], 0, "alice has no stake on cellC");
    }

    // =========================================================================
    //  SECTION 7 — _calculateCellId / _getCellPriceRange (via settle winningCell)
    // =========================================================================

    /// After settlement, winningCell = floor(closingPrice / bandWidth).
    /// Tests _calculateCellId indirectly.
    function test_WinningCell_MatchesCellIdFormula() public {
        // Price = $3001.50 → in 6-dec USDC = 3_001_500_000
        // cellId = floor(3_001_500_000 / 2_000_000) = 1500
        uint256 expectedCell = 1500;
        int64 priceRaw = 3_001_500_000; // $3001.50 with expo=-6

        _bet(alice, expectedCell, targetWindow, 10_000_000);

        uint256 windowEnd = GRID_EPOCH + (targetWindow + 1) * WIN_DURATION;
        mockPyth.setMockPrice(priceRaw);
        vm.warp(windowEnd + 5);
        hook.settle{value: 0}(poolKey, targetWindow, bytes("X"));

        (, bool settled,,, uint256 winningCell,) = hook.getWindow(poolKey, targetWindow);
        assertTrue(settled);
        assertEq(winningCell, expectedCell, "winningCell must equal floor(price/bandWidth)");
    }

    /// Verify the price band boundaries indirectly:
    /// price at exact cell boundary belongs to the next cell (_getCellPriceRange high is exclusive).
    function test_CellPriceRange_UpperBoundIsNextCell() public {
        // Cell 1500 covers [3_000_000_000, 3_002_000_000)
        // Price = 3_002_000_000 exactly → belongs to cell 1501
        uint256 expectedCell = 1501;
        int64 priceRaw = 3_002_000_000;

        _bet(alice, expectedCell, targetWindow, 10_000_000);

        uint256 windowEnd = GRID_EPOCH + (targetWindow + 1) * WIN_DURATION;
        mockPyth.setMockPrice(priceRaw);
        vm.warp(windowEnd + 5);
        hook.settle{value: 0}(poolKey, targetWindow, bytes("X"));

        (,,,, uint256 winningCell,) = hook.getWindow(poolKey, targetWindow);
        assertEq(winningCell, expectedCell, "Upper boundary price should fall in next cell");
    }

    // =========================================================================
    //  SECTION 8 — _isNoPriceInRangeError (short reason → false → bubbleRevert)
    // =========================================================================

    /// Pyth reverts with 3 bytes of data (too short for a valid 4-byte selector).
    /// _isNoPriceInRangeError returns false → _bubbleRevert propagates the reason.
    function test_Settle_BubblesShortPythRevert() public {
        CovMockPythShortRevert shortPyth = new CovMockPythShortRevert();
        PariHook hook2 =
            new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(shortPyth)), admin, treasury, relayer);

        CovMockERC20 usdc2 = new CovMockERC20("USDC2", "USDC2", 6);
        PoolKey memory key2 = PoolKey({
            currency0: Currency.wrap(address(usdc2)),
            currency1: Currency.wrap(address(0)),
            fee: 2,
            tickSpacing: 60,
            hooks: IHooks(address(hook2))
        });

        // Use a fresh epoch that is strictly in the future relative to current warp
        uint256 epoch2 = ((block.timestamp + 120) / 60) * 60;
        hook2.configureGrid(
            key2, PYTH_FEED, BAND_WIDTH, WIN_DURATION, FROZEN, MAX_STAKE, FEE_BPS, MIN_THRESH, epoch2, address(usdc2)
        );

        vm.warp(epoch2 + 1);

        usdc2.mint(alice, INITIAL_BAL);
        vm.prank(alice);
        usdc2.approve(address(hook2), type(uint256).max);

        (uint256 tw,) = hook2.getBettableWindows(key2);
        vm.prank(alice);
        hook2.placeBet(key2, 1500, tw, MIN_THRESH + 1);

        uint256 windowEnd = epoch2 + (tw + 1) * WIN_DURATION;
        vm.warp(windowEnd + 5);

        // Should revert because _bubbleRevert re-throws the 3-byte reason
        vm.expectRevert();
        hook2.settle{value: 0}(key2, tw, bytes("X"));
    }

    // =========================================================================
    //  SECTION 9 — _bubbleRevert with empty reason → "Pyth parse failed"
    // =========================================================================

    function test_Settle_EmptyPythRevert_SaysParserFailed() public {
        CovMockPythEmptyRevert emptyPyth = new CovMockPythEmptyRevert();
        PariHook hook2 =
            new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(emptyPyth)), admin, treasury, relayer);

        CovMockERC20 usdc2 = new CovMockERC20("USDC2", "USDC2", 6);
        PoolKey memory key2 = PoolKey({
            currency0: Currency.wrap(address(usdc2)),
            currency1: Currency.wrap(address(0)),
            fee: 3,
            tickSpacing: 60,
            hooks: IHooks(address(hook2))
        });

        uint256 epoch2 = ((block.timestamp + 120) / 60) * 60;
        hook2.configureGrid(
            key2, PYTH_FEED, BAND_WIDTH, WIN_DURATION, FROZEN, MAX_STAKE, FEE_BPS, MIN_THRESH, epoch2, address(usdc2)
        );

        vm.warp(epoch2 + 1);

        usdc2.mint(alice, INITIAL_BAL);
        vm.prank(alice);
        usdc2.approve(address(hook2), type(uint256).max);

        (uint256 tw,) = hook2.getBettableWindows(key2);
        vm.prank(alice);
        hook2.placeBet(key2, 1500, tw, MIN_THRESH + 1);

        uint256 windowEnd = epoch2 + (tw + 1) * WIN_DURATION;
        vm.warp(windowEnd + 5);

        vm.expectRevert("Pyth parse failed");
        hook2.settle{value: 0}(key2, tw, bytes("X"));
    }

    // =========================================================================
    //  SECTION 10 — unlockCallback from non-PoolManager
    // =========================================================================

    function test_UnlockCallback_RevertWhen_CallerNotPoolManager() public {
        vm.prank(alice);
        vm.expectRevert("Only PoolManager");
        hook.unlockCallback(abi.encode(uint8(0), address(usdc), alice, uint256(0)));
    }

    // =========================================================================
    //  SECTION 11 — configureGrid epoch-in-past branch
    // =========================================================================

    function test_ConfigureGrid_RevertWhen_EpochInPast() public {
        CovMockERC20 usdc2 = new CovMockERC20("USDC3", "USDC3", 6);
        PariHook hook2 =
            new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(mockPyth)), admin, treasury, relayer);

        PoolKey memory key2 = PoolKey({
            currency0: Currency.wrap(address(usdc2)),
            currency1: Currency.wrap(address(0)),
            fee: 4,
            tickSpacing: 60,
            hooks: IHooks(address(hook2))
        });

        // block.timestamp is GRID_EPOCH+1 (set in setUp), so GRID_EPOCH is in the past
        vm.expectRevert("gridEpoch must be in the future");
        hook2.configureGrid(
            key2,
            PYTH_FEED,
            BAND_WIDTH,
            WIN_DURATION,
            FROZEN,
            MAX_STAKE,
            FEE_BPS,
            MIN_THRESH,
            GRID_EPOCH,
            address(usdc2)
        );
    }

    // =========================================================================
    //  SECTION 12 — auto-void via PriceFeedNotFoundWithinRange (existing path,
    //               but verifies _isNoPriceInRangeError true branch via selector)
    // =========================================================================

    function test_Settle_AutoVoids_OnNoPriceInRange() public {
        CovMockPythNoPriceInRange noPricePyth = new CovMockPythNoPriceInRange();
        PariHook hook2 =
            new PariHook(IPoolManager(address(mockPoolManager)), IPyth(address(noPricePyth)), admin, treasury, relayer);

        CovMockERC20 usdc2 = new CovMockERC20("USDC4", "USDC4", 6);
        PoolKey memory key2 = PoolKey({
            currency0: Currency.wrap(address(usdc2)),
            currency1: Currency.wrap(address(0)),
            fee: 5,
            tickSpacing: 60,
            hooks: IHooks(address(hook2))
        });

        uint256 epoch2 = ((block.timestamp + 120) / 60) * 60;
        hook2.configureGrid(
            key2, PYTH_FEED, BAND_WIDTH, WIN_DURATION, FROZEN, MAX_STAKE, FEE_BPS, MIN_THRESH, epoch2, address(usdc2)
        );

        vm.warp(epoch2 + 1);

        usdc2.mint(alice, INITIAL_BAL);
        vm.prank(alice);
        usdc2.approve(address(hook2), type(uint256).max);

        (uint256 tw,) = hook2.getBettableWindows(key2);
        vm.prank(alice);
        hook2.placeBet(key2, 1500, tw, MIN_THRESH + 1);

        uint256 windowEnd = epoch2 + (tw + 1) * WIN_DURATION;
        vm.warp(windowEnd + 5);

        // Should auto-void (no revert)
        hook2.settle{value: 0}(key2, tw, bytes("X"));

        (,, bool voided,,,) = hook2.getWindow(key2, tw);
        assertTrue(voided, "Window should be auto-voided on PriceFeedNotFoundWithinRange");
    }
}
