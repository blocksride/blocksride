// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SettlementTest
 * @notice Comprehensive test suite for settlement functionality with Pyth Network integration
 *
 * PRODUCTION FLOW (PYTH NETWORK INTEGRATION):
 * ===========================================
 * 1. Keeper script monitors windows for settlement eligibility (windowEnd reached)
 * 2. At windowEnd, keeper fetches Pyth VAA (Verifiable Action Approval) from Hermes API:
 *    - Hermes API: https://hermes.pyth.network/
 *    - Endpoint: GET /api/latest_vaas?ids[]=<price_feed_id>&publish_time=<windowEnd>
 *    - Returns cryptographically signed price data at exact timestamp
 * 3. Keeper calls settle{value: updateFee}(poolKey, windowId, pythVAA)
 *    - Contract pays Pyth oracle update fee via msg.value
 *    - Pyth oracle verifies VAA signature on-chain
 *    - Contract receives verified price at windowEnd timestamp
 * 4. Settlement proceeds: calculate winning cell, redemption rate, emit events
 *
 * MOCK VS PRODUCTION:
 * ===================
 * - Tests use MockPythOracle to simulate Pyth responses without network calls
 * - Production uses real IPyth contract deployed on Base:
 *   - Base Mainnet: 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a
 *   - Base Sepolia: 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729
 * - Keeper script implementation: See Docs/PYTH_INTEGRATION.md
 */
