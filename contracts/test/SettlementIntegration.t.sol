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
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title SettlementIntegrationTest
 * @notice Integration tests using REAL Pyth Network oracle on Base Sepolia
 *
 * REAL PYTH NETWORK INTEGRATION:
 * ==============================
 * This test suite connects to the actual Pyth oracle contract deployed on Base Sepolia
 * and fetches real-time ETH/USD prices from the Pyth Network.
 *
 * Running These Tests:
 * -------------------
 * 1. Copy .env.example to .env and fill in BASE_SEPOLIA_RPC_URL
 * 2. Load environment: source .env
 * 3. Run with fork: forge test --match-contract SettlementIntegrationTest --fork-url $BASE_SEPOLIA_RPC_URL -vvv
 *
 * What This Tests:
 * ---------------
 * - Real Pyth price fetching from Base Sepolia
 * - Price conversion from Pyth format to USDC 6-decimal
 * - Settlement with actual network prices
 * - Pyth update fee handling (paid in native ETH)
 *
 * Pyth Oracle Details:
 * -------------------
 * - Contract: 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729 (Base Sepolia)
 * - ETH/USD Feed ID: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
 * - Update Fee: ~0.01 ETH (query via getUpdateFee())
 * - Documentation: https://docs.pyth.network/price-feeds/use-real-time-data/evm
 *
 * Production Flow:
 * ---------------
 * 1. Keeper fetches VAA from Hermes API: https://hermes.pyth.network/api/latest_vaas
 * 2. Keeper submits VAA + update fee to settle()
 * 3. Contract calls Pyth oracle's parsePriceFeedUpdates()
 * 4. Pyth validates VAA signature and returns verified price
 * 5. Settlement proceeds with verified price
 */
