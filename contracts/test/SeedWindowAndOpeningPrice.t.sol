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
 * @title SeedWindowAndOpeningPriceTest
 * @notice Tests for:
 *   1. seedWindow() — keeper pre-seeding future windows beyond the frozen zone
 *   2. Opening-price settlement — winning cell determined by price at windowStart,
 *      settlement allowed as soon as the window opens (not at windowEnd)
 */
contract SeedWindowAndOpeningPriceTest is Test {
    using PoolIdLibrary for PoolKey;

    PariHook public hook;
    MockPythOracle public pythOracle;
    MockERC20 public usdc;
    MockPoolManager public poolManager;

    PoolKey public testKey;
    PoolId public poolId;

    address public admin    = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public relayer  = makeAddr("relayer");
    address public user1    = makeAddr("user1");
    address public user2    = makeAddr("user2");
    address public keeper   = makeAddr("keeper");
    address public stranger = makeAddr("stranger");

    bytes32 public constant PRICE_FEED_ID =
        bytes32(uint256(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace));
    uint256 public constant BAND_WIDTH          = 2_000_000;   // $2.00
    uint256 public constant WINDOW_DURATION     = 60;          // 60 seconds
    uint256 public constant FROZEN_WINDOWS      = 3;
    uint256 public constant MAX_STAKE_PER_CELL  = 100_000_000_000;
    uint256 public constant FEE_BPS             = 200;         // 2%
    uint256 public constant MIN_POOL_THRESHOLD  = 1_000_000;   // $1.00
    uint256 public constant GRID_EPOCH          = 1_800_000_000;

    // First window reachable by placeBet when current=0: current + frozenWindows + 1
    uint256 public constant FIRST_BETTABLE = FROZEN_WINDOWS + 1; // 4

    // First window reachable by seedWindow when current=0: same lower bound
    uint256 public constant FIRST_SEEDABLE = FROZEN_WINDOWS + 1; // 4

    event WindowSettled(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 winningCell,
        uint256 openingPrice,
        uint256 redemptionRate
    );

    // =========================================================
    //                        SETUP
    // =========================================================

    function setUp() public {
        poolManager = new MockPoolManager();
        usdc        = new MockERC20("USD Coin", "USDC", 6);
        pythOracle  = new MockPythOracle();

        hook = new PariHook(
            IPoolManager(address(poolManager)),
            IPyth(address(pythOracle)),
            admin, treasury, relayer
        );

        testKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: hook
        });
        poolId = testKey.toId();

        vm.prank(admin);
        hook.configureGrid(
            testKey, PRICE_FEED_ID, BAND_WIDTH, WINDOW_DURATION,
            FROZEN_WINDOWS, MAX_STAKE_PER_CELL, FEE_BPS, MIN_POOL_THRESHOLD,
            GRID_EPOCH, address(usdc)
        );

        vm.prank(address(poolManager));
        hook.beforeInitialize(address(this), testKey, 0);

        // Fund users
        usdc.mint(user1,    1_000_000_000);
        usdc.mint(user2,    1_000_000_000);
        usdc.mint(treasury, 1_000_000_000); // treasury seeds liquidity

        vm.prank(user1);    usdc.approve(address(hook), type(uint256).max);
        vm.prank(user2);    usdc.approve(address(hook), type(uint256).max);
        vm.prank(treasury); usdc.approve(address(hook), type(uint256).max);

        vm.deal(keeper, 10 ether);
        vm.deal(treasury, 10 ether);
    }

    // =========================================================
    //                    HELPERS
    // =========================================================

    function windowStart(uint256 windowId) internal pure returns (uint256) {
        return GRID_EPOCH + windowId * WINDOW_DURATION;
    }

    function windowEnd(uint256 windowId) internal pure returns (uint256) {
        return GRID_EPOCH + (windowId + 1) * WINDOW_DURATION;
    }

    /// @dev Set mock oracle price at a given timestamp
    function mockPrice(uint256 usdcPrice, uint256 timestamp) internal {
        int64 pythPrice = convertToPythPrice(usdcPrice, -8);
        pythOracle.setPriceAtTime(PRICE_FEED_ID, pythPrice, -8, SafeCast.toUint64(timestamp));
    }

    function convertToPythPrice(uint256 usdcPrice, int32 pythExpo) internal pure returns (int64) {
        int32 exponentAdjustment = -pythExpo - 6;
        if (exponentAdjustment >= 0) {
            uint256 adj = SafeCast.toUint256(int256(exponentAdjustment));
            return SafeCast.toInt64(SafeCast.toInt256(usdcPrice * (10 ** adj)));
        } else {
            uint256 adj = SafeCast.toUint256(int256(-exponentAdjustment));
            return SafeCast.toInt64(SafeCast.toInt256(usdcPrice / (10 ** adj)));
        }
    }

    // =========================================================
    //                  seedWindow — ACCESS CONTROL
    // =========================================================

    function test_SeedWindow_NonTreasury_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        hook.seedWindow(testKey, FIRST_SEEDABLE, FIRST_SEEDABLE, 10_000_000);
    }

    function test_SeedWindow_RegularUser_Reverts() public {
        vm.prank(user1);
        vm.expectRevert();
        hook.seedWindow(testKey, 1500, FIRST_SEEDABLE, 10_000_000);
    }

    // =========================================================
    //                  seedWindow — WINDOW VALIDATION
    // =========================================================

    function test_SeedWindow_WindowTooClose_Reverts() public {
        // At GRID_EPOCH: current=0, seedableStart = 0 + FROZEN_WINDOWS + 1 = 4
        // Try seeding window 3 (= FROZEN_WINDOWS), which is < seedableStart
        vm.warp(GRID_EPOCH);
        vm.prank(treasury);
        vm.expectRevert("Window not seedable yet");
        hook.seedWindow(testKey, 1500, FROZEN_WINDOWS, 10_000_000);
    }

    function test_SeedWindow_CurrentWindow_Reverts() public {
        vm.warp(GRID_EPOCH);
        vm.prank(treasury);
        vm.expectRevert("Window not seedable yet");
        hook.seedWindow(testKey, 1500, 0, 10_000_000);
    }

    function test_SeedWindow_FirstSeedable_Succeeds() public {
        vm.warp(GRID_EPOCH);
        vm.prank(treasury);
        hook.seedWindow(testKey, 1500, FIRST_SEEDABLE, 10_000_000);

        (uint256 totalPool,,,,, ) = hook.getWindow(testKey, FIRST_SEEDABLE);
        assertEq(totalPool, 10_000_000, "Pool should reflect seeded amount");
    }

    function test_SeedWindow_FarFuture_Succeeds() public {
        // seedWindow has no upper bound — can seed 100 windows ahead
        uint256 farWindow = FIRST_SEEDABLE + 100;
        vm.warp(GRID_EPOCH);
        vm.prank(treasury);
        hook.seedWindow(testKey, 1500, farWindow, 5_000_000);

        (uint256 totalPool,,,,, ) = hook.getWindow(testKey, farWindow);
        assertEq(totalPool, 5_000_000);
    }

    /// @dev Both placeBet and seedWindow can reach any window >= bettableStart (no upper limit)
    function test_SeedWindow_BeyondPreviousUpperBound_Succeeds() public {
        vm.warp(GRID_EPOCH);
        uint256 farWindow = FROZEN_WINDOWS + 4; // previously beyond bettableEnd, now valid

        // placeBet should also succeed — no upper bound any more
        vm.prank(user1);
        hook.placeBet(testKey, 1500, farWindow, 10_000_000);

        // seedWindow should succeed too
        vm.prank(treasury);
        hook.seedWindow(testKey, 1500, farWindow, 10_000_000);

        (uint256 totalPool,,,,, ) = hook.getWindow(testKey, farWindow);
        assertEq(totalPool, 20_000_000);
    }

    // =========================================================
    //                  seedWindow — ACCOUNTING
    // =========================================================

    function test_SeedWindow_UpdatesPoolAndCellStakes() public {
        vm.warp(GRID_EPOCH);
        uint256 wid    = FIRST_SEEDABLE;
        uint256 cellId = 1500;
        uint256 amount = 20_000_000;

        vm.prank(treasury);
        hook.seedWindow(testKey, cellId, wid, amount);

        (uint256 totalPool,,,,, ) = hook.getWindow(testKey, wid);
        assertEq(totalPool, amount, "totalPool mismatch");
    }

    function test_SeedWindow_MultipleCells_Succeeds() public {
        vm.warp(GRID_EPOCH);
        uint256 wid = FIRST_SEEDABLE;

        vm.startPrank(treasury);
        hook.seedWindow(testKey, 1498, wid, 5_000_000);
        hook.seedWindow(testKey, 1499, wid, 5_000_000);
        hook.seedWindow(testKey, 1500, wid, 5_000_000);
        hook.seedWindow(testKey, 1501, wid, 5_000_000);
        vm.stopPrank();

        (uint256 totalPool,,,,, ) = hook.getWindow(testKey, wid);
        assertEq(totalPool, 20_000_000, "Total pool should sum all seeded cells");
    }

    function test_SeedWindow_ExceedsMaxStakePerCell_Reverts() public {
        vm.warp(GRID_EPOCH);
        vm.prank(treasury);
        vm.expectRevert("Exceeds max stake per cell");
        hook.seedWindow(testKey, 1500, FIRST_SEEDABLE, MAX_STAKE_PER_CELL + 1);
    }

    function test_SeedWindow_EmitsBetPlacedEvent() public {
        vm.warp(GRID_EPOCH);
        uint256 wid    = FIRST_SEEDABLE;
        uint256 cellId = 1500;
        uint256 amount = 10_000_000;

        vm.prank(treasury);
        vm.expectEmit(true, true, true, true);
        emit BetPlaced(poolId, wid, cellId, treasury, amount);
        hook.seedWindow(testKey, cellId, wid, amount);
    }

    // =========================================================
    //         OPENING PRICE — SETTLEMENT TIMING
    // =========================================================

    function test_Settlement_BeforeWindowStart_Reverts() public {
        uint256 wid = FIRST_BETTABLE;
        _placeBetsOnWindow(wid, 3_000_000_000, 10_000_000);

        uint256 start = windowStart(wid);
        mockPrice(3_000_000_000, start);

        // One second before window opens
        vm.warp(start - 1);
        vm.prank(keeper);
        vm.expectRevert("Window not started");
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");
    }

    function test_Settlement_AtWindowStart_Succeeds() public {
        uint256 wid = FIRST_BETTABLE;
        _placeBetsOnWindow(wid, 3_000_000_000, 10_000_000);

        uint256 start = windowStart(wid);
        mockPrice(3_000_000_000, start);

        // Exactly at window start — should settle without waiting for windowEnd
        vm.warp(start);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (, bool settled,,,,) = hook.getWindow(testKey, wid);
        assertTrue(settled, "Should be settled at windowStart");
    }

    function test_Settlement_DuringWindow_Succeeds() public {
        uint256 wid   = FIRST_BETTABLE;
        uint256 start = windowStart(wid);
        _placeBetsOnWindow(wid, 3_000_000_000, 10_000_000);
        mockPrice(3_000_000_000, start);

        // Settle halfway through the window (30s in)
        vm.warp(start + 30);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (, bool settled,,,,) = hook.getWindow(testKey, wid);
        assertTrue(settled, "Should be settled mid-window");
    }

    function test_Settlement_AfterWindowEnd_StillSucceeds() public {
        uint256 wid = FIRST_BETTABLE;
        _placeBetsOnWindow(wid, 3_000_000_000, 10_000_000);

        uint256 start = windowStart(wid);
        mockPrice(3_000_000_000, start);

        // Settle after the window has fully closed
        vm.warp(windowEnd(wid) + 1);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (, bool settled,,,,) = hook.getWindow(testKey, wid);
        assertTrue(settled);
    }

    // =========================================================
    //         OPENING PRICE — WINNING CELL DETERMINATION
    // =========================================================

    function test_Settlement_UsesOpeningPrice_NotClosingPrice() public {
        uint256 wid = FIRST_BETTABLE;

        uint256 openingPrice = 3_000_000_000; // $3000 → cell 1500
        uint256 closingPrice = 3_100_000_000; // $3100 → cell 1550 (different cell)

        uint256 openingCell = openingPrice / BAND_WIDTH; // 1500
        uint256 closingCell = closingPrice / BAND_WIDTH; // 1550

        // User bets on the opening cell
        vm.prank(user1);
        hook.placeBet(testKey, openingCell, wid, 10_000_000);

        uint256 start = windowStart(wid);
        // VAA is for windowStart (opening price), not windowEnd
        mockPrice(openingPrice, start);

        vm.warp(start);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (,,,, uint256 winningCell,) = hook.getWindow(testKey, wid);
        assertEq(winningCell, openingCell, "Winner should be determined by opening price");
        assertTrue(winningCell != closingCell, "Closing price cell should not be the winner");
    }

    function test_Settlement_OpeningCellWins_ClosingCellDoesNot() public {
        uint256 wid = FIRST_BETTABLE;

        uint256 openingPrice = 3_000_000_000; // cell 1500
        uint256 closingPrice = 3_200_000_000; // cell 1600

        uint256 openingCell = openingPrice / BAND_WIDTH;
        uint256 closingCell = closingPrice / BAND_WIDTH;

        // user1 bets on opening cell (should win)
        vm.prank(user1);
        hook.placeBet(testKey, openingCell, wid, 10_000_000);

        // user2 bets on closing cell (should lose)
        vm.prank(user2);
        hook.placeBet(testKey, closingCell, wid, 10_000_000);

        uint256 start = windowStart(wid);
        mockPrice(openingPrice, start);

        vm.warp(start);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (,,,,uint256 winningCell, uint256 redemptionRate) = hook.getWindow(testKey, wid);
        assertEq(winningCell, openingCell, "Opening cell wins");

        // user1's stake = $10, total pool = $20, fee = 2% of $20 = $0.40
        // netPool = $19.60, winStakes = $10 → rate = 1.96x
        uint256 expectedRate = (20_000_000 - 400_000) * 1e18 / 10_000_000;
        assertEq(redemptionRate, expectedRate, "Redemption rate should be 1.96x");
    }

    function test_Settlement_ClosingPriceVAA_MarksUnresolved() public {
        uint256 wid = FIRST_BETTABLE;
        _placeBetsOnWindow(wid, 3_000_000_000, 10_000_000);

        uint256 start = windowStart(wid);
        uint256 end   = windowEnd(wid);

        // Price only at windowEnd — no opening price in grace window.
        // Before resolution deadline → should mark unresolved, not void.
        mockPrice(3_000_000_000, end);

        vm.warp(start);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (, , bool voided, bool unresolved,,) = hook.getWindow(testKey, wid);
        assertFalse(voided, "Window should not be voided yet - deadline not passed");
        assertTrue(unresolved, "Window should be marked unresolved for retry");
    }

    function test_Settlement_OpeningPriceGracePeriod_10Seconds() public {
        uint256 wid   = FIRST_BETTABLE;
        uint256 start = windowStart(wid);
        _placeBetsOnWindow(wid, 3_000_000_000, 10_000_000);

        // Price published at start+9 (within 10s grace)
        mockPrice(3_000_000_000, start + 9);

        vm.warp(start + 9);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (, bool settled,,,,) = hook.getWindow(testKey, wid);
        assertTrue(settled, "Price within 10s grace period should be accepted");
    }

    function test_Settlement_OpeningPriceOutsideGracePeriod_MarksUnresolved() public {
        uint256 wid   = FIRST_BETTABLE;
        uint256 start = windowStart(wid);
        _placeBetsOnWindow(wid, 3_000_000_000, 10_000_000);

        // Price published at start+11 (outside 10s grace) — no valid opening price in range.
        // Before resolution deadline → marks unresolved so keeper can retry.
        mockPrice(3_000_000_000, start + 11);

        vm.warp(start + 11);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (, bool settled, bool voided, bool unresolved,,) = hook.getWindow(testKey, wid);
        assertFalse(settled, "Window should not be settled");
        assertFalse(voided, "Window should not be voided yet");
        assertTrue(unresolved, "Window should be unresolved - keeper can retry or finalize after deadline");
    }

    // =========================================================
    //              seedWindow + SETTLEMENT INTEGRATION
    // =========================================================

    function test_SeedWindow_ThenSettleWithOpeningPrice() public {
        uint256 wid       = FIRST_SEEDABLE;
        uint256 seedCell  = 1500; // $3000 range
        uint256 seedAmount = 10_000_000;

        // Treasury seeds the window
        vm.warp(GRID_EPOCH);
        vm.prank(treasury);
        hook.seedWindow(testKey, seedCell, wid, seedAmount);

        // User bets on the same cell
        vm.prank(user1);
        hook.placeBet(testKey, seedCell, wid, 10_000_000);

        // Settle at windowStart using opening price
        uint256 start = windowStart(wid);
        uint256 openingPrice = seedCell * BAND_WIDTH + 500_000; // mid-cell
        mockPrice(openingPrice, start);

        vm.warp(start);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        (uint256 totalPool, bool settled,,, uint256 winningCell,) = hook.getWindow(testKey, wid);
        assertTrue(settled);
        assertEq(winningCell, seedCell);
        assertEq(totalPool, 20_000_000, "Pool includes both seed and user bet");
    }

    function test_SeedWindow_Rollover_WhenNoWinners() public {
        uint256 wid = FIRST_SEEDABLE;

        // Seed cell 1500, but opening price lands on cell 1600 (no bets there)
        vm.warp(GRID_EPOCH);
        vm.prank(treasury);
        hook.seedWindow(testKey, 1500, wid, 10_000_000);

        uint256 start = windowStart(wid);
        uint256 openingPrice = 1600 * BAND_WIDTH + 500_000; // lands in cell 1600
        mockPrice(openingPrice, start);

        vm.warp(start);
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, wid, hex"01");

        // Should rollover to next bettable window since no bets on winning cell.
        // At warp(start), current = wid, so rolloverTarget = wid + FROZEN_WINDOWS + 1.
        uint256 rolloverTarget = wid + FROZEN_WINDOWS + 1;

        (, bool settled, bool voided,,,) = hook.getWindow(testKey, wid);
        assertTrue(settled, "Window marked settled after rollover");
        assertFalse(voided);

        (uint256 nextPool,,,,, ) = hook.getWindow(testKey, rolloverTarget);
        assertGt(nextPool, 0, "Next bettable window should receive rolled-over funds");
    }

    // =========================================================
    //                      INTERNAL HELPERS
    // =========================================================

    function _placeBetsOnWindow(uint256 wid, uint256 price, uint256 amount) internal {
        uint256 cellId = price / BAND_WIDTH;
        vm.prank(user1);
        hook.placeBet(testKey, cellId, wid, amount);
    }

    event BetPlaced(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 indexed cellId,
        address bettor,
        uint256 amount
    );
}

