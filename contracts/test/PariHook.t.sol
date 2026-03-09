// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

contract PariHookTest is Test {
    using PoolIdLibrary for PoolKey;

    PariHook internal hook;
    IPoolManager internal poolManager;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal randomUser = makeAddr("randomUser");

    address internal usdc = makeAddr("usdc");

    PoolKey internal testPoolKey;
    PoolId internal testPoolId;

    bytes32 internal constant ETH_USD_FEED_ID =
        bytes32(uint256(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace));

    uint256 internal constant BAND_WIDTH = 2_000_000;
    uint256 internal constant WINDOW_DURATION = 60;
    uint256 internal constant FROZEN_WINDOWS = 3;
    uint256 internal constant MAX_STAKE_PER_CELL = 100_000_000_000;
    uint256 internal constant FEE_BPS = 200;
    uint256 internal constant MIN_POOL_THRESHOLD = 1_000_000;

    event GridInitialized(
        PoolId indexed poolId,
        bytes32 pythPriceFeedId,
        uint256 bandWidth,
        uint256 windowDuration,
        uint256 frozenWindows,
        uint256 gridEpoch,
        uint256 maxStakePerCell,
        uint256 feeBps,
        uint256 minPoolThreshold
    );

    function setUp() public {
        poolManager = IPoolManager(makeAddr("poolManager"));
        IPyth pyth = IPyth(makeAddr("pythOracle"));

        hook = new PariHook(poolManager, pyth, admin, treasury, relayer);

        testPoolKey = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: hook
        });
        testPoolId = testPoolKey.toId();
    }

    function _futureMinuteEpoch() internal view returns (uint256) {
        return ((block.timestamp / 60) + 10) * 60;
    }

    function _configureGrid() internal {
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
            _futureMinuteEpoch(),
            usdc
        );
    }

    function test_Constructor_SetsRolesAndDependencies() public view {
        assertEq(address(hook.POOL_MANAGER()), address(poolManager));
        assertTrue(hook.hasRole(hook.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(hook.hasRole(hook.ADMIN_ROLE(), admin));
        assertTrue(hook.hasRole(hook.TREASURY_ROLE(), treasury));
        assertTrue(hook.hasRole(hook.RELAYER_ROLE(), relayer));
        assertTrue(hook.DOMAIN_SEPARATOR() != bytes32(0));
    }

    function test_ConfigureGrid_StoresConfig() public {
        uint256 gridEpoch = _futureMinuteEpoch();

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
            gridEpoch,
            usdc
        );

        (
            bytes32 feed,
            uint256 bandWidth,
            uint256 duration,
            uint256 frozen,
            uint256 maxStake,
            uint256 fee,
            uint256 epoch,
            address usdcToken,
            uint256 threshold
        ) = hook.gridConfigs(testPoolId);

        assertEq(feed, ETH_USD_FEED_ID);
        assertEq(bandWidth, BAND_WIDTH);
        assertEq(duration, WINDOW_DURATION);
        assertEq(frozen, FROZEN_WINDOWS);
        assertEq(maxStake, MAX_STAKE_PER_CELL);
        assertEq(fee, FEE_BPS);
        assertEq(epoch, gridEpoch);
        assertEq(usdcToken, usdc);
        assertEq(threshold, MIN_POOL_THRESHOLD);
    }

    function test_ConfigureGrid_RevertWhen_NotAdmin() public {
        vm.prank(randomUser);
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
            _futureMinuteEpoch(),
            usdc
        );
    }

    function test_BeforeInitialize_RevertWhen_NotPoolManager() public {
        _configureGrid();
        vm.expectRevert("Only PoolManager");
        hook.beforeInitialize(address(this), testPoolKey, 0);
    }

    function test_BeforeInitialize_RevertWhen_GridNotConfigured() public {
        vm.prank(address(poolManager));
        vm.expectRevert("Grid not configured");
        hook.beforeInitialize(address(this), testPoolKey, 0);
    }

    function test_BeforeInitialize_EmitsGridInitialized() public {
        _configureGrid();

        (
            bytes32 feed,
            uint256 bandWidth,
            uint256 duration,
            uint256 frozen,
            uint256 maxStake,
            uint256 fee,
            uint256 epoch,
            ,
            uint256 threshold
        ) = hook.gridConfigs(testPoolId);

        vm.expectEmit(true, false, false, true);
        emit GridInitialized(testPoolId, feed, bandWidth, duration, frozen, epoch, maxStake, fee, threshold);

        vm.prank(address(poolManager));
        bytes4 selector = hook.beforeInitialize(address(this), testPoolKey, 0);
        assertEq(selector, hook.beforeInitialize.selector);
    }

    function test_CurrentWindowAndBettableWindows() public {
        uint256 gridEpoch = _futureMinuteEpoch();

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
            gridEpoch,
            usdc
        );

        vm.warp(gridEpoch + WINDOW_DURATION * 2 + 5);

        uint256 current = hook.getCurrentWindow(testPoolKey);
        (uint256 start, uint256 end) = hook.getBettableWindows(testPoolKey);

        assertEq(current, 2);
        assertEq(start, 6);
        assertEq(end, 8);
    }

    function test_AdminSetters_UpdateConfig() public {
        _configureGrid();

        vm.startPrank(admin);
        hook.setFeeBps(testPoolKey, 300);
        hook.setFrozenWindows(testPoolKey, 4);
        hook.setMinPoolThreshold(testPoolKey, 2_000_000);
        hook.setMaxStakePerCell(testPoolKey, 200_000_000_000);
        vm.stopPrank();

        (,,, uint256 frozen, uint256 maxStake, uint256 fee,,, uint256 threshold) = hook.gridConfigs(testPoolId);

        assertEq(fee, 300);
        assertEq(frozen, 4);
        assertEq(threshold, 2_000_000);
        assertEq(maxStake, 200_000_000_000);
    }
}
