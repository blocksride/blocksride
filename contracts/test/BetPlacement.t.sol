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

/**
 * @title BetPlacementTest
 * @notice Comprehensive test suite for bet placement functionality
 */
contract BetPlacementTest is Test {
    using PoolIdLibrary for PoolKey;

    PariHook public hook;
    MockPoolManager public poolManager;
    MockERC20 public usdc;

    address public admin = address(this); // test contract is admin so pause/unpause work without vm.prank
    address public treasury = makeAddr("treasury");
    address public relayer = makeAddr("relayer");
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public user3 = address(0x3);

    PoolKey public testKey;
    PoolId public testPoolId;

    // Grid configuration constants
    bytes32 constant PYTH_PRICE_FEED_ID = bytes32(uint256(0x1234));
    uint256 constant BAND_WIDTH = 2_000_000; // $2.00
    uint256 constant WINDOW_DURATION = 60; // 60 seconds
    uint256 constant FROZEN_WINDOWS = 3;
    uint256 constant MAX_STAKE_PER_CELL = 100_000_000_000; // $100,000
    uint256 constant FEE_BPS = 200; // 2%
    uint256 constant MIN_POOL_THRESHOLD = 1_000_000; // $1.00
    // Forge default timestamp is 1; GRID_EPOCH=100 is in the future at setUp, then we warp past it
    uint256 constant GRID_EPOCH = 100;

    // Test amounts
    uint256 constant INITIAL_USER_BALANCE = 1000_000_000; // $1000 USDC
    uint256 constant SMALL_BET = 10_000_000; // $10
    uint256 constant MEDIUM_BET = 100_000_000; // $100
    uint256 constant LARGE_BET = 1_000_000_000; // $1000

    event BetPlaced(
        PoolId indexed poolId, uint256 indexed windowId, uint256 indexed cellId, address user, uint256 amount
    );

    function setUp() public {
        // Deploy mock contracts
        poolManager = new MockPoolManager();
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Deploy PariHook — address(this) is admin so pause/unpause work without vm.prank
        // Mock Pyth oracle address (not used in bet placement tests)
        IPyth mockPyth = IPyth(address(1));
        hook = new PariHook(IPoolManager(address(poolManager)), mockPyth, address(this), treasury, relayer);

        // Setup test pool key
        testKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        testPoolId = testKey.toId();

        // Configure grid (GRID_EPOCH=100 is in the future at forge default timestamp=1)
        hook.configureGrid(
            testKey,
            PYTH_PRICE_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            GRID_EPOCH,
            address(usdc)
        );

        // Warp to 1 second past epoch so the grid is live and bettable windows exist
        vm.warp(GRID_EPOCH + 1);

        // Fund test users with USDC
        usdc.mint(user1, INITIAL_USER_BALANCE);
        usdc.mint(user2, INITIAL_USER_BALANCE);
        usdc.mint(user3, INITIAL_USER_BALANCE);

        // Users approve hook to spend their USDC
        vm.prank(user1);
        usdc.approve(address(hook), type(uint256).max);

        vm.prank(user2);
        usdc.approve(address(hook), type(uint256).max);

        vm.prank(user3);
        usdc.approve(address(hook), type(uint256).max);
    }

    // ============================================
    // SUCCESSFUL BET PLACEMENT TESTS
    // ============================================

    function test_PlaceBet_Success() public {
        uint256 cellId = 1500; // Example cell ID
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);
        uint256 windowId = bettableStart; // First bettable window

        uint256 hookBalanceBefore = usdc.balanceOf(address(hook));
        uint256 userBalanceBefore = usdc.balanceOf(user1);

        vm.expectEmit(true, true, true, true);
        emit BetPlaced(testPoolId, windowId, cellId, user1, SMALL_BET);

        vm.prank(user1);
        hook.placeBet(testKey, cellId, windowId, SMALL_BET);

        // Verify USDC was transferred
        assertEq(usdc.balanceOf(address(hook)), hookBalanceBefore + SMALL_BET);
        assertEq(usdc.balanceOf(user1), userBalanceBefore - SMALL_BET);

        // Verify window state was updated
        assertEq(hook.getCellStake(testKey, windowId, cellId), SMALL_BET);
        assertEq(hook.getUserStake(testKey, windowId, cellId, user1), SMALL_BET);
    }

    function test_PlaceBet_MultipleBetsOnSameCell() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);
        uint256 windowId = bettableStart;

        // User1 places first bet
        vm.prank(user1);
        hook.placeBet(testKey, cellId, windowId, SMALL_BET);

        // User1 places second bet on same cell
        vm.prank(user1);
        hook.placeBet(testKey, cellId, windowId, MEDIUM_BET);

        // Verify stakes accumulated
        assertEq(hook.getCellStake(testKey, windowId, cellId), SMALL_BET + MEDIUM_BET);
        assertEq(hook.getUserStake(testKey, windowId, cellId, user1), SMALL_BET + MEDIUM_BET);
    }

    function test_PlaceBet_MultipleUsersOnSameCell() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);
        uint256 windowId = bettableStart;

        // User1 places bet
        vm.prank(user1);
        hook.placeBet(testKey, cellId, windowId, SMALL_BET);

        // User2 places bet on same cell
        vm.prank(user2);
        hook.placeBet(testKey, cellId, windowId, MEDIUM_BET);

        // Verify cell stake is sum of both bets
        assertEq(hook.getCellStake(testKey, windowId, cellId), SMALL_BET + MEDIUM_BET);

        // Verify individual user stakes
        assertEq(hook.getUserStake(testKey, windowId, cellId, user1), SMALL_BET);
        assertEq(hook.getUserStake(testKey, windowId, cellId, user2), MEDIUM_BET);
    }

    function test_PlaceBet_DifferentCellsSameWindow() public {
        uint256 cellId1 = 1500;
        uint256 cellId2 = 1501;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);
        uint256 windowId = bettableStart;

        // User1 bets on cell1
        vm.prank(user1);
        hook.placeBet(testKey, cellId1, windowId, SMALL_BET);

        // User2 bets on cell2
        vm.prank(user2);
        hook.placeBet(testKey, cellId2, windowId, MEDIUM_BET);

        // Verify stakes are separate
        assertEq(hook.getCellStake(testKey, windowId, cellId1), SMALL_BET);
        assertEq(hook.getCellStake(testKey, windowId, cellId2), MEDIUM_BET);
        assertEq(hook.getUserStake(testKey, windowId, cellId1, user1), SMALL_BET);
        assertEq(hook.getUserStake(testKey, windowId, cellId2, user2), MEDIUM_BET);
    }

    function test_PlaceBet_AllThreeBettableWindows() public {
        uint256 cellId = 1500;
        (uint256 bettableStart, uint256 bettableEnd) = hook.getBettableWindows(testKey);

        // Bet on first bettable window
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, SMALL_BET);

        // Bet on middle bettable window
        vm.prank(user2);
        hook.placeBet(testKey, cellId, bettableStart + 1, MEDIUM_BET);

        // Bet on last bettable window
        vm.prank(user3);
        hook.placeBet(testKey, cellId, bettableEnd, LARGE_BET);

        // Verify all bets succeeded
        assertEq(hook.getCellStake(testKey, bettableStart, cellId), SMALL_BET);
        assertEq(hook.getCellStake(testKey, bettableStart + 1, cellId), MEDIUM_BET);
        assertEq(hook.getCellStake(testKey, bettableEnd, cellId), LARGE_BET);
    }

    // ============================================
    // VALIDATION REVERT TESTS
    // ============================================

    function test_PlaceBet_RevertWhen_GridNotConfigured() public {
        // Create a new pool key that hasn't been configured
        PoolKey memory unconfiguredKey = PoolKey({
            currency0: Currency.wrap(address(0x9999)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        vm.expectRevert("Grid not configured");
        vm.prank(user1);
        hook.placeBet(unconfiguredKey, 1500, bettableStart, SMALL_BET);
    }

    function test_PlaceBet_RevertWhen_WindowTooEarly() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);
        uint256 tooEarlyWindow = bettableStart - 1; // One window before bettable start

        vm.expectRevert("Window not in betting zone");
        vm.prank(user1);
        hook.placeBet(testKey, cellId, tooEarlyWindow, SMALL_BET);
    }

    function test_PlaceBet_RevertWhen_WindowTooLate() public {
        uint256 cellId = 1500;
        (, uint256 bettableEnd) = hook.getBettableWindows(testKey);
        uint256 tooLateWindow = bettableEnd + 1; // One window after bettable end

        vm.expectRevert("Window not in betting zone");
        vm.prank(user1);
        hook.placeBet(testKey, cellId, tooLateWindow, SMALL_BET);
    }

    function test_PlaceBet_RevertWhen_WindowInFrozenZone() public {
        uint256 cellId = 1500;
        uint256 currentWindow = hook.getCurrentWindow(testKey);
        uint256 frozenWindow = currentWindow + 1; // Inside frozen zone

        vm.expectRevert("Window not in betting zone");
        vm.prank(user1);
        hook.placeBet(testKey, cellId, frozenWindow, SMALL_BET);
    }

    function test_PlaceBet_RevertWhen_WindowIsCurrentWindow() public {
        uint256 cellId = 1500;
        uint256 currentWindow = hook.getCurrentWindow(testKey);

        vm.expectRevert("Window not in betting zone");
        vm.prank(user1);
        hook.placeBet(testKey, cellId, currentWindow, SMALL_BET);
    }

    function test_PlaceBet_RevertWhen_ZeroAmount() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        vm.expectRevert("Amount must be > 0");
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, 0);
    }

    function test_PlaceBet_RevertWhen_ExceedsMaxStakePerCell() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Try to bet more than max stake per cell
        uint256 excessiveAmount = MAX_STAKE_PER_CELL + 1;

        // Mint extra USDC for this test
        usdc.mint(user1, excessiveAmount);

        vm.expectRevert("Exceeds max stake per cell");
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, excessiveAmount);
    }

    function test_PlaceBet_RevertWhen_AccumulatedStakeExceedsMax() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Mint lots of USDC for both users
        usdc.mint(user1, MAX_STAKE_PER_CELL);
        usdc.mint(user2, MAX_STAKE_PER_CELL);

        // User1 bets 99% of max
        uint256 firstBet = (MAX_STAKE_PER_CELL * 99) / 100;
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, firstBet);

        // User2 tries to bet more, exceeding the max
        uint256 secondBet = (MAX_STAKE_PER_CELL * 2) / 100;

        vm.expectRevert("Exceeds max stake per cell");
        vm.prank(user2);
        hook.placeBet(testKey, cellId, bettableStart, secondBet);
    }

    function test_PlaceBet_RevertWhen_InsufficientBalance() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        address poorUser = address(0x9999);
        // Don't mint any USDC for poorUser

        vm.prank(poorUser);
        usdc.approve(address(hook), type(uint256).max);

        vm.expectRevert("Insufficient balance");
        vm.prank(poorUser);
        hook.placeBet(testKey, cellId, bettableStart, SMALL_BET);
    }

    function test_PlaceBet_RevertWhen_InsufficientAllowance() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        address userNoApproval = address(0x8888);
        usdc.mint(userNoApproval, INITIAL_USER_BALANCE);
        // Don't approve hook to spend USDC

        vm.expectRevert("Insufficient allowance");
        vm.prank(userNoApproval);
        hook.placeBet(testKey, cellId, bettableStart, SMALL_BET);
    }

    function test_PlaceBet_RevertWhen_Paused() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Admin pauses the contract
        hook.pause();

        vm.expectRevert(); // Pausable: paused
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, SMALL_BET);

        // Unpause and verify it works again
        hook.unpause();

        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, SMALL_BET);

        assertEq(hook.getCellStake(testKey, bettableStart, cellId), SMALL_BET);
    }

    // ============================================
    // VIEW FUNCTION TESTS
    // ============================================

    function test_GetCurrentWindow() public {
        uint256 currentWindow = hook.getCurrentWindow(testKey);

        // window 0 since we're 1 second past epoch (< 1 full windowDuration)
        assertGe(currentWindow, 0);

        // Fast forward time and verify window increments
        vm.warp(block.timestamp + WINDOW_DURATION);
        uint256 nextWindow = hook.getCurrentWindow(testKey);
        assertEq(nextWindow, currentWindow + 1);
    }

    function test_GetBettableWindows() public {
        (uint256 start, uint256 end) = hook.getBettableWindows(testKey);

        uint256 currentWindow = hook.getCurrentWindow(testKey);

        // Verify bettable range is [current + frozenWindows + 1, current + frozenWindows + 3]
        assertEq(start, currentWindow + FROZEN_WINDOWS + 1);
        assertEq(end, currentWindow + FROZEN_WINDOWS + 3);
        assertEq(end - start, 2); // Exactly 3 windows (0-indexed range)
    }

    function test_GetBettableWindows_UpdatesOverTime() public {
        (uint256 startBefore, uint256 endBefore) = hook.getBettableWindows(testKey);

        // Fast forward one window
        vm.warp(block.timestamp + WINDOW_DURATION);

        (uint256 startAfter, uint256 endAfter) = hook.getBettableWindows(testKey);

        // Bettable range should have shifted by 1
        assertEq(startAfter, startBefore + 1);
        assertEq(endAfter, endBefore + 1);
    }

    function test_GetUserStake_BeforeBet() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Before any bets, user stake should be 0
        uint256 stake = hook.getUserStake(testKey, bettableStart, cellId, user1);
        assertEq(stake, 0);
    }

    function test_GetCellStake_BeforeBet() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Before any bets, cell stake should be 0
        uint256 stake = hook.getCellStake(testKey, bettableStart, cellId);
        assertEq(stake, 0);
    }

    // ============================================
    // EDGE CASE TESTS
    // ============================================

    function test_PlaceBet_MaximumAllowedStake() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Mint exactly MAX_STAKE_PER_CELL for user
        usdc.mint(user1, MAX_STAKE_PER_CELL);

        // Should succeed when betting exactly the max
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, MAX_STAKE_PER_CELL);

        assertEq(hook.getCellStake(testKey, bettableStart, cellId), MAX_STAKE_PER_CELL);
    }

    function test_PlaceBet_MinimumAmount() public {
        uint256 cellId = 1500;
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Bet 1 wei (smallest non-zero amount)
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, 1);

        assertEq(hook.getCellStake(testKey, bettableStart, cellId), 1);
    }

    function test_PlaceBet_VeryLargeCellId() public {
        uint256 cellId = type(uint256).max; // Maximum uint256
        (uint256 bettableStart,) = hook.getBettableWindows(testKey);

        // Should work with any valid cell ID
        vm.prank(user1);
        hook.placeBet(testKey, cellId, bettableStart, SMALL_BET);

        assertEq(hook.getCellStake(testKey, bettableStart, cellId), SMALL_BET);
    }
}

/**
 * @notice Mock ERC20 token for testing
 */
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;
    uint256 private _totalSupply;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        _totalSupply += amount;
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balances[from] >= amount, "Insufficient balance");
        require(allowances[from][msg.sender] >= amount, "Insufficient allowance");

        balances[from] -= amount;
        balances[to] += amount;
        allowances[from][msg.sender] -= amount;
        return true;
    }
}

/**
 * @notice Mock PoolManager for testing
 */
contract MockPoolManager {
// Minimal implementation for testing
}