// =============================================================
//                        MOCK CONTRACTS
// =============================================================

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

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

contract MockPythOracle is IPyth {
    struct MockPrice {
        int64 price;
        int32 expo;
        uint64 publishTime;
    }

    mapping(bytes32 => MockPrice) public prices;

    error InsufficientFee();
    error InvalidUpdateData();
    error PriceFeedNotFoundWithinRange();

    function setPriceAtTime(bytes32 id, int64 price, int32 expo, uint64 publishTime) external {
        prices[id] = MockPrice({ price: price, expo: expo, publishTime: publishTime });
    }

    function parsePriceFeedUpdates(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory priceFeeds) {
        if (msg.value < 0.01 ether) revert InsufficientFee();
        if (updateData.length == 0 || updateData[0].length == 0 || updateData[0][0] == bytes1(0xff)) {
            revert PriceFeedNotFoundWithinRange();
        }

        priceFeeds = new PythStructs.PriceFeed[](priceIds.length);
        for (uint256 i = 0; i < priceIds.length; i++) {
            MockPrice storage p = prices[priceIds[i]];
            if (p.publishTime == 0 || p.publishTime < minPublishTime || p.publishTime > maxPublishTime) {
                revert PriceFeedNotFoundWithinRange();
            }
            priceFeeds[i] = PythStructs.PriceFeed({
                id: priceIds[i],
                price: PythStructs.Price({ price: p.price, conf: 0, expo: p.expo, publishTime: p.publishTime }),
                emaPrice: PythStructs.Price({ price: p.price, conf: 0, expo: p.expo, publishTime: p.publishTime })
            });
        }
    }

    function getUpdateFee(bytes[] calldata) external pure override returns (uint256) {
        return 0.01 ether;
    }

    // IPyth stubs not needed for these tests
    function getPriceUnsafe(bytes32) external pure returns (PythStructs.Price memory) {
        return PythStructs.Price(0, 0, 0, 0);
    }

    function getPriceNoOlderThan(bytes32, uint256) external pure returns (PythStructs.Price memory) {
        return PythStructs.Price(0, 0, 0, 0);
    }

    function getEmaPrice(bytes32) external pure returns (PythStructs.Price memory) {
        return PythStructs.Price(0, 0, 0, 0);
    }

    function getEmaPriceUnsafe(bytes32) external pure returns (PythStructs.Price memory) {
        return PythStructs.Price(0, 0, 0, 0);
    }

    function getEmaPriceNoOlderThan(bytes32, uint256) external pure returns (PythStructs.Price memory) {
        return PythStructs.Price(0, 0, 0, 0);
    }

    function updatePriceFeeds(bytes[] calldata) external payable override {}

    function updatePriceFeedsIfNecessary(bytes[] calldata, bytes32[] calldata, uint64[] calldata)
        external
        payable
        override
    {}

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory) {
        return this.parsePriceFeedUpdates{value: msg.value}(updateData, priceIds, minPublishTime, maxPublishTime);
    }

    function getValidTimePeriod() external pure override returns (uint256) {
        return 60;
    }

    function getPrice(bytes32) external pure returns (PythStructs.Price memory) {
        return PythStructs.Price(0, 0, 0, 0);
    }
}