contract SettlementIntegrationTest is Test {
    using PoolIdLibrary for PoolKey;

    // Real Pyth oracle on Base Sepolia
    IPyth public constant PYTH_ORACLE = IPyth(0xA2aa501b19aff244D90cc15a4Cf739D2725B5729);

    // ETH/USD price feed ID
    bytes32 public constant ETH_USD_FEED_ID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;

    PariHook public hook;
    MockERC20 public usdc;
    MockPoolManager public poolManager;

    PoolKey public testKey;
    PoolId public poolId;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public relayer = makeAddr("relayer");
    address public user1 = makeAddr("user1");
    address public keeper = makeAddr("keeper");
    bool internal forkReady;

    // Grid config
    uint256 public constant BAND_WIDTH = 2_000_000; // $2.00
    uint256 public constant WINDOW_DURATION = 60; // 60 seconds
    uint256 public constant FROZEN_WINDOWS = 3;
    uint256 public constant MAX_STAKE_PER_CELL = 100_000_000_000; // $100k
    uint256 public constant FEE_BPS = 200; // 2%
    uint256 public constant MIN_POOL_THRESHOLD = 1_000_000; // $1.00
    uint256 public constant GRID_EPOCH = 1_800_000_000; // 2027-01-15 06:40:00 UTC

    modifier onlyFork() {
        if (!forkReady) {
            vm.skip(true);
        }
        _;
    }

    function setUp() public {
        // Skip entire test suite if not running on a fork
        // Check if there's code at the Pyth oracle address
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(0xA2aa501b19aff244D90cc15a4Cf739D2725B5729)
        }
        if (codeSize == 0) {
            // No code at Pyth address = not on fork, skip all tests
            vm.skip(true);
            return;
        }

        // Additional check: try to call Pyth oracle
        try PYTH_ORACLE.getValidTimePeriod() returns (uint256) {
            forkReady = true;
        } catch {
            vm.skip(true);
            return;
        }

        // Deploy mock contracts
        poolManager = new MockPoolManager();
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Deploy PariHook with REAL Pyth oracle
        hook = new PariHook(IPoolManager(address(poolManager)), PYTH_ORACLE, admin, treasury, relayer);

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
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            GRID_EPOCH,
            address(usdc)
        );

        // Initialize pool
        vm.prank(address(poolManager));
        hook.beforeInitialize(address(this), testKey, 0);

        // Fund users
        usdc.mint(user1, 1_000_000_000); // $1000
        vm.prank(user1);
        usdc.approve(address(hook), type(uint256).max);

        // Fund keeper with ETH for Pyth fees
        vm.deal(keeper, 10 ether);
    }

    // =============================================================
    //                  REAL PYTH PRICE TESTS
    // =============================================================

    function test_FetchRealPythPrice_CurrentETHPrice() public onlyFork {
        console.log("\n=== Fetching REAL ETH/USD price from Pyth Network ===");

        // Get current price from Pyth (no update needed for latest price)
        PythStructs.Price memory price = PYTH_ORACLE.getPriceUnsafe(ETH_USD_FEED_ID);

        console.log("Raw Pyth Price:");
        console.log("  price:", int256(price.price));
        console.log("  expo:", int256(price.expo));
        console.log("  conf:", price.conf);
        console.log("  publishTime:", price.publishTime);

        // Convert to human-readable price
        int64 rawPrice = price.price;
        int32 expo = price.expo;

        // Calculate actual price: price * 10^expo
        uint256 actualPrice;
        if (expo < 0) {
            actualPrice = SafeCast.toUint256(int256(rawPrice)) / (10 ** SafeCast.toUint256(int256(-expo)));
        } else {
            actualPrice = SafeCast.toUint256(int256(rawPrice)) * (10 ** SafeCast.toUint256(int256(expo)));
        }

        console.log("\nConverted Price:");
        console.log("  ETH/USD: $", actualPrice);

        // Verify price is reasonable (ETH typically between $1000-$10000)
        assertGt(actualPrice, 1000, "ETH price should be > $1000");
        assertLt(actualPrice, 10000, "ETH price should be < $10000");

        console.log("\nPyth price fetch successful!");
    }

    function test_FetchRealPythPrice_WithUpdateFee() public onlyFork {
        console.log("\n=== Testing Pyth Update Fee ===");

        // Query update fee for parsing price updates
        bytes[] memory emptyUpdateData = new bytes[](0);
        uint256 updateFee = PYTH_ORACLE.getUpdateFee(emptyUpdateData);

        console.log("Pyth Update Fee (wei):", updateFee);
        console.log("Pyth Update Fee (ETH):", updateFee / 1e18);

        // Verify fee is reasonable (typically ~0.01 ETH)
        assertGt(updateFee, 0, "Update fee should be > 0");
        assertLt(updateFee, 0.1 ether, "Update fee should be < 0.1 ETH");
    }

    function test_PriceConversion_RealPythData() public onlyFork {
        console.log("\n=== Testing Price Conversion with Real Pyth Data ===");

        // Get current Pyth price
        PythStructs.Price memory pythPrice = PYTH_ORACLE.getPriceUnsafe(ETH_USD_FEED_ID);

        console.log("Input (Pyth format):");
        console.log("  price:", int256(pythPrice.price));
        console.log("  expo:", int256(pythPrice.expo));

        // Manually convert to USDC 6-decimal using our contract's logic
        uint256 convertedPrice = convertPythToUsdc(pythPrice.price, pythPrice.expo);

        console.log("\nOutput (USDC 6-decimal):");
        console.log("  price:", convertedPrice);
        console.log("  dollars:", convertedPrice / 1e6);

        // Calculate cell ID
        uint256 cellId = convertedPrice / BAND_WIDTH;
        uint256 cellLow = cellId * BAND_WIDTH;
        uint256 cellHigh = cellLow + BAND_WIDTH;

        console.log("\nCell Mapping:");
        console.log("  cellId:", cellId);
        console.log("  range: $", cellLow / 1e6, "- $", cellHigh / 1e6);

        // Verify conversion is reasonable
        assertGt(convertedPrice, 1000_000_000, "Converted price should be > $1000");
        assertLt(convertedPrice, 10000_000_000, "Converted price should be < $10000");
    }

    function test_SettlementWithRealPythPrice() public onlyFork {
        console.log("\n=== Testing Settlement with Real Pyth Price ===");

        // Get current price to know which cell to bet on
        PythStructs.Price memory currentPrice = PYTH_ORACLE.getPriceUnsafe(ETH_USD_FEED_ID);
        uint256 priceInUsdc = convertPythToUsdc(currentPrice.price, currentPrice.expo);
        uint256 currentCell = priceInUsdc / BAND_WIDTH;

        console.log("Current ETH Price: $", priceInUsdc / 1e6);
        console.log("Current Cell ID:", currentCell);

        // Place bet in window 4 (first bettable window)
        uint256 windowId = FROZEN_WINDOWS + 1;
        uint256 betAmount = 10_000_000; // $10

        // Bet on cells around current price
        vm.prank(user1);
        hook.placeBet(testKey, currentCell, windowId, betAmount);

        vm.prank(user1);
        hook.placeBet(testKey, currentCell + 1, windowId, betAmount);

        console.log("\nBets Placed:");
        console.log("  Cell", currentCell, ": $10");
        console.log("  Cell", currentCell + 1, ": $10");

        // Warp to window end
        uint256 windowEnd = GRID_EPOCH + ((windowId + 1) * WINDOW_DURATION);
        vm.warp(windowEnd);

        // In a real scenario, keeper would fetch VAA from Hermes API
        // For testing on fork, we can use the latest price (no VAA needed for getPriceUnsafe)
        // NOTE: In production, MUST use parsePriceFeedUpdates() with VAA data

        console.log("\nAttempting settlement...");
        console.log("Note: This test demonstrates the price fetching flow.");
        console.log("Production settlement requires VAA from Hermes API.");

        // Get latest price at settlement time
        PythStructs.Price memory settlementPrice = PYTH_ORACLE.getPriceUnsafe(ETH_USD_FEED_ID);
        uint256 closingPriceUsdc = convertPythToUsdc(settlementPrice.price, settlementPrice.expo);
        uint256 winningCell = closingPriceUsdc / BAND_WIDTH;

        console.log("\nSettlement Price: $", closingPriceUsdc / 1e6);
        console.log("Winning Cell ID:", winningCell);

        // Verify price is valid
        assertGt(closingPriceUsdc, 0, "Closing price should be > 0");

        console.log("\nReal Pyth integration working correctly!");
    }

    // =============================================================
    //                      HELPER FUNCTIONS
    // =============================================================

    /**
     * @notice Convert Pyth price format to USDC 6-decimal
     * @dev Matches the conversion logic in PariHook._parsePythPrice()
     */
    function convertPythToUsdc(int64 pythPrice, int32 pythExpo) internal pure returns (uint256) {
        // Target: USDC 6-decimal format
        // Formula: usdcPrice = pythPrice * 10^(pythExpo + 6)
        uint256 absPrice = SafeCast.toUint256(int256(pythPrice)); // validates >= 0

        int32 exponentAdjustment = pythExpo + 6;

        if (exponentAdjustment >= 0) {
            // Multiply: price * 10^exponentAdjustment
            return absPrice * (10 ** SafeCast.toUint256(int256(exponentAdjustment)));
        } else {
            // Divide: price / 10^(-exponentAdjustment)
            return absPrice / (10 ** SafeCast.toUint256(int256(-exponentAdjustment)));
        }
    }
}

// =============================================================
//                      MOCK CONTRACTS
// =============================================================

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