contract SettlementTest is Test {
    using PoolIdLibrary for PoolKey;

    PariHook public hook;
    MockPythOracle public pythOracle;
    MockERC20 public usdc;
    MockPoolManager public poolManager;

    PoolKey public testKey;
    PoolId public poolId;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public relayer = makeAddr("relayer");
    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");
    address public keeper = makeAddr("keeper");

    // Grid config constants
    bytes32 public constant PRICE_FEED_ID =
        bytes32(uint256(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace)); // ETH/USD
    uint256 public constant BAND_WIDTH = 2_000_000; // $2.00
    uint256 public constant WINDOW_DURATION = 60; // 60 seconds
    uint256 public constant FROZEN_WINDOWS = 3;
    uint256 public constant MAX_STAKE_PER_CELL = 100_000_000_000; // $100k
    uint256 public constant FEE_BPS = 200; // 2%
    uint256 public constant MIN_POOL_THRESHOLD = 1_000_000; // $1.00
    uint256 public constant GRID_EPOCH = 1_800_000_000; // 2027-01-15 06:40:00 UTC

    // Events to test
    event WindowSettled(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 winningCell,
        uint256 closingPrice,
        uint256 redemptionRate
    );
    event WindowVoided(PoolId indexed poolId, uint256 indexed windowId, uint256 totalRefundable);
    event WindowRolledOver(
        PoolId indexed poolId, uint256 indexed fromWindowId, uint256 indexed toWindowId, uint256 carryAmount
    );
    event FeeCollected(PoolId indexed poolId, uint256 indexed windowId, uint256 amount);

    function setUp() public {
        // Deploy mock contracts
        poolManager = new MockPoolManager();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pythOracle = new MockPythOracle();

        // Deploy PariHook
        hook = new PariHook(IPoolManager(address(poolManager)), IPyth(address(pythOracle)), admin, treasury, relayer);

        // Setup test pool key
        testKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 60,
            hooks: hook
        });
        poolId = testKey.toId();

        // Configure grid
        vm.prank(admin);
        hook.configureGrid(
            testKey,
            PRICE_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            GRID_EPOCH,
            address(usdc)
        );

        // Initialize pool via PoolManager (simulate Uniswap V4 flow)
        vm.prank(address(poolManager));
        hook.beforeInitialize(address(this), testKey, 0);

        // Fund test users
        usdc.mint(user1, 1_000_000_000); // $1000
        usdc.mint(user2, 1_000_000_000); // $1000

        // Approve hook to spend USDC
        vm.prank(user1);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(user2);
        usdc.approve(address(hook), type(uint256).max);

        // Fund keeper with ETH for Pyth oracle fees
        vm.deal(keeper, 10 ether);
    }

    // =============================================================
    //                      HELPER FUNCTIONS
    // =============================================================

    /**
     * @notice Convert USDC 6-decimal price to Pyth format
     * @param usdcPrice Price in USDC base units (e.g., 3_000_000_000 = $3000)
     * @param pythExpo Pyth exponent (typically -8 for crypto prices)
     * @return pythPrice Price in Pyth format
     */
    function convertToPythPrice(uint256 usdcPrice, int32 pythExpo) internal pure returns (int64) {
        // USDC has 6 decimals, so price is already in 10^6 format
        // Pyth format: actualPrice = pythPrice * 10^pythExpo
        // So: pythPrice = actualPrice / 10^pythExpo = actualPrice * 10^(-pythExpo)

        // Convert USDC 6-decimal to actual price (dollars)
        // actualPrice = usdcPrice / 10^6

        // Then convert to Pyth format:
        // pythPrice = actualPrice * 10^(-pythExpo)
        //           = (usdcPrice / 10^6) * 10^(-pythExpo)
        //           = usdcPrice * 10^(-pythExpo - 6)

        int32 exponentAdjustment = -pythExpo - 6;

        if (exponentAdjustment >= 0) {
            return int64(uint64(usdcPrice * (10 ** uint32(exponentAdjustment))));
        } else {
            return int64(uint64(usdcPrice / (10 ** uint32(-exponentAdjustment))));
        }
    }

    // =============================================================
    //                  SUCCESSFUL SETTLEMENT TESTS
    // =============================================================

    function test_Settlement_Success_SingleWinner() public {
        // Setup: Place bets in window 4 (first bettable window)
        uint256 windowId = FROZEN_WINDOWS + 1;

        // Price: $3000 → cell 1500
        uint256 betPrice = 3_000_000_000; // $3000
        uint256 cellId = betPrice / BAND_WIDTH; // 1500

        // User1 bets $10 on cell 1500
        vm.prank(user1);
        hook.placeBet(testKey, cellId, windowId, 10_000_000);

        // User2 bets $20 on cell 1501 (different cell)
        vm.prank(user2);
        hook.placeBet(testKey, cellId + 1, windowId, 20_000_000);

        // Fast forward to window end
        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);

        // Setup mock Pyth price: $3001.50 → lands in cell 1500
        uint256 closingPrice = 3_001_500_000; // $3001.50 in USDC 6-decimal
        pythOracle.setPriceAtTime(PRICE_FEED_ID, convertToPythPrice(closingPrice, -8), -8, uint64(windowEnd));

        // Settle the window
        vm.expectEmit(true, true, true, true);
        emit FeeCollected(poolId, windowId, 600_000); // 2% of $30 = $0.60

        vm.expectEmit(true, true, true, true);
        uint256 expectedRedemptionRate = (30_000_000 - 600_000) * 1e18 / 10_000_000; // (netPool * 1e18) / winStakes
        emit WindowSettled(poolId, windowId, cellId, closingPrice, expectedRedemptionRate);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");

        // Verify window state
        (uint256 totalPool, bool settled, bool voided, uint256 winningCell, uint256 redemptionRate) =
            hook.getWindow(testKey, windowId);

        assertEq(totalPool, 30_000_000, "Total pool should be $30");
        assertTrue(settled, "Window should be settled");
        assertFalse(voided, "Window should not be voided");
        assertEq(winningCell, cellId, "Winning cell should be 1500");
        assertEq(redemptionRate, expectedRedemptionRate, "Redemption rate mismatch");

        // Verify fee collection
        assertEq(hook.collectedFees(poolId), 600_000, "Fees should be collected");
    }

    function test_Settlement_Success_MultipleWinners() public {
        uint256 windowId = FROZEN_WINDOWS + 1;
        uint256 betPrice = 3_000_000_000;
        uint256 cellId = betPrice / BAND_WIDTH;

        // Both users bet on the same winning cell
        vm.prank(user1);
        hook.placeBet(testKey, cellId, windowId, 10_000_000); // $10

        vm.prank(user2);
        hook.placeBet(testKey, cellId, windowId, 40_000_000); // $40

        // Fast forward and settle
        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);

        pythOracle.setPriceAtTime(PRICE_FEED_ID, convertToPythPrice(betPrice, -8), -8, uint64(windowEnd));

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");

        // Verify redemption rate: ($50 - $1 fee) / $50 stakes = 0.98x
        (,,,, uint256 redemptionRate) = hook.getWindow(testKey, windowId);
        uint256 expectedRate = (50_000_000 - 1_000_000) * 1e18 / 50_000_000;
        assertEq(redemptionRate, expectedRate, "Redemption rate should be 0.98x");
    }

    // =============================================================
    //                     ROLLOVER TESTS
    // =============================================================

    function test_Settlement_Rollover_NoStakesOnWinningCell() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        // User1 bets on cell 1500
        vm.prank(user1);
        hook.placeBet(testKey, 1500, windowId, 10_000_000);

        // User2 bets on cell 1501
        vm.prank(user2);
        hook.placeBet(testKey, 1501, windowId, 20_000_000);

        // Fast forward
        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);

        // Price lands on cell 1502 (no stakes)
        uint256 closingPrice = 3_004_000_000; // cell 1502 in USDC 6-decimal
        pythOracle.setPriceAtTime(PRICE_FEED_ID, convertToPythPrice(closingPrice, -8), -8, uint64(windowEnd));

        // Expect rollover event
        vm.expectEmit(true, true, true, true);
        emit WindowRolledOver(poolId, windowId, windowId + 1, 30_000_000);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");

        // Verify source window is settled
        (, bool settled, bool voided,,) = hook.getWindow(testKey, windowId);
        assertTrue(settled, "Source window should be settled");
        assertFalse(voided, "Source window should not be voided");

        // Verify next window has backstop
        (uint256 nextTotalPool,,,,) = hook.getWindow(testKey, windowId + 1);
        assertEq(nextTotalPool, 30_000_000, "Next window should have rolled over pool");

        // Verify no fees collected on rollover
        assertEq(hook.collectedFees(poolId), 0, "No fees should be collected on rollover");
    }

    // =============================================================
    //                      VOID TESTS
    // =============================================================

    function test_Settlement_AutoVoid_PythPriceUnavailable() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        vm.prank(user1);
        hook.placeBet(testKey, 1500, windowId, 10_000_000);

        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);

        // Don't set any Pyth price → oracle will revert

        vm.expectEmit(true, true, false, true);
        emit WindowVoided(poolId, windowId, 10_000_000);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");

        // Verify window is voided
        (, bool settled, bool voided,,) = hook.getWindow(testKey, windowId);
        assertFalse(settled, "Window should not be marked as settled");
        assertTrue(voided, "Window should be voided");
    }

    function test_Settlement_AutoVoid_OrganicPoolBelowThreshold() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        // Place very small bet (below $1 threshold)
        vm.prank(user1);
        hook.placeBet(testKey, 1500, windowId, 500_000); // $0.50

        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);

        pythOracle.setPriceAtTime(PRICE_FEED_ID, convertToPythPrice(3_000_000_000, -8), -8, uint64(windowEnd));

        vm.expectEmit(true, true, false, true);
        emit WindowVoided(poolId, windowId, 500_000);

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");

        (,, bool voided,,) = hook.getWindow(testKey, windowId);
        assertTrue(voided, "Window should be auto-voided");
    }

    function test_VoidWindow_ManualByAdmin() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        vm.prank(user1);
        hook.placeBet(testKey, 1500, windowId, 10_000_000);

        // Admin manually voids window before settlement
        vm.expectEmit(true, true, false, true);
        emit WindowVoided(poolId, windowId, 10_000_000);

        vm.prank(admin);
        hook.voidWindow(testKey, windowId);

        (, bool settled, bool voided,,) = hook.getWindow(testKey, windowId);
        assertFalse(settled, "Window should not be settled");
        assertTrue(voided, "Window should be voided");
    }

    function test_VoidWindow_RevertsIfAlreadySettled() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        vm.prank(user1);
        hook.placeBet(testKey, 1500, windowId, 10_000_000);

        // Settle window first
        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);
        pythOracle.setPriceAtTime(PRICE_FEED_ID, convertToPythPrice(3_000_000_000, -8), -8, uint64(windowEnd));

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");

        // Try to void after settlement
        vm.prank(admin);
        vm.expectRevert("Window already settled");
        hook.voidWindow(testKey, windowId);
    }

    function test_VoidWindow_OnlyAdmin() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        vm.prank(user1);
        vm.expectRevert();
        hook.voidWindow(testKey, windowId);
    }

    // =============================================================
    //                   PYTH PRICE PARSING TESTS
    // =============================================================

    function test_PythPriceConversion_PositiveExponent() public {
        // Test Pyth price with positive exponent (rare case)
        // Price: 30 * 10^2 = 3000
        int64 pythPrice = 30;
        int32 expo = 2;

        pythOracle.setPriceAtTime(PRICE_FEED_ID, pythPrice, expo, uint64(block.timestamp));

        uint256 converted = hook._parsePythPrice{value: 0.01 ether}(
            "", PRICE_FEED_ID, uint64(block.timestamp), uint64(block.timestamp + 10)
        );

        // Expected: 30 * 10^(2+6) = 30 * 10^8 = 3_000_000_000
        assertEq(converted, 3_000_000_000, "Positive exponent conversion failed");
    }

    function test_PythPriceConversion_NegativeExponent() public {
        // Common case: ETH/USD with -8 exponent
        // Price: 300000000000 * 10^-8 = 3000.00
        int64 pythPrice = 300000000000;
        int32 expo = -8;

        pythOracle.setPriceAtTime(PRICE_FEED_ID, pythPrice, expo, uint64(block.timestamp));

        uint256 converted = hook._parsePythPrice{value: 0.01 ether}(
            "", PRICE_FEED_ID, uint64(block.timestamp), uint64(block.timestamp + 10)
        );

        // Expected: 300000000000 * 10^(-8+6) = 300000000000 * 10^-2 = 3_000_000_000
        assertEq(converted, 3_000_000_000, "Negative exponent conversion failed");
    }

    function test_PythPriceConversion_ZeroExponent() public {
        int64 pythPrice = 3000;
        int32 expo = 0;

        pythOracle.setPriceAtTime(PRICE_FEED_ID, pythPrice, expo, uint64(block.timestamp));

        uint256 converted = hook._parsePythPrice{value: 0.01 ether}(
            "", PRICE_FEED_ID, uint64(block.timestamp), uint64(block.timestamp + 10)
        );

        // Expected: 3000 * 10^(0+6) = 3000 * 10^6 = 3_000_000_000
        assertEq(converted, 3_000_000_000, "Zero exponent conversion failed");
    }

    // =============================================================
    //                     REVERT TESTS
    // =============================================================

    function test_Settlement_RevertsIfNotEnded() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        vm.prank(user1);
        hook.placeBet(testKey, 1500, windowId, 10_000_000);

        // Try to settle before window ends
        vm.expectRevert("Window not ended");
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");
    }

    function test_Settlement_RevertsIfAlreadySettled() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        vm.prank(user1);
        hook.placeBet(testKey, 1500, windowId, 10_000_000);

        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);
        pythOracle.setPriceAtTime(PRICE_FEED_ID, convertToPythPrice(3_000_000_000, -8), -8, uint64(windowEnd));

        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");

        // Try to settle again
        vm.expectRevert("Already settled");
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");
    }

    function test_Settlement_RevertsIfAlreadyVoided() public {
        uint256 windowId = FROZEN_WINDOWS + 1;

        vm.prank(admin);
        hook.voidWindow(testKey, windowId);

        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);

        vm.expectRevert("Already voided");
        vm.prank(keeper);
        hook.settle{value: 0.01 ether}(testKey, windowId, "");
    }
}

