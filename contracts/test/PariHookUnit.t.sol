// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/**
 * @title PariHookUnitTest
 * @notice Unit tests for PariHook pool initialization logic
 * @dev Simplified tests that avoid Uniswap V4 hook address validation
 */
contract PariHookUnitTest is Test {
    using PoolIdLibrary for PoolKey;

    PariHook public hook;
    IPoolManager public poolManager;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public alice = makeAddr("alice");
    address public usdcToken = makeAddr("usdc");

    bytes32 public constant ETH_USD_FEED_ID = bytes32(uint256(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace));
    uint256 public constant BAND_WIDTH = 2_000_000;
    uint256 public constant WINDOW_DURATION = 60;
    uint256 public constant FROZEN_WINDOWS = 3;
    uint256 public constant MAX_STAKE_PER_CELL = 100_000_000_000;
    uint256 public constant FEE_BPS = 200;
    uint256 public constant MIN_POOL_THRESHOLD = 1_000_000;

    function setUp() public {
        // Deploy mock PoolManager
        poolManager = IPoolManager(makeAddr("poolManager"));

        // Deploy PariHook as admin
        vm.prank(admin);
        hook = new PariHook(poolManager);

        // Grant roles
        vm.startPrank(admin);
        hook.grantRole(hook.ADMIN_ROLE(), admin);
        hook.grantRole(hook.TREASURY_ROLE(), treasury);
        vm.stopPrank();
    }

    function _createTestPoolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: hook
        });
    }

    function test_ConfigureGrid_Success() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );

        // Success - no revert means configuration was stored
    }

    function test_ConfigureGrid_RevertWhen_NotAdmin() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(alice);
        vm.expectRevert();
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_ZeroBandWidth() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Band width must be > 0");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            0, // Invalid
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_ZeroWindowDuration() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Window duration must be > 0");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            0, // Invalid
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_FrozenWindowsTooLow() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Frozen windows must be 1-10");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            0, // Invalid
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_FrozenWindowsTooHigh() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Frozen windows must be 1-10");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            11, // Invalid
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_FeeExceeds10Percent() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Fee cannot exceed 10%");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            1001, // Invalid: > 10%
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_ZeroMaxStake() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Max stake must be > 0");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            0, // Invalid
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_ZeroMinThreshold() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Min pool threshold must be > 0");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            0, // Invalid
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_InvalidUsdcAddress() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Invalid USDC address");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            address(0) // Invalid
        );
    }

    function test_ConfigureGrid_RevertWhen_InvalidPriceFeedId() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.prank(admin);
        vm.expectRevert("Invalid price feed ID");
        hook.configureGrid(
            poolKey,
            bytes32(0), // Invalid
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );
    }

    function test_ConfigureGrid_RevertWhen_AlreadyConfigured() public {
        PoolKey memory poolKey = _createTestPoolKey();

        vm.startPrank(admin);

        // First configuration succeeds
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );

        // Second configuration fails
        vm.expectRevert("Grid already configured");
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );

        vm.stopPrank();
    }

    function test_BeforeInitialize_Success() public {
        PoolKey memory poolKey = _createTestPoolKey();
        PoolId poolId = poolKey.toId();

        // Configure grid first
        vm.prank(admin);
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );

        // Mock PoolManager calling beforeInitialize
        vm.prank(address(poolManager));

        uint256 expectedEpoch = block.timestamp;

        vm.expectEmit(true, false, false, true);
        emit PariHook.PoolInitialized(
            poolId,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            expectedEpoch,
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD
        );

        bytes4 selector = hook.beforeInitialize(address(this), poolKey, 1 << 96);
        assertEq(selector, hook.beforeInitialize.selector, "Should return correct selector");
    }

    function test_BeforeInitialize_RevertWhen_GridNotConfigured() public {
        PoolKey memory poolKey = _createTestPoolKey();

        // Attempt to initialize without configuring
        vm.prank(address(poolManager));
        vm.expectRevert("Grid config not set");
        hook.beforeInitialize(address(this), poolKey, 1 << 96);
    }

    function test_ConfigureGrid_FeeAt10Percent() public {
        PoolKey memory poolKey = _createTestPoolKey();

        // Should accept exactly 10% (1000 bps)
        vm.prank(admin);
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            FROZEN_WINDOWS,
            MAX_STAKE_PER_CELL,
            1000, // Exactly 10%
            MIN_POOL_THRESHOLD,
            usdcToken
        );

        // Success
    }

    function test_ConfigureGrid_MinimalFrozenWindows() public {
        PoolKey memory poolKey = _createTestPoolKey();

        // Should accept frozenWindows = 1
        vm.prank(admin);
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            1, // Minimum valid value
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );

        // Success
    }

    function test_ConfigureGrid_MaximalFrozenWindows() public {
        PoolKey memory poolKey = _createTestPoolKey();

        // Should accept frozenWindows = 10
        vm.prank(admin);
        hook.configureGrid(
            poolKey,
            ETH_USD_FEED_ID,
            BAND_WIDTH,
            WINDOW_DURATION,
            10, // Maximum valid value
            MAX_STAKE_PER_CELL,
            FEE_BPS,
            MIN_POOL_THRESHOLD,
            usdcToken
        );

        // Success
    }
}