// =============================================================
//                      MOCK CONTRACTS
// =============================================================

contract MockPythOracle is IPyth {
    struct MockPrice {
        int64 price;
        int32 expo;
        uint256 publishTime;
    }

    mapping(bytes32 => MockPrice) public prices;

    function setPriceAtTime(bytes32 id, int64 price, int32 expo, uint64 publishTime) external {
        prices[id] = MockPrice({price: price, expo: expo, publishTime: publishTime});
    }

    function parsePriceFeedUpdates(
        bytes[] calldata, /* updateData */
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory priceFeeds) {
        priceFeeds = new PythStructs.PriceFeed[](priceIds.length);

        for (uint256 i = 0; i < priceIds.length; i++) {
            MockPrice storage p = prices[priceIds[i]];

            // Revert if no price set (simulates oracle unavailable)
            require(p.publishTime > 0, "Price not available");
            require(p.publishTime >= minPublishTime && p.publishTime <= maxPublishTime, "Price outside time window");

            priceFeeds[i] = PythStructs.PriceFeed({
                id: priceIds[i],
                price: PythStructs.Price({price: p.price, conf: 1000000, expo: p.expo, publishTime: p.publishTime}),
                emaPrice: PythStructs.Price({price: p.price, conf: 1000000, expo: p.expo, publishTime: p.publishTime})
            });
        }
    }

    // Stub implementations for unused IPyth methods
    function getValidTimePeriod() external pure override returns (uint256) {
        return 60;
    }

    function getPrice(bytes32) external pure override returns (PythStructs.Price memory) {
        revert("Not implemented");
    }

    function getEmaPrice(bytes32) external pure override returns (PythStructs.Price memory) {
        revert("Not implemented");
    }

    function getPriceUnsafe(bytes32) external pure override returns (PythStructs.Price memory) {
        revert("Not implemented");
    }

    function getPriceNoOlderThan(bytes32, uint256) external pure override returns (PythStructs.Price memory) {
        revert("Not implemented");
    }

    function getEmaPriceUnsafe(bytes32) external pure override returns (PythStructs.Price memory) {
        revert("Not implemented");
    }

    function getEmaPriceNoOlderThan(bytes32, uint256) external pure override returns (PythStructs.Price memory) {
        revert("Not implemented");
    }

    function updatePriceFeeds(bytes[] calldata) external payable override {}
    function updatePriceFeedsIfNecessary(bytes[] calldata, bytes32[] calldata, uint64[] calldata)
        external
        payable
        override
    {}

    function getUpdateFee(bytes[] calldata) external pure override returns (uint256) {
        return 0.01 ether;
    }
}

contract MockERC20 is IERC20 {
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
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (msg.sender != from) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPoolManager {}
